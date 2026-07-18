import { describe, it, expect } from "vitest";
import { Ec2Service } from "./ec2";
import { TAG_APP, TAG_NAME, TAG_REGION } from "./tags";

// A tiny fake EC2 client that records every command it's sent and answers with the
// minimum each step of launch() needs. Keyed by the command's constructor name so we can
// both drive the flow and assert on what was (and wasn't) called.
function fakeEc2() {
  const sent: { name: string; input: any }[] = [];
  const client = {
    send(cmd: any) {
      const name = cmd.constructor.name;
      sent.push({ name, input: cmd.input });
      switch (name) {
        case "DescribeImagesCommand":
          return Promise.resolve({ Images: [{ ImageId: "ami-123", CreationDate: "2026-01-01", RootDeviceName: "/dev/sda1" }] });
        case "DescribeVpcsCommand":
          return Promise.resolve({ Vpcs: [{ VpcId: "vpc-123" }] });
        case "CreateSecurityGroupCommand":
          return Promise.resolve({ GroupId: "sg-123" });
        case "AuthorizeSecurityGroupIngressCommand":
          return Promise.resolve({});
        case "RunInstancesCommand":
          return Promise.resolve({
            Instances: [{ InstanceId: "i-123", State: { Name: "pending" }, InstanceType: "t4g.nano", LaunchTime: new Date("2026-07-18T00:00:00Z") }],
          });
        default:
          return Promise.resolve({});
      }
    },
  };
  return { client: client as any, sent };
}

const ctx = { accountId: "111122223333", connectionId: "conn-abc", region: "eu-central-1" };

describe("Ec2Service.launch — the no-SSH invariant", () => {
  it("NEVER creates a key pair and passes NO KeyName to RunInstances", async () => {
    const { client, sent } = fakeEc2();
    await new Ec2Service(client, ctx).launch({ region: "eu-central-1", instanceType: "t4g.nano", arch: "arm64", deviceSlots: 10 });

    expect(sent.some((c) => c.name === "CreateKeyPairCommand")).toBe(false);
    const run = sent.find((c) => c.name === "RunInstancesCommand");
    expect(run).toBeDefined();
    expect(run!.input.KeyName).toBeUndefined();
  });

  it("opens EXACTLY one ingress rule — UDP 51820 — and nothing else", async () => {
    const { client, sent } = fakeEc2();
    await new Ec2Service(client, ctx).launch({ region: "eu-central-1", instanceType: "t4g.nano", arch: "arm64", deviceSlots: 10 });

    const auth = sent.filter((c) => c.name === "AuthorizeSecurityGroupIngressCommand");
    expect(auth).toHaveLength(1);
    const perms = auth[0]!.input.IpPermissions;
    expect(perms).toHaveLength(1);
    expect(perms[0]).toMatchObject({ IpProtocol: "udp", FromPort: 51820, ToPort: 51820 });
    expect(perms[0].IpRanges[0].CidrIp).toBe("0.0.0.0/0");
  });

  it("terminates a TTL'd launch on shutdown (running-or-gone, never a stopped box)", async () => {
    const { client, sent } = fakeEc2();
    await new Ec2Service(client, ctx).launch({ region: "eu-central-1", instanceType: "t4g.nano", arch: "arm64", deviceSlots: 10, autoTeardownHours: 8 });
    const run = sent.find((c) => c.name === "RunInstancesCommand")!;
    expect(run.input.InstanceInitiatedShutdownBehavior).toBe("terminate");
  });

  it("stamps the attribution + region tags on the instance", async () => {
    const { client, sent } = fakeEc2();
    await new Ec2Service(client, ctx).launch({ region: "eu-central-1", instanceType: "t4g.nano", arch: "arm64", deviceSlots: 10, name: "Frankfurt" });
    const run = sent.find((c) => c.name === "RunInstancesCommand")!;
    const instTags = run.input.TagSpecifications.find((t: any) => t.ResourceType === "instance").Tags;
    const byKey = (k: string) => instTags.find((t: any) => t.Key === k)?.Value;
    expect(byKey(TAG_APP)).toBe("com.vpnpoppy.desktop");
    expect(byKey(TAG_REGION)).toBe("eu-central-1");
    expect(byKey(TAG_NAME)).toBe("Frankfurt");
  });
});
