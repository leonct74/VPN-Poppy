import { describe, it, expect } from "vitest";
import { generateUserData } from "./userdata";
import { runCeremony } from "./wireguard";
import { attributionTags, ownInstancesFilter, tagValue, APP_ID, TAG_APP, TAG_ACCOUNT, TAG_CONNECTION } from "./tags";
import { READY_SENTINEL, WIREGUARD_PORT, type EndpointConfig } from "./types";

const base: EndpointConfig = {
  region: "eu-central-1",
  instanceType: "t4g.nano",
  arch: "arm64",
  deviceSlots: 3,
};

const ceremony = runCeremony(3);

describe("generateUserData — WireGuard first boot", () => {
  const ud = generateUserData({ config: base, ceremony });

  it("is a bash script that installs wireguard + unbound and brings the tunnel up", () => {
    expect(ud.startsWith("#!/bin/bash")).toBe(true);
    expect(ud).toContain("apt-get install -y wireguard iptables unbound");
    expect(ud).toContain("systemctl enable --now wg-quick@wg0");
  });

  it("writes wg0.conf with the baked server key and every device peer", () => {
    expect(ud).toContain("cat > /etc/wireguard/wg0.conf");
    expect(ud).toContain(`PrivateKey = ${ceremony.serverPrivateKey}`);
    for (const d of ceremony.devices) expect(ud).toContain(`PublicKey = ${d.publicKey}`);
    expect(ud).toContain("chmod 600 /etc/wireguard/wg0.conf");
  });

  it("never bakes a device PRIVATE key into the server user-data (no-leak)", () => {
    for (const d of ceremony.devices) expect(ud).not.toContain(d.privateKey);
  });

  it("substitutes the real default NIC into the NAT masquerade rule at boot", () => {
    expect(ud).toContain("WGNIC=$(ip -o -4 route show to default | awk '{print $5; exit}')");
    expect(ud).toContain('sed -i "s/%WGNIC%/${WGNIC}/g" /etc/wireguard/wg0.conf');
  });

  it("stands up unbound as the in-tunnel resolver on the WireGuard address", () => {
    expect(ud).toContain("interface: 10.8.0.1");
    expect(ud).toContain("access-control: 10.8.0.0/24 allow");
    expect(ud).toContain("systemctl restart unbound");
  });

  it("enables ip_forward and prints the readiness sentinel", () => {
    expect(ud).toContain("net.ipv4.ip_forward=1");
    expect(ud).toContain(`echo "${READY_SENTINEL}" | tee /dev/console`);
  });

  it("has NO SSH server, no key pair, no login path baked in (no-SSH invariant)", () => {
    const low = ud.toLowerCase();
    expect(low).not.toContain("sshd");
    expect(low).not.toContain("authorized_keys");
    expect(low).not.toContain("ssh-rsa");
  });

  it("schedules a TTL self-destruct only when autoTeardownHours is set", () => {
    expect(generateUserData({ config: base, ceremony })).not.toContain("shutdown -h");
    const ttl = generateUserData({ config: { ...base, autoTeardownHours: 8 }, ceremony });
    expect(ttl).toContain('shutdown -h +480 "VPN-Poppy auto-teardown"');
  });
});

describe("tags", () => {
  it("stamps all three attribution tags", () => {
    const tags = attributionTags({ accountId: "111122223333", connectionId: "conn-abc" });
    expect(tagValue(tags, TAG_ACCOUNT)).toBe("111122223333");
    expect(tagValue(tags, TAG_APP)).toBe(APP_ID);
    expect(tagValue(tags, TAG_CONNECTION)).toBe("conn-abc");
  });

  it("filters endpoints by the stable app tag, not the connection id", () => {
    const f = ownInstancesFilter({ accountId: "111122223333", connectionId: "conn-abc" });
    expect(f).toEqual([{ Name: `tag:${TAG_APP}`, Values: [APP_ID] }]);
  });
});

describe("invariants", () => {
  it("WireGuard is the single UDP port (DESIGN §1, §6)", () => {
    expect(WIREGUARD_PORT).toBe(51820);
  });
});
