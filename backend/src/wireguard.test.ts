import { describe, it, expect } from "vitest";
import {
  derivePublicKey,
  generateKeyPair,
  generatePresharedKey,
  runCeremony,
  deviceAddress,
  buildServerConfig,
  buildDeviceConfig,
  SERVER_ADDRESS,
  WG_PORT,
} from "./wireguard";

// RFC 7748 §6.1 canonical Curve25519 vectors — the definitive interop check (CLAUDE.md #5).
// A private key in base64, and the public key `wg pubkey` must produce from it.
const ALICE_PRIV_B64 = Buffer.from("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a", "hex").toString("base64");
const ALICE_PUB_B64 = Buffer.from("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a", "hex").toString("base64");
const BOB_PRIV_B64 = Buffer.from("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb", "hex").toString("base64");
const BOB_PUB_B64 = Buffer.from("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f", "hex").toString("base64");

describe("X25519 key ceremony — RFC 7748 interop", () => {
  it("derives the exact public keys from the canonical private keys", () => {
    expect(derivePublicKey(ALICE_PRIV_B64)).toBe(ALICE_PUB_B64);
    expect(derivePublicKey(BOB_PRIV_B64)).toBe(BOB_PUB_B64);
  });

  it("generates 32-byte base64 keys that round-trip through derivePublicKey", () => {
    const kp = generateKeyPair();
    expect(Buffer.from(kp.privateKey, "base64")).toHaveLength(32);
    expect(Buffer.from(kp.publicKey, "base64")).toHaveLength(32);
    expect(derivePublicKey(kp.privateKey)).toBe(kp.publicKey);
  });

  it("clamps the private key (the low 3 bits are cleared, per Curve25519)", () => {
    const priv = Buffer.from(generateKeyPair().privateKey, "base64");
    expect(priv[0]! & 0b111).toBe(0);
    expect(priv[31]! & 0b1100_0000).toBe(0b0100_0000);
  });

  it("preshared keys are 32 random bytes and distinct", () => {
    const a = generatePresharedKey();
    const b = generatePresharedKey();
    expect(Buffer.from(a, "base64")).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it("rejects a malformed private key", () => {
    expect(() => derivePublicKey(Buffer.alloc(16).toString("base64"))).toThrow();
  });
});

describe("runCeremony", () => {
  it("makes one server key + N distinct device keys with sequential addresses", () => {
    const c = runCeremony(3);
    expect(c.serverPublicKey).toBe(derivePublicKey(c.serverPrivateKey));
    expect(c.devices).toHaveLength(3);
    expect(c.devices.map((d) => d.address)).toEqual(["10.8.0.2", "10.8.0.3", "10.8.0.4"]);
    const pubs = new Set(c.devices.map((d) => d.publicKey));
    expect(pubs.size).toBe(3); // no duplicate identities
    for (const d of c.devices) expect(derivePublicKey(d.privateKey)).toBe(d.publicKey);
  });

  it("clamps slot count to the 1–20 range", () => {
    expect(runCeremony(0).devices).toHaveLength(1);
    expect(runCeremony(99).devices).toHaveLength(20);
  });

  it("addresses never collide with the server address", () => {
    for (let i = 1; i <= 20; i++) expect(deviceAddress(i)).not.toBe(SERVER_ADDRESS);
  });
});

describe("buildServerConfig", () => {
  const c = runCeremony(2);
  const conf = buildServerConfig(c);

  it("is a valid [Interface] with the server key, port and NAT PostUp", () => {
    expect(conf).toContain("[Interface]");
    expect(conf).toContain(`Address = ${SERVER_ADDRESS}/24`);
    expect(conf).toContain(`ListenPort = ${WG_PORT}`);
    expect(conf).toContain(`PrivateKey = ${c.serverPrivateKey}`);
    // NAT masquerade with the first-boot NIC placeholder + forwarding.
    expect(conf).toContain("iptables -t nat -A POSTROUTING -o %WGNIC% -j MASQUERADE");
    expect(conf).toContain("net.ipv4.ip_forward=1");
  });

  it("has a [Peer] per device with public key, PSK and a /32 AllowedIP (never the device's private key)", () => {
    expect(conf.match(/\[Peer\]/g)).toHaveLength(2);
    for (const d of c.devices) {
      expect(conf).toContain(`PublicKey = ${d.publicKey}`);
      expect(conf).toContain(`PresharedKey = ${d.presharedKey}`);
      expect(conf).toContain(`AllowedIPs = ${d.address}/32`);
      // The server must NEVER see a device's private key.
      expect(conf).not.toContain(d.privateKey);
    }
  });

  it("bakes no shell metacharacters (safe inside a heredoc)", () => {
    // Base64 uses [A-Za-z0-9+/=]; ensure no $ or backtick slipped into the generated body.
    const keyBody = conf.replace(/%WGNIC%/g, "");
    expect(keyBody).not.toMatch(/[$`]/);
  });
});

describe("buildDeviceConfig", () => {
  const c = runCeremony(1);
  const conf = buildDeviceConfig({ device: c.devices[0]!, serverPublicKey: c.serverPublicKey, endpointIp: "203.0.113.7" });

  it("routes all traffic through the tunnel and DNS through the endpoint resolver", () => {
    expect(conf).toContain(`PrivateKey = ${c.devices[0]!.privateKey}`);
    expect(conf).toContain(`DNS = ${SERVER_ADDRESS}`);
    expect(conf).toContain(`PublicKey = ${c.serverPublicKey}`);
    expect(conf).toContain(`Endpoint = 203.0.113.7:${WG_PORT}`);
    expect(conf).toContain("AllowedIPs = 0.0.0.0/0, ::/0");
    expect(conf).toContain("PersistentKeepalive = 25");
  });
});
