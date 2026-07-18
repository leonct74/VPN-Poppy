#!/usr/bin/env node
/**
 * Manifest permission gate — run our extension.json's permissionSet through the REAL
 * `assessPermissionSet` from AgentsPoppy's core, and FAIL (exit 1) on any red (high)
 * finding. This is the P0 rating gate (DESIGN §5): VPN-Poppy must rate amber/green with
 * no beyond-own findings.
 *
 * It guards specifically against the family "substring trap" (DESIGN §5, VM-Poppy DR3):
 * the assessor matches mutating verbs by SUBSTRING, so `GetConsoleOutput` contains "put"
 * and reads as mutating — on a "*" scope that would rate RED. Placed in a tagged-as-self
 * grant it's a benign amber. If someone moves it, this gate catches it before install.
 *
 * Run from the repo root:  npm run assess-permissions
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(here, "..");

// AgentsPoppy is a sibling checkout; its core package holds the assessor the host uses.
const AGENTSPOPPY = process.env.AGENTSPOPPY_DIR || resolvePath(repoRoot, "..", "agentspoppy");
const ASSESSOR = pathToFileURL(join(AGENTSPOPPY, "packages", "core", "dist", "permissions.js")).href;

// Let Node resolve core's extensionless relative imports, then load the real assessor.
register(pathToFileURL(join(here, "lib", "append-js-loader.mjs")));
const { assessPermissionSet } = await import(ASSESSOR);

const manifest = JSON.parse(readFileSync(join(repoRoot, "extension.json"), "utf8"));
const ps = manifest.permissionSet;
const actionCount = ps.grants.reduce((n, g) => n + g.actions.length, 0);
const risk = assessPermissionSet(ps);

console.log(`VPN-Poppy permission set — ${ps.grants.length} grants, ${actionCount} actions`);
for (const { grant, risk: r } of risk.grants) {
  const mark = r.level === "high" ? "🔴" : r.level === "medium" ? "🟠" : "🟢";
  console.log(`  ${mark} [${r.level}] ${grant.service}:${grant.actions.join(",")} (${grant.resourceScope})`);
}
for (const w of risk.warnings) console.log(`  ⚠️  ${w}`);

const reds = risk.grants.filter((g) => g.risk.level === "high");
if (reds.length > 0) {
  console.error(`\n❌ ${reds.length} RED finding(s): a grant can mutate resources beyond its own. Tighten resourceScope.`);
  process.exit(1);
}
console.log(`\n✅ Overall: ${risk.level.toUpperCase()} — no red findings (no risks to other resources).`);
