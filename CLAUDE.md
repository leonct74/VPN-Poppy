# CLAUDE.md — VPN-Poppy

Operating guide for working in this repo. **`DESIGN.md` is the source of truth** — read it
fully before any work; when a design decision changes, update DESIGN.md in the same change.
Founder decisions live in DESIGN §11 and are final unless the founder revisits them.

> **Boundary:** VPN-Poppy is a standalone project that runs *on* AgentsPoppy (never forks
> it — FSL non-compete). The vm-poppy, mailpoppy and traffic-poppy repos are READ-ONLY
> reference material: copy patterns from them, never modify them from here.

## What this is

A personal VPN **on the fly** in the user's own AWS: one click → a WireGuard endpoint on a
t4g.nano (no SSH, one silent UDP port, all keys generated in-app) → QR/.conf for unlimited
devices → live cost meter → stop (EIP-backed) or teardown, or auto-teardown after N hours.
Free core + one premium: **Shielded DNS** (ad/tracker-blocking resolver, $14.99/yr).
Full rationale, locked decisions and phases P0–P4: `DESIGN.md` §11–13.

## Read these before coding (in order)

1. `DESIGN.md` (this repo) — the product, the no-SSH key ceremony, the locked decisions.
2. `~/Projects/agentspoppy/AGENTS.md` — the framework contract (rating rules, teardown,
   manifest, design kit, plain language, "Show the money"). Hard requirements.
3. Reference implementations to REUSE, not reinvent:
   - `~/Projects/vm-poppy` — **the primary template.** Repo layout (`frontend/ backend/
     scripts/`), manifest shape, SEA sidecar build (`scripts/build-sidecar.mjs` incl.
     `--win32`), `tags.ts` attribution/ownership, `amis.ts` per-region AMI resolve, the
     serial-console sentinel, launch/teardown/certify flow, `CopyButton`, DR1–DR6 lessons.
   - `~/Projects/agentspoppy/scripts/pack-extension.mjs` — packaging (darwin + win32);
     catalogue = `agentspoppy-web/src/data/catalog-seed.json` (founder pushes that).

## Non-negotiables (digest — AGENTS.md + DESIGN §11 are authoritative)

- **The no-SSH invariant.** The instance runs no SSH server, has no key pair, exposes ONLY
  UDP 51820. All WireGuard keys (server + devices + preshared) are generated **in the
  poppy backend on the user's machine**; the server sees its config once, via user-data.
  Any change that opens another port or adds a login path is a design regression —
  escalate to the founder, don't ship it.
- **Elastic IP lifecycle:** allocate at launch, associate, **release at teardown** —
  a leaked EIP bills forever and fails certify. Teardown = instance + SG + EIP, verified.
- **Honest costs everywhere** (AGENTS.md §9): hourly + IPv4 + live egress on the card;
  the Stop confirm carries "stopped still bills ≈$4/mo (kept IP + disk); teardown = $0".
  Rates from the Price List API — never hardcoded.
- **§1b privacy copy rules:** lead with what it protects (endpoint IP shown to sites,
  fresh per launch; tunnel-only to the local network; **no vendor in the path**); the
  load-bearing word is "private", not guaranteed "anonymity"; never market streaming
  unblocking. The only warning box is streaming/datacenter-IP + country availability.
- **Rating:** VM-Poppy-class amber; 18 EC2/CloudWatch actions = exactly the DR5 packed-
  policy ceiling that is PROVEN to vend. If STS or the assessor pushes back, defer
  `StopInstances`/`StartInstances` first. Verify against the REAL `assessPermissionSet`
  (substring trap: `GetConsoleOutput` contains "put" — survived in VM-Poppy, re-verify).
- Every create carries the three attribution tags; **teardown hook required** and
  `npm run certify` (leaves-no-trace, incl. the EIP) must pass a real
  deploy→use→teardown cycle **before any catalogue listing**.
- Design kit (`poppy.css`), plain language, `poppyAccent("com.vpnpoppy.desktop")`,
  type-to-confirm destructive actions, background+resume.

## Gotchas inherited from the poppy family (each cost real debugging time)

1. **🪤 Stale SEA sidecar masks backend changes.** After ANY backend change: rebuild the
   sidecar and fully restart the app, or you test old code. (Bit MailPoppy repeatedly.)
2. **Never `git add -A` after building binaries** — an 86 MB sidecar once landed in
   VM-Poppy's git history. `.gitignore` every artifact FIRST (`vpnpoppy-sidecar*`,
   `*.exe`, `release/`, `dist/`, generated bundles).
3. **Deterministic identity rule:** key generation uses the crypto RNG once at deploy and
   is persisted; nothing derives from `new Date()`; re-runs must never duplicate or
   silently regenerate identities (MailPoppy importer lesson, adapted).
4. **User-data is the whole server config** — it must be idempotent and self-contained;
   there is no second chance and no way in to fix a half-configured box. Test the script
   content with unit tests like vm-poppy's `userdata.test.ts`.
5. **WireGuard key interop:** X25519 keys must round-trip against the real `wg` tooling
   (base64, clamping) — unit-test against known vectors before any live launch.

## Working agreements (live AWS)

- **Explicit founder confirmation before any AWS command that creates/changes/deletes
  resources.** Read-only calls are fine.
- Live tests run in the founder's account → **tear down afterwards and verify clean**
  (instance, SG, EIP — the EIP is the new leak risk).
- Live tunnel acceptance (DESIGN §13 P1) needs the founder's phone — coordinate, don't
  simulate it away.
- The founder decides product questions; implementation questions get decided here and
  recorded in DESIGN.md.

## Commands (fill in as scaffolded — mirror vm-poppy's package.json)

- `npm install` · `npm run typecheck` · `npm run test` · `npm run build:sidecar`
  (+ `--win32`) · `npm run validate-manifest` · `npm run install-dev` · `npm run certify`

## Status

Design complete + locked (DESIGN §11, 2026-07-18). **Current phase: P0 — walking
skeleton** (scaffold → manifest vs real assessor → bare-instance launch + sentinel →
teardown incl. EIP → certify green → dev-install visible in AgentsPoppy).
Before the repo ever goes public: the pre-public checklist in
`agentspoppy/docs/ROADMAP.md` (history secret scan, FSL headers, no personal paths).
