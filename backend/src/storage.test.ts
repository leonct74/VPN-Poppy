// Storage moved out of ~/.vpnpoppy into the host's data folder (0.1.8) so the backend can
// be confined (0.1.9). These pin: the one-time move (copies regions.json + every
// deployments/*.json 0600; never overwrites, never deletes; re-running is a no-op); that
// every probe survives the permission model's existsSync-THROWS behaviour; and the two
// consumers — the keystore (device private keys) and the region pointer that feeds the
// leaves-no-trace teardown sweep. Every test injects its own legacy folder.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exists, initStorage, migrateLegacyHome } from "./storage";
import { listDeploymentIds, loadDeployment, saveDeployment, type Deployment } from "./keystore";
import { loadUsedRegions, rememberRegion } from "./store";

// The permission model makes existsSync THROW on a denied path. Flip `denied.on` to
// simulate that without touching the real filesystem.
const denied = vi.hoisted(() => ({ on: false }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    existsSync: (p: Parameters<typeof real.existsSync>[0]) => {
      if (denied.on) throw Object.assign(new Error("Access to this API has been restricted"), { code: "ERR_ACCESS_DENIED" });
      return real.existsSync(p);
    },
  };
});

const dep = (id: string): Deployment => ({
  instanceId: id,
  region: "eu-west-1",
  serverPublicKey: "spk",
  devices: [{ name: "phone", privateKey: "priv", publicKey: "pub", address: "10.8.0.2/32" } as Deployment["devices"][number]],
  createdAt: "2026-08-20T00:00:00.000Z",
});

let dataDir: string;
let legacy: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "vpnpoppy-data-"));
  legacy = mkdtempSync(join(tmpdir(), "vpnpoppy-legacy-"));
  delete process.env.VPNPOPPY_HOME;
  denied.on = false;
});
afterEach(() => {
  denied.on = false;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(legacy, { recursive: true, force: true });
});

describe("storage lives in the host's data folder", () => {
  it("keystore writes deployments INSIDE dataDir, 0600, and reads them back", () => {
    initStorage(dataDir, legacy);
    saveDeployment(dep("i-abc"));
    const p = join(dataDir, "deployments", "i-abc.json");
    expect(statSync(p).mode & 0o777).toBe(0o600); // device private keys — owner-only
    expect(loadDeployment("i-abc")?.serverPublicKey).toBe("spk");
    expect(listDeploymentIds()).toEqual(["i-abc"]);
    expect(loadDeployment("i-missing")).toBeNull();
  });

  it("the region pointer round-trips from dataDir and is idempotent", () => {
    initStorage(dataDir, legacy);
    expect(loadUsedRegions()).toEqual([]);
    rememberRegion("eu-west-1");
    rememberRegion("us-east-1");
    rememberRegion("eu-west-1");
    expect(loadUsedRegions().sort()).toEqual(["eu-west-1", "us-east-1"]);
    expect(JSON.parse(readFileSync(join(dataDir, "regions.json"), "utf8"))).toHaveLength(2);
  });

  it("VPNPOPPY_HOME still overrides (tests, dev runs)", () => {
    const override = mkdtempSync(join(tmpdir(), "vpnpoppy-override-"));
    try {
      process.env.VPNPOPPY_HOME = override;
      expect(initStorage(dataDir, legacy).home).toBe(override);
    } finally {
      rmSync(override, { recursive: true, force: true });
    }
  });
});

describe("the one-time move out of ~/.vpnpoppy", () => {
  function seedLegacy() {
    mkdirSync(join(legacy, "deployments"), { recursive: true });
    writeFileSync(join(legacy, "regions.json"), JSON.stringify(["eu-west-1", "us-east-1"]));
    writeFileSync(join(legacy, "deployments", "i-old1.json"), JSON.stringify(dep("i-old1")));
    writeFileSync(join(legacy, "deployments", "i-old2.json"), JSON.stringify(dep("i-old2")));
    writeFileSync(join(legacy, "deployments", "notes.txt"), "not a deployment");
  }

  it("copies regions.json and every deployments/*.json, 0600, old folder untouched", () => {
    seedLegacy();
    const moved = migrateLegacyHome(dataDir, legacy);
    expect(moved.sort()).toEqual(["deployments/i-old1.json", "deployments/i-old2.json", "regions.json"]);
    expect(statSync(join(dataDir, "deployments", "i-old1.json")).mode & 0o777).toBe(0o600);
    expect(exists(join(dataDir, "deployments", "notes.txt"))).toBe(false);
    expect(exists(join(legacy, "regions.json"))).toBe(true); // never deleted
  });

  it("the TEARDOWN SWEEP sees the migrated regions — the failure that must never be silent", () => {
    seedLegacy();
    initStorage(dataDir, legacy);
    expect(loadUsedRegions().sort()).toEqual(["eu-west-1", "us-east-1"]);
    expect(loadDeployment("i-old1")?.instanceId).toBe("i-old1"); // and old QR/.conf re-show works
  });

  it("is idempotent and never overwrites newer data in the new home", () => {
    seedLegacy();
    mkdirSync(join(dataDir, "deployments"), { recursive: true });
    writeFileSync(join(dataDir, "regions.json"), JSON.stringify(["ap-south-1"]));
    writeFileSync(join(dataDir, "deployments", "i-old1.json"), JSON.stringify(dep("i-newer")));
    const first = migrateLegacyHome(dataDir, legacy);
    expect(first).toEqual(["deployments/i-old2.json"]); // only what was missing
    expect(readFileSync(join(dataDir, "regions.json"), "utf8")).toContain("ap-south-1");
    expect(JSON.parse(readFileSync(join(dataDir, "deployments", "i-old1.json"), "utf8")).instanceId).toBe("i-newer");
    expect(migrateLegacyHome(dataDir, legacy)).toEqual([]); // second run: nothing to do
  });

  it("a missing legacy folder, target == legacy, or no dataDir → quiet no-op", () => {
    expect(migrateLegacyHome(dataDir, join(legacy, "nope"))).toEqual([]);
    expect(migrateLegacyHome(legacy, legacy)).toEqual([]);
    const r = initStorage(undefined, legacy);
    expect(r.home).toBe(legacy);
    expect(r.migrated).toEqual([]);
  });
});

describe("the permission model's existsSync throws — nothing here propagates it", () => {
  it("exists() is false, keystore reads are null/[], the region list is [] — not 500s", () => {
    initStorage(dataDir, legacy);
    saveDeployment(dep("i-abc"));
    rememberRegion("eu-west-1");
    denied.on = true;
    expect(exists("/Users/someone/.aws/credentials")).toBe(false);
    expect(loadDeployment("i-abc")).toBeNull();
    expect(listDeploymentIds()).toEqual([]);
    expect(loadUsedRegions()).toEqual([]);
  });

  it("a confined migration (legacy denied) is a no-op, not a crash", () => {
    denied.on = true;
    expect(migrateLegacyHome(dataDir, legacy)).toEqual([]);
    expect(initStorage(dataDir, legacy).migrated).toEqual([]);
  });
});
