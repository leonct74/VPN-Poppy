// WHERE VPN-Poppy's local files live — the one module allowed to answer that question.
//
// Two kinds of state persist on this machine and BOTH matter more than usual:
//  - `deployments/<instanceId>.json` (keystore.ts): the DEVICE PRIVATE KEYS, 0600. Lose
//    them and every issued QR/.conf is unrecoverable.
//  - `regions.json` (store.ts): the pointer the TEARDOWN SWEEP reads (AGENTS.md §4).
//    Lose it and teardown silently misses regions — the leaves-no-trace guarantee breaks
//    without an error anywhere.
//
// Since 0.1.8 both live in the data folder the AgentsPoppy host hands this backend in its
// bootstrap (`dataDir`, normally ~/.agentspoppy/extension-data/com.vpnpoppy.desktop), not
// in ~/.vpnpoppy. The backend is being CONFINED (0.1.9 will declare
// `backend.isolation: "strict"`): Node's permission model then lets it read only its
// install folder and write only `dataDir` + the OS temp dir — the home directory,
// ~/.aws included, is off-limits BY THE RUNTIME.
//
//  - `initStorage(dataDir)` must run once at boot, before any route. It also performs a
//    ONE-TIME, idempotent, per-file copy of a pre-0.1.8 ~/.vpnpoppy into the data folder.
//    That copy can only succeed while the backend is still unconfined — which is why
//    0.1.8 ships WITHOUT the isolation flag and 0.1.9 flips it (the VM-Poppy 0.1.11 →
//    0.1.12 pattern). The old folder is never deleted.
//
//  🪤 Under `--permission`, `fs.existsSync` on a DENIED path THROWS ERR_ACCESS_DENIED
//    instead of returning false (measured, 2026-08-16). Every existence probe goes
//    through `exists()` — otherwise "nothing saved yet" becomes a 500, and worse,
//    the teardown sweep's region list quietly reads as empty.

import { mkdirSync, existsSync, readdirSync, copyFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The pre-0.1.8 location. Read (once, for migration) — never written again. */
export const LEGACY_HOME = join(homedir(), ".vpnpoppy");

let home: string | null = null;

/**
 * Point storage at the host's data folder. `VPNPOPPY_HOME` still overrides (tests, dev
 * runs outside the host). Falls back to the legacy folder only when the host sent no
 * dataDir at all — an AgentsPoppy older than 0.3.x, which is also one too old to confine
 * us, so the writes still work there.
 */
export function initStorage(dataDir: string | undefined, legacy = LEGACY_HOME): { home: string; migrated: string[] } {
  home = process.env.VPNPOPPY_HOME || dataDir || legacy;
  const migrated = home === legacy ? [] : migrateLegacyHome(home, legacy);
  return { home, migrated };
}

/** The folder every other module builds its paths from. Throws if initStorage never ran. */
export function storageHome(): string {
  if (!home) throw new Error("VPN-Poppy storage was used before initStorage() — this is a bug in the backend.");
  return home;
}

/** `existsSync` that can't throw — see the 🪤 note at the top. */
export function exists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Copy a pre-0.1.8 ~/.vpnpoppy into the new home, once: `regions.json` and every
 * `deployments/*.json` (0600 — they hold device private keys). Per-file and never
 * overwriting, so re-running is a no-op and newer data in the new home always wins.
 * Swallows everything — a denied read (confined backend), a missing legacy folder, one
 * unreadable file — none may stop the backend. Returns the relative names copied.
 */
export function migrateLegacyHome(target: string, legacy = LEGACY_HOME): string[] {
  const copied: string[] = [];
  try {
    if (!exists(legacy) || target === legacy) return copied;
    mkdirSync(target, { recursive: true });
    const legacyRegions = join(legacy, "regions.json");
    const newRegions = join(target, "regions.json");
    if (exists(legacyRegions) && !exists(newRegions)) {
      copyFileSync(legacyRegions, newRegions);
      copied.push("regions.json");
    }
    const legacyDeps = join(legacy, "deployments");
    if (exists(legacyDeps)) {
      const newDeps = join(target, "deployments");
      mkdirSync(newDeps, { recursive: true });
      for (const name of readdirSync(legacyDeps)) {
        if (!name.endsWith(".json")) continue;
        const dest = join(newDeps, name);
        if (exists(dest)) continue;
        try {
          copyFileSync(join(legacyDeps, name), dest);
          chmodSync(dest, 0o600);
          copied.push(`deployments/${name}`);
        } catch {
          /* one unreadable file must not stop the others */
        }
      }
    }
  } catch {
    /* migration is best-effort, never fatal */
  }
  return copied;
}
