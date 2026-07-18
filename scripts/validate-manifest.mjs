#!/usr/bin/env node
/**
 * Structural manifest gate — run extension.json through the REAL `parseManifest` from
 * AgentsPoppy's extension-sdk (the same validation the host performs on load), reporting
 * every problem at once. Exit 1 on failure, so it's CI-friendly.
 *
 * Uses the shared append-.js resolve hook because the extension-sdk is compiled with
 * extensionless relative imports that Node's ESM loader won't resolve unaided.
 *
 * Run from the repo root:  npm run validate-manifest
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(here, "..");
const AGENTSPOPPY = process.env.AGENTSPOPPY_DIR || resolvePath(repoRoot, "..", "agentspoppy");
const SDK = pathToFileURL(join(AGENTSPOPPY, "packages", "extension-sdk", "dist", "index.js")).href;

register(pathToFileURL(join(here, "lib", "append-js-loader.mjs")));
const { parseManifest } = await import(SDK);

try {
  parseManifest(readFileSync(join(repoRoot, "extension.json"), "utf8"));
  console.log("✅ extension.json OK");
} catch (e) {
  console.error("❌ extension.json invalid:\n" + (e?.message ?? String(e)));
  process.exit(1);
}
