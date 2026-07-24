#!/usr/bin/env node
// Bundle the VPN-Poppy backend into the single CJS file AgentsPoppy's SHARED Node
// runtime executes (extension.json backend.runtime "node22" — see the agentspoppy
// repo's docs/RUNTIMES.md). This replaces the retired SEA pipeline
// (build-sidecar.mjs): the package ships ~3MB of the poppy's own code and NO
// embedded Node — the platform provides the runtime.
import * as esbuild from "esbuild";
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outfile = join(root, "backend", "index.cjs");

await esbuild.build({
  entryPoints: [join(root, "backend", "src", "server.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile,
  logLevel: "warning",
});
console.log(`✅ backend bundle → ${outfile} (${(statSync(outfile).size / 1024 / 1024).toFixed(1)} MB)`);
