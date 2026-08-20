// Tiny local pointer store: which AWS regions VPN-Poppy has launched endpoints into.
//
// We do NOT persist endpoint state — live state is always read from EC2 (AGENTS.md §5).
// We persist only the POINTER: the set of regions to look in, so that after an app
// restart the UI can still find an endpoint launched in a non-home region, and the
// teardown hook can sweep every region it ever touched (the leaves-no-trace guarantee,
// AGENTS.md §4). Lives under ~/.vpnpoppy so nothing extra is provisioned in AWS.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exists, storageHome } from "./storage";

// Where "here" is (and the one-time move out of ~/.vpnpoppy) lives in storage.ts. This
// file feeds the TEARDOWN SWEEP — losing it silently is a broken leaves-no-trace, which
// is exactly what confining the old ~/.vpnpoppy path would have done.
function regionsFile(): string {
  return join(storageHome(), "regions.json");
}

/** Regions we've launched into (persisted). Empty if nothing has been launched yet. */
export function loadUsedRegions(): string[] {
  if (!exists(regionsFile())) return []; // exists(): existsSync THROWS on a denied path
  try {
    const parsed = JSON.parse(readFileSync(regionsFile(), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

/** Remember that we've launched into `region` (idempotent). */
export function rememberRegion(region: string): void {
  const all = new Set(loadUsedRegions());
  if (all.has(region)) return;
  all.add(region);
  mkdirSync(storageHome(), { recursive: true });
  writeFileSync(regionsFile(), JSON.stringify([...all], null, 2));
}
