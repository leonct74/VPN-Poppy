// The WireGuard key ceremony + config generation — pure, no AWS, no native deps, fully
// unit-testable (and tested against the RFC 7748 Curve25519 vectors). See DESIGN.md §3.
//
// WireGuard keys are plain Curve25519 (X25519). We generate them in the poppy backend on
// the user's machine with node:crypto — the server's private key is the ONLY key that ever
// leaves this process (baked into user-data), and it never touches the network. Device
// private keys stay in the poppy's keystore and are shown to the user only as QR / .conf.
//
// CLAUDE.md gotcha #5: these must round-trip against the real `wg` tooling. They do — the
// derivation is validated against RFC 7748's canonical vectors in wireguard.test.ts.

import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";

// DER prefixes for a raw 32-byte X25519 key (OID 1.3.101.110). Wrapping the 32 raw bytes
// in these lets node:crypto import/derive without any native WireGuard dependency.
const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

/** A WireGuard keypair, base64 (the exact encoding `wg` uses). */
export interface WgKeyPair {
  privateKey: string;
  publicKey: string;
}

/** Apply the Curve25519 clamp `wg genkey` applies, so the private key is canonical. */
function clamp(k: Buffer): Buffer {
  k[0]! &= 248;
  k[31]! &= 127;
  k[31]! |= 64;
  return k;
}

/** Derive the base64 public key for a base64 X25519 private key (base-point scalar mult). */
export function derivePublicKey(privateKeyB64: string): string {
  const raw = Buffer.from(privateKeyB64, "base64");
  if (raw.length !== 32) throw new Error("A WireGuard private key must be 32 bytes.");
  const keyObj = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });
  const spki = createPublicKey(keyObj).export({ format: "der", type: "spki" });
  return Buffer.from(spki.subarray(spki.length - 32)).toString("base64");
}

/** Generate a fresh WireGuard keypair (crypto RNG; nothing derived from wall-clock). */
export function generateKeyPair(): WgKeyPair {
  const priv = clamp(randomBytes(32));
  const privateKey = priv.toString("base64");
  return { privateKey, publicKey: derivePublicKey(privateKey) };
}

/** Generate a WireGuard preshared key (`wg genpsk`) — 32 random bytes, base64. */
export function generatePresharedKey(): string {
  return randomBytes(32).toString("base64");
}

// ---- Address plan --------------------------------------------------------------

/** The tunnel subnet. Server is .1; devices are .2 … (fits up to 20 slots in a /24). */
export const VPN_SUBNET = "10.8.0.0/24";
export const SERVER_ADDRESS = "10.8.0.1";
export const WG_PORT = 51820;

/** The in-tunnel address for device index `i` (1-based): 10.8.0.(i+1). */
export function deviceAddress(index1Based: number): string {
  return `10.8.0.${index1Based + 1}`;
}

// ---- Key ceremony for a whole deployment ---------------------------------------

/** One device's full key material + its in-tunnel address. */
export interface DevicePeer {
  /** User-facing label (editable). */
  name: string;
  /** In-tunnel address, e.g. 10.8.0.2 (the /32 AllowedIP on the server side). */
  address: string;
  privateKey: string;
  publicKey: string;
  presharedKey: string;
}

/** Everything generated at launch for one endpoint. The server private key is returned
 *  only to be baked into user-data by the caller; it is NOT persisted in the keystore. */
export interface Ceremony {
  serverPrivateKey: string;
  serverPublicKey: string;
  devices: DevicePeer[];
}

/** Default device names, cycling through friendly labels then numbering. */
function defaultDeviceName(i: number): string {
  const base = ["Phone", "Laptop", "Tablet", "Desktop"];
  return i <= base.length ? base[i - 1]! : `Device ${i}`;
}

/** Run the full key ceremony for `slots` devices (DESIGN §3.1). */
export function runCeremony(slots: number): Ceremony {
  const n = Math.max(1, Math.min(20, Math.round(slots)));
  const server = generateKeyPair();
  const devices: DevicePeer[] = [];
  for (let i = 1; i <= n; i++) {
    const kp = generateKeyPair();
    devices.push({
      name: defaultDeviceName(i),
      address: deviceAddress(i),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
      presharedKey: generatePresharedKey(),
    });
  }
  return { serverPrivateKey: server.privateKey, serverPublicKey: server.publicKey, devices };
}

// ---- Config rendering ----------------------------------------------------------

/**
 * The server's /etc/wireguard/wg0.conf (baked into user-data). NAT masquerade + forwarding
 * live in PostUp/PostDown so wg-quick manages them; `%i` is wg-quick's own token for the
 * interface (wg0) and `%WGNIC%` is our placeholder that first-boot replaces with the box's
 * real default NIC (ens5 on Nitro, not eth0). Base64 keys contain no shell metacharacters,
 * so this is safe to bake into a heredoc.
 */
export function buildServerConfig(c: Ceremony): string {
  const lines = [
    "[Interface]",
    `Address = ${SERVER_ADDRESS}/24`,
    `ListenPort = ${WG_PORT}`,
    `PrivateKey = ${c.serverPrivateKey}`,
    "PostUp = sysctl -w net.ipv4.ip_forward=1; iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o %WGNIC% -j MASQUERADE",
    "PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o %WGNIC% -j MASQUERADE",
  ];
  for (const d of c.devices) {
    lines.push(
      "",
      `[Peer]`,
      `# ${d.name}`,
      `PublicKey = ${d.publicKey}`,
      `PresharedKey = ${d.presharedKey}`,
      `AllowedIPs = ${d.address}/32`,
    );
  }
  return lines.join("\n") + "\n";
}

export interface DeviceConfigInput {
  device: DevicePeer;
  serverPublicKey: string;
  /** The endpoint's public IPv4 (filled in when the QR/.conf is rendered — DESIGN §3.3). */
  endpointIp: string;
}

/**
 * One device's .conf (what becomes the QR and the download). Routes ALL traffic through the
 * tunnel (AllowedIPs 0.0.0.0/0, ::/0) and points DNS at the endpoint's unbound resolver so
 * the local network can't see lookups (DESIGN §6). PersistentKeepalive keeps the NAT binding
 * alive on mobile networks.
 */
export function buildDeviceConfig({ device, serverPublicKey, endpointIp }: DeviceConfigInput): string {
  return (
    [
      "[Interface]",
      `PrivateKey = ${device.privateKey}`,
      `Address = ${device.address}/32`,
      `DNS = ${SERVER_ADDRESS}`,
      "",
      "[Peer]",
      `PublicKey = ${serverPublicKey}`,
      `PresharedKey = ${device.presharedKey}`,
      `Endpoint = ${endpointIp}:${WG_PORT}`,
      "AllowedIPs = 0.0.0.0/0, ::/0",
      "PersistentKeepalive = 25",
    ].join("\n") + "\n"
  );
}
