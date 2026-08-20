// Local persistence of per-endpoint WireGuard key material, so the user can re-show a
// device's QR later (including after an app restart) — DESIGN §3.3.
//
// This is the ONLY place device private keys live: the endpoint box only ever receives
// device PUBLIC keys (in its baked wg0.conf). We do NOT persist the server private key —
// it's baked into user-data at launch and never needed again by the poppy. Files live
// under ~/.vpnpoppy/deployments, 0600, mirroring vm-poppy's key custody (DESIGN §8).
//
// Keyed by the AWS instance id (never a wall-clock value), so re-runs can't duplicate or
// silently regenerate identities (CLAUDE.md gotcha #3).

import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { exists, storageHome } from "./storage";
import type { DevicePeer } from "./wireguard";

// Where "here" is (and the one-time move out of ~/.vpnpoppy) lives in storage.ts.
function deploymentsDir(): string {
  return join(storageHome(), "deployments");
}

/** The persisted record for one launched endpoint (no server private key — see file note). */
export interface Deployment {
  instanceId: string;
  region: string;
  serverPublicKey: string;
  devices: DevicePeer[];
  /** ISO timestamp for display only (not identity). */
  createdAt: string;
}

function deploymentPath(instanceId: string): string {
  return join(deploymentsDir(), `${instanceId}.json`);
}

export function saveDeployment(d: Deployment): void {
  mkdirSync(deploymentsDir(), { recursive: true });
  const path = deploymentPath(d.instanceId);
  writeFileSync(path, JSON.stringify(d, null, 2));
  chmodSync(path, 0o600); // device private keys — owner-only
}

export function loadDeployment(instanceId: string): Deployment | null {
  const path = deploymentPath(instanceId);
  if (!exists(path)) return null; // exists(): under --permission existsSync THROWS on a denied path
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Deployment;
  } catch {
    return null;
  }
}

export function deleteDeployment(instanceId: string): void {
  rmSync(deploymentPath(instanceId), { force: true });
}

export function listDeploymentIds(): string[] {
  if (!exists(deploymentsDir())) return [];
  return readdirSync(deploymentsDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}

/** Rename one device in a saved deployment (frontend "rename" — persists the label). */
export function renameDevice(instanceId: string, deviceIndex: number, name: string): Deployment | null {
  const d = loadDeployment(instanceId);
  if (!d || !d.devices[deviceIndex]) return null;
  d.devices[deviceIndex]!.name = name;
  saveDeployment(d);
  return d;
}
