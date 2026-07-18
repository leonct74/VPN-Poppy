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
import { READY_SENTINEL, type EndpointConfig } from "./types";

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
