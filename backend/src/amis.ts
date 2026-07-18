// Resolve the latest Ubuntu 24.04 LTS AMI for the endpoint's architecture, using
// ec2:DescribeImages (already in our permission set — no SSM grant needed). We filter by
// Canonical's owner id + name pattern and pick the newest. See DESIGN.md §2.
//
// Ubuntu 24.04 ships WireGuard in its kernel and repos, so P1's user-data needs no PPAs.

import { DescribeImagesCommand, type EC2Client } from "@aws-sdk/client-ec2";

const CANONICAL_OWNER = "099720109477"; // Canonical (Ubuntu)

/** How Canonical names each architecture in its AMI names. */
function archToken(arch: "arm64" | "x86_64"): string {
  return arch === "arm64" ? "arm64" : "amd64";
}

export async function resolveUbuntuAmi(ec2: EC2Client, arch: "arm64" | "x86_64"): Promise<string> {
  const name = `ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${archToken(arch)}-server-*`;
  const res = await ec2.send(
    new DescribeImagesCommand({
      Owners: [CANONICAL_OWNER],
      Filters: [
        { Name: "name", Values: [name] },
        { Name: "state", Values: ["available"] },
        { Name: "architecture", Values: [arch] },
        { Name: "root-device-type", Values: ["ebs"] },
        { Name: "virtualization-type", Values: ["hvm"] },
      ],
    }),
  );
  const images = (res.Images ?? [])
    .filter((i) => i.ImageId && i.CreationDate)
    .sort((a, b) => (b.CreationDate! < a.CreationDate! ? -1 : 1));
  const latest = images[0]?.ImageId;
  if (!latest) {
    throw new Error(`No Ubuntu 24.04 (${arch}) image found in this region. Try another region.`);
  }
  return latest;
}
