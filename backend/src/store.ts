// Tiny local pointer store: which AWS regions VPN-Poppy has launched endpoints into.
//
// We do NOT persist endpoint state — live state is always read from EC2 (AGENTS.md §5).
// We persist only the POINTER: the set of regions to look in, so that after an app
// restart the UI can still find an endpoint launched in a non-home region, and the
// teardown hook can sweep every region it ever touched (the leaves-no-trace guarantee,
// AGENTS.md §4). Lives under ~/.vpnpoppy so nothing extra is provisioned in AWS.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env.VPNPOPPY_HOME || join(homedir(), ".vpnpoppy");
const REGIONS_FILE = join(HOME, "regions.json");

/** Regions we've launched into (persisted). Empty if nothing has been launched yet. */
export function loadUsedRegions(): string[] {
  if (!existsSync(REGIONS_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(REGIONS_FILE, "utf8"));
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
  mkdirSync(HOME, { recursive: true });
  writeFileSync(REGIONS_FILE, JSON.stringify([...all], null, 2));
}
