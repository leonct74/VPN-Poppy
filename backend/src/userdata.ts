// Pure generation of the first-boot script (user-data). No AWS, no IO — fully
// unit-testable. See DESIGN.md §3.
//
// The user-data IS the whole server config (CLAUDE.md gotcha #4): idempotent and
// self-contained, because there's no SSH way in to fix a half-configured box. It:
//   1. installs wireguard + unbound (Ubuntu 24.04 ships both),
//   2. writes /etc/wireguard/wg0.conf (server key + device peers, baked by the poppy),
//      substituting the box's real default NIC into the NAT masquerade rule,
//   3. stands up unbound as the in-tunnel DNS resolver on 10.8.0.1 (so the local network
//      can't see lookups — DESIGN §6; Premium turns this into an ad-blocker in P4),
//   4. enables ip_forward and brings up wg-quick@wg0,
//   5. prints VPNPOPPY_READY to the serial console (GetConsoleOutput readiness — DESIGN
//      §3.4; the definitive check is still the device's handshake).

import { runCeremony, buildServerConfig, SERVER_ADDRESS, VPN_SUBNET, type Ceremony } from "./wireguard";
import {
  READY_SENTINEL,
  SHIELD_BLOCKLIST_URL,
  SHIELD_CANARY,
  SHIELD_CANARY_IP,
  type EndpointConfig,
} from "./types";

export interface UserDataInput {
  config: EndpointConfig;
  /** The key material generated for this launch (server config is baked in). */
  ceremony: Ceremony;
}

/** A here-doc terminator that can't collide with base64 config bodies. */
const CONF_EOF = "VPNPOPPY_WG0_EOF";

/** Build the (not-yet-base64) user-data string for an endpoint launch. */
export function generateUserData({ config, ceremony }: UserDataInput): string {
  const serverConf = buildServerConfig(ceremony);
  const lines: string[] = [
    "#!/bin/bash",
    "set -x",
    "# VPN-Poppy first-boot — WireGuard endpoint + unbound resolver (DESIGN §3, §6)",
    "exec > >(tee /var/log/vpnpoppy-boot.log) 2>&1",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -y",
    "apt-get install -y wireguard iptables unbound",
    "",
    "# --- WireGuard server config (keys baked by the poppy) ---",
    "install -d -m 0700 /etc/wireguard",
    // Quoted here-doc terminator → the shell does NOT expand anything in the body; base64
    // keys are written verbatim. %WGNIC%/%i are literal until substituted below.
    `cat > /etc/wireguard/wg0.conf <<'${CONF_EOF}'`,
    serverConf.replace(/\n$/, ""),
    CONF_EOF,
    "chmod 600 /etc/wireguard/wg0.conf",
    "",
    "# Substitute the box's real default interface into the NAT masquerade rule",
    "WGNIC=$(ip -o -4 route show to default | awk '{print $5; exit}')",
    'sed -i "s/%WGNIC%/${WGNIC}/g" /etc/wireguard/wg0.conf',
    "",
    "# --- unbound: in-tunnel DNS resolver on the WireGuard address ---",
    "install -d -m 0755 /etc/unbound/unbound.conf.d",
    "cat > /etc/unbound/unbound.conf.d/vpnpoppy.conf <<'VPNPOPPY_UNBOUND_EOF'",
    "server:",
    `  interface: ${SERVER_ADDRESS}`,
    "  interface: 127.0.0.1",
    "  access-control: 127.0.0.0/8 allow",
    `  access-control: ${VPN_SUBNET} allow`,
    "  do-ip6: no",
    "  hide-identity: yes",
    "  hide-version: yes",
    "  qname-minimisation: yes",
    "VPNPOPPY_UNBOUND_EOF",
    "",
    "# --- enable forwarding + bring the tunnel up (unbound after wg0, so 10.8.0.1 exists) ---",
    "echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-vpnpoppy.conf",
    "sysctl -p /etc/sysctl.d/99-vpnpoppy.conf",
    "systemctl enable --now wg-quick@wg0",
    "systemctl restart unbound",
    "systemctl enable unbound",
  ];

  // Premium Shielded DNS (DESIGN §12): make the resolver an ad/tracker/malware blocker.
  if (config.shieldedDns) lines.push(...shieldedDnsLines());

  // Optional TTL self-destruct — the forgotten-instance safety net (DESIGN §11.4). Combined
  // with InstanceInitiatedShutdownBehavior=terminate this tears the box down on its own.
  if (config.autoTeardownHours && config.autoTeardownHours > 0) {
    const minutes = Math.max(1, Math.round(config.autoTeardownHours * 60));
    lines.push("", `shutdown -h +${minutes} "VPN-Poppy auto-teardown" || true`);
  }

  // Sentinel to the serial console (what GetConsoleOutput reads) AND the boot log.
  lines.push("", `echo "${READY_SENTINEL}" | tee /dev/console || echo "${READY_SENTINEL}"`);
  return lines.join("\n") + "\n";
}

/**
 * The first-boot steps that turn unbound into an ad/tracker/malware blocker (premium
 * Shielded DNS, DESIGN §12): fetch a curated blocklist and load every domain as an
 * NXDOMAIN local-zone, refreshed on each boot. Two safety properties:
 *   - **fail-open**: if the download or config is bad, or unbound won't come up (e.g. OOM),
 *     we drop the blocklist and restart so DNS keeps working — a paid feature must never
 *     break the free VPN;
 *   - a **swap file** first, so a ~150k-entry list can't OOM a 512MB t4g.nano.
 * A canary local-data record lets the tunnel owner prove the shield is live (see types.ts).
 */
export function shieldedDnsLines(): string[] {
  return [
    "",
    "# --- Shielded DNS (premium): ad/tracker/malware blocking at the resolver (DESIGN §12) ---",
    "# Swap first so a large blocklist can't OOM a 512MB nano; every step fails open.",
    "if [ ! -f /swapfile ]; then fallocate -l 512M /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile; fi",
    "SHIELD=/etc/unbound/unbound.conf.d/vpnpoppy-shield.conf",
    `if curl -fsSL --max-time 90 ${SHIELD_BLOCKLIST_URL} -o /tmp/vpnpoppy-blocklist 2>/dev/null; then`,
    '  echo "server:" > "$SHIELD"',
    // "0.0.0.0 domain" hosts lines → NXDOMAIN local-zones (drop the 0.0.0.0 self-entry).
    `  grep -E '^0\\.0\\.0\\.0[[:space:]]+' /tmp/vpnpoppy-blocklist | awk '{print $2}' | grep -vx 0.0.0.0 | sort -u | sed -e 's/^/  local-zone: "/' -e 's/$/" always_nxdomain/' >> "$SHIELD"`,
    // Canary: answers only when the shield is loaded — a deterministic self-test.
    `  echo '  local-zone: "${SHIELD_CANARY}" redirect' >> "$SHIELD"`,
    `  echo '  local-data: "${SHIELD_CANARY} A ${SHIELD_CANARY_IP}"' >> "$SHIELD"`,
    '  if unbound-checkconf >/dev/null 2>&1; then systemctl restart unbound; else rm -f "$SHIELD"; systemctl restart unbound; fi',
    "  sleep 2",
    '  if ! systemctl is-active --quiet unbound; then rm -f "$SHIELD"; systemctl restart unbound; fi',
    "fi",
  ];
}
