import { describe, it, expect } from "vitest";
import { generateUserData } from "./userdata";
import { attributionTags, ownInstancesFilter, tagValue, APP_ID, TAG_APP, TAG_ACCOUNT, TAG_CONNECTION } from "./tags";
import { READY_SENTINEL, WIREGUARD_PORT, type EndpointConfig } from "./types";

const base: EndpointConfig = {
  region: "eu-central-1",
  instanceType: "t4g.nano",
  arch: "arm64",
  deviceSlots: 10,
};

describe("generateUserData — P0 skeleton", () => {
  it("is a bash script that prints the readiness sentinel to the serial console", () => {
    const ud = generateUserData({ config: base });
    expect(ud.startsWith("#!/bin/bash")).toBe(true);
    expect(ud).toContain(`echo "${READY_SENTINEL}" | tee /dev/console`);
  });

  it("has NO SSH, no login, no extra ports baked into the boot script (no-SSH invariant)", () => {
    const ud = generateUserData({ config: base }).toLowerCase();
    expect(ud).not.toContain("sshd");
    expect(ud).not.toContain("authorized_keys");
    expect(ud).not.toContain("ssh-rsa");
  });

  it("schedules a TTL self-destruct only when autoTeardownHours is set", () => {
    expect(generateUserData({ config: base })).not.toContain("shutdown -h");
    const ttl = generateUserData({ config: { ...base, autoTeardownHours: 8 } });
    // 8h → 480 min
    expect(ttl).toContain('shutdown -h +480 "VPN-Poppy auto-teardown"');
  });

  it("rounds fractional TTL hours to at least one minute", () => {
    const ud = generateUserData({ config: { ...base, autoTeardownHours: 0.01 } });
    expect(ud).toContain("shutdown -h +1 ");
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
