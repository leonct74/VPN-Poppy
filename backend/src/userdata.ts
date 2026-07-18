// Pure generation of the first-boot script (user-data). No AWS, no IO — fully
// unit-testable. See DESIGN.md §3, §13.
//
// P0 (walking skeleton): the box just boots and prints the READY_SENTINEL to the SERIAL
// CONSOLE, so the backend can detect "ready" via GetConsoleOutput — with no instance IAM
// role and no SSH. An optional TTL self-shutdown is the forgotten-instance safety net.
//
// P1 will extend this to write /etc/wireguard/wg0.conf (server key + N device peers),
// enable ip_forward + NAT masquerade, and `systemctl enable --now wg-quick@wg0`. The
// server's config is the WHOLE server setup — it must stay idempotent and self-contained
// (CLAUDE.md gotcha #4): there is no SSH way in to fix a half-configured box.

import { READY_SENTINEL, type EndpointConfig } from "./types";

export interface UserDataInput {
  config: EndpointConfig;
}

/** Build the (not-yet-base64) user-data string for an endpoint launch. */
export function generateUserData({ config }: UserDataInput): string {
  const lines: string[] = [
    "#!/bin/bash",
    "set -x",
    "# VPN-Poppy first-boot (P0 skeleton — WireGuard lands in P1)",
    "exec > >(tee /var/log/vpnpoppy-boot.log) 2>&1",
  ];

  // Optional TTL self-destruct. Combined with InstanceInitiatedShutdownBehavior=terminate
  // (set at RunInstances) this tears the box down even if the app is closed — the honest
  // "running or gone" lifecycle (DESIGN §11.4), and the forgotten-instance safety net.
  if (config.autoTeardownHours && config.autoTeardownHours > 0) {
    const minutes = Math.max(1, Math.round(config.autoTeardownHours * 60));
    lines.push(`shutdown -h +${minutes} "VPN-Poppy auto-teardown" || true`);
  }

  // Sentinel to the serial console (what GetConsoleOutput reads) AND the boot log.
  lines.push(`echo "${READY_SENTINEL}" | tee /dev/console || echo "${READY_SENTINEL}"`);
  return lines.join("\n") + "\n";
}
