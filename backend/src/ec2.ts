// The EC2 service — all AWS mutations VPN-Poppy makes. Everything it creates is stamped
// with the three attribution tags at creation, and every change/delete is naturally
// limited to our own tagged resources by the broker's session policy. See DESIGN.md §2–§6.
//
// The no-SSH invariant (CLAUDE.md, DESIGN §3) is enforced HERE by omission: no key pair is
// ever created, and the only ingress rule opened is UDP 51820 (WireGuard). There is no
// stop/start — the lifecycle is running or gone (DESIGN §11.4).

import {
  EC2Client,
  RunInstancesCommand,
  DescribeInstancesCommand,
  TerminateInstancesCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  DeleteSecurityGroupCommand,
  DescribeSecurityGroupsCommand,
  DescribeImagesCommand,
  DescribeVpcsCommand,
  GetConsoleOutputCommand,
  type _InstanceType,
} from "@aws-sdk/client-ec2";
import { resolveUbuntuAmi } from "./amis";
import {
  attributionTags,
  ownInstancesFilter,
  tagValue,
  APP_ID,
  TAG_APP,
  TAG_NAME,
  TAG_REGION,
  TAG_LIFECYCLE,
} from "./tags";
import { generateUserData } from "./userdata";
import { READY_SENTINEL, WIREGUARD_PORT, type EndpointConfig, type EndpointStatus, type EndpointSummary } from "./types";

export interface Ec2Context {
  accountId: string;
  connectionId: string;
  region: string;
}

function shortId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export class Ec2Service {
  constructor(private readonly ec2: EC2Client, private readonly ctx: Ec2Context) {}

  private attrTags() {
    return attributionTags({ accountId: this.ctx.accountId, connectionId: this.ctx.connectionId });
  }

  // ---- Launch --------------------------------------------------------------

  async launch(config: EndpointConfig): Promise<EndpointSummary> {
    const imageId = await resolveUbuntuAmi(this.ec2, config.arch);
    const rootDeviceName = await this.rootDeviceName(imageId);
    const vpcId = await this.resolveDefaultVpcId();
    const tag = shortId();
    const securityGroupId = await this.createSecurityGroup(config, vpcId, tag);

    const userData = generateUserData({ config });
    const name = config.name?.trim() || "VPN endpoint";
    const lifecycle = config.autoTeardownHours && config.autoTeardownHours > 0 ? "ephemeral" : "persistent";
    const resourceTags = [
      ...this.attrTags(),
      { Key: TAG_NAME, Value: name },
      { Key: TAG_REGION, Value: config.region },
      { Key: TAG_LIFECYCLE, Value: lifecycle },
    ];

    const res = await this.ec2.send(
      new RunInstancesCommand({
        ImageId: imageId,
        InstanceType: config.instanceType as _InstanceType,
        MinCount: 1,
        MaxCount: 1,
        // NO KeyName — the no-SSH invariant. Nothing can log into this box.
        SecurityGroupIds: [securityGroupId],
        UserData: Buffer.from(userData, "utf8").toString("base64"),
        // A TTL shutdown must terminate (not stop) — "running or gone", never a stopped
        // box quietly billing its disk (DESIGN §11.4).
        InstanceInitiatedShutdownBehavior: "terminate",
        BlockDeviceMappings: [
          {
            DeviceName: rootDeviceName,
            Ebs: { VolumeSize: 8, VolumeType: "gp3", DeleteOnTermination: true, Encrypted: true },
          },
        ],
        TagSpecifications: [
          { ResourceType: "instance", Tags: resourceTags },
          { ResourceType: "volume", Tags: resourceTags },
        ],
      }),
    );

    const inst = res.Instances?.[0];
    if (!inst?.InstanceId) throw new Error("EC2 did not return a launched endpoint.");
    return this.toSummary(inst);
  }

  private async rootDeviceName(imageId: string): Promise<string> {
    const res = await this.ec2.send(new DescribeImagesCommand({ ImageIds: [imageId] }));
    return res.Images?.[0]?.RootDeviceName ?? "/dev/sda1";
  }

  private async resolveDefaultVpcId(): Promise<string> {
    const res = await this.ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: "isDefault", Values: ["true"] }] }));
    const vpc = res.Vpcs?.[0]?.VpcId;
    if (!vpc) throw new Error("No default VPC in this region, so there's nowhere to place the endpoint. Try another region.");
    return vpc;
  }

  private async createSecurityGroup(config: EndpointConfig, vpcId: string, tag: string): Promise<string> {
    const res = await this.ec2.send(
      new CreateSecurityGroupCommand({
        GroupName: `vpnpoppy-${tag}`,
        Description: `VPN-Poppy endpoint (WireGuard UDP ${WIREGUARD_PORT} only)`,
        VpcId: vpcId,
        TagSpecifications: [
          { ResourceType: "security-group", Tags: [...this.attrTags(), { Key: TAG_NAME, Value: config.name?.trim() || "VPN endpoint" }] },
        ],
      }),
    );
    const sgId = res.GroupId;
    if (!sgId) throw new Error("Failed to create the endpoint's firewall.");

    // The ONE and only ingress rule: WireGuard's single UDP port, open to the internet so
    // your devices can reach it from anywhere. WireGuard is silent to unauthenticated
    // packets, so the box is invisible to port scans (DESIGN §1, §6). No SSH, no TCP.
    await this.ec2.send(
      new AuthorizeSecurityGroupIngressCommand({
        GroupId: sgId,
        IpPermissions: [
          {
            IpProtocol: "udp",
            FromPort: WIREGUARD_PORT,
            ToPort: WIREGUARD_PORT,
            IpRanges: [{ CidrIp: "0.0.0.0/0", Description: "WireGuard" }],
          },
        ],
      }),
    );
    return sgId;
  }

  // ---- List / status -------------------------------------------------------

  async listEndpoints(): Promise<EndpointSummary[]> {
    const res = await this.ec2.send(
      new DescribeInstancesCommand({ Filters: ownInstancesFilter({ accountId: this.ctx.accountId, connectionId: this.ctx.connectionId }) }),
    );
    const out: EndpointSummary[] = [];
    for (const r of res.Reservations ?? []) {
      for (const inst of r.Instances ?? []) {
        if ((inst.State?.Name ?? "") === "terminated") continue;
        out.push(this.toSummary(inst));
      }
    }
    return out.sort((a, b) => (b.launchedAt ?? "").localeCompare(a.launchedAt ?? ""));
  }

  /** Readiness for one endpoint: has the first-boot script printed the sentinel yet? */
  async status(instanceId: string): Promise<EndpointStatus> {
    const inst = await this.getOwnInstance(instanceId);
    const state = inst.State?.Name ?? "unknown";
    if (state !== "running") return { state, ready: false };
    const res = await this.ec2.send(new GetConsoleOutputCommand({ InstanceId: instanceId, Latest: true })).catch(() => null);
    const text = res?.Output ? Buffer.from(res.Output, "base64").toString("utf8") : "";
    return { state, ready: text.includes(READY_SENTINEL) };
  }

  // ---- Teardown ------------------------------------------------------------

  /** Tear down ONE endpoint: terminate it, then best-effort clean its security group. */
  async teardownEndpoint(instanceId: string): Promise<void> {
    const inst = await this.getOwnInstance(instanceId);
    await this.ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
    const sgId = inst.SecurityGroups?.[0]?.GroupId;
    void this.deleteSecurityGroupWithRetry(sgId);
  }

  /**
   * The host teardown hook (DESIGN §4): terminate every endpoint this APP created, wait
   * for them to go, then sweep + delete every security group still tagged as ours.
   * Idempotent — it may run more than once, including after a partial teardown.
   */
  async teardown(): Promise<{ terminated: string[]; securityGroups: string[] }> {
    const instances = await this.listOwnInstancesRaw();
    const instanceIds = instances.map((i) => i.InstanceId!).filter(Boolean);
    const sgIds = new Set<string>();
    for (const i of instances) for (const sg of i.SecurityGroups ?? []) if (sg.GroupId) sgIds.add(sg.GroupId);

    if (instanceIds.length > 0) {
      await this.ec2.send(new TerminateInstancesCommand({ InstanceIds: instanceIds }));
      await this.waitTerminated(instanceIds);
    }

    // Also sweep any of this APP's tagged SGs not attached to a listed instance (app-scoped,
    // so SGs from a superseded connection are included too — see ownInstancesFilter).
    const taggedSgs = await this.ec2.send(
      new DescribeSecurityGroupsCommand({ Filters: [{ Name: `tag:${TAG_APP}`, Values: [APP_ID] }] }),
    );
    for (const sg of taggedSgs.SecurityGroups ?? []) if (sg.GroupId) sgIds.add(sg.GroupId);

    const deletedSgs: string[] = [];
    for (const id of sgIds) if (await this.deleteSecurityGroupWithRetry(id)) deletedSgs.push(id);
    return { terminated: instanceIds, securityGroups: deletedSgs };
  }

  /** Delete a security group, retrying while it's still "in use" by a terminating instance. */
  private async deleteSecurityGroupWithRetry(sgId?: string, attempts = 24, delayMs = 5000): Promise<boolean> {
    if (!sgId) return false;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.ec2.send(new DeleteSecurityGroupCommand({ GroupId: sgId }));
        return true;
      } catch (e) {
        // The ENI detaches a few seconds AFTER the instance reaches "terminated", so the SG
        // stays "in use" briefly — retry on DependencyViolation, give up on anything else
        // (already gone / not found).
        if ((e as { name?: string })?.name !== "DependencyViolation") return false;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return false;
  }

  private async waitTerminated(instanceIds: string[]): Promise<void> {
    for (let i = 0; i < 60; i++) {
      const res = await this.ec2.send(new DescribeInstancesCommand({ InstanceIds: instanceIds }));
      const states = (res.Reservations ?? []).flatMap((r) => r.Instances ?? []).map((x) => x.State?.Name);
      if (states.every((s) => s === "terminated")) return;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // ---- helpers -------------------------------------------------------------

  private async listOwnInstancesRaw() {
    const res = await this.ec2.send(
      new DescribeInstancesCommand({ Filters: ownInstancesFilter({ accountId: this.ctx.accountId, connectionId: this.ctx.connectionId }) }),
    );
    return (res.Reservations ?? []).flatMap((r) => r.Instances ?? []).filter((i) => (i.State?.Name ?? "") !== "terminated");
  }

  /** Fetch one instance and CONFIRM it belongs to THIS APP before acting on it. Scoped to
   *  the app tag (not the connection id) so an endpoint from a superseded connection is
   *  still manageable — and the brokered creds are app-scoped anyway, so AWS enforces the
   *  same boundary. */
  private async getOwnInstance(instanceId: string) {
    const res = await this.ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    const inst = (res.Reservations ?? []).flatMap((r) => r.Instances ?? [])[0];
    if (!inst) throw new Error(`Endpoint ${instanceId} not found.`);
    if (tagValue(inst.Tags, TAG_APP) !== APP_ID) throw new Error("That instance isn't one VPN-Poppy created.");
    return inst;
  }

  private toSummary(inst: {
    InstanceId?: string;
    State?: { Name?: string };
    InstanceType?: string;
    PublicIpAddress?: string;
    LaunchTime?: Date;
    Tags?: { Key?: string; Value?: string }[];
  }): EndpointSummary {
    return {
      instanceId: inst.InstanceId ?? "",
      name: tagValue(inst.Tags, TAG_NAME) ?? "VPN endpoint",
      region: tagValue(inst.Tags, TAG_REGION) ?? this.ctx.region,
      state: inst.State?.Name ?? "unknown",
      instanceType: inst.InstanceType ?? "",
      publicIp: inst.PublicIpAddress,
      launchedAt: inst.LaunchTime ? new Date(inst.LaunchTime).toISOString() : undefined,
    };
  }
}
