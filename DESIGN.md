# VPN-Poppy — DESIGN

A personal VPN **on the fly**, in your own AWS. Pick a region, one click, ~60 seconds later
your phone and laptop are tunnelling through a WireGuard endpoint that only you control —
and that self-destructs when you're done.

An [AgentsPoppy](https://agentspoppy.com) poppy. Status: **§14**. Source of truth for all
product/architecture decisions; update this file when a decision changes.

---

## 1. Positioning — why this beats a VPN subscription

- **No VPN company in the path.** A commercial VPN moves your trust from your ISP to a
  vendor who sees *all* your traffic. VPN-Poppy's endpoint runs in your own AWS account —
  there is **no third party** in the data path at all.
- **On the fly, pay cents.** Ephemeral by default: spin up an endpoint for the airport /
  hotel / café session, tear it down after. A t4g.nano is **~$0.004/hour** — an evening of
  safe browsing costs about a cent plus data transfer. No $5–13/month subscription.
- **A server nobody can enter — including you.** The instance runs **no SSH, no exposed
  ports except WireGuard's single UDP port**, and WireGuard is silent to unauthenticated
  packets (the box is invisible to port scans). All keys are generated in the app on your
  machine; nothing needs to log in to the server, ever.
- **Your own dedicated IP.** Useful on its own: allowlist it on admin panels, staging
  environments, home NAS. No commercial-VPN shared-IP reputation problems.
- **Every region AWS has.** Spin an endpoint in Tokyo, Frankfurt, São Paulo — region
  testing for developers, a local exit for travellers.
- **AgentsPoppy guarantees:** tagged resources, tight scoped permissions, teardown +
  leaves-no-trace certification, live cost display.

### 1b. Privacy, precisely — and the honest caveats (ship this in-app)

- **What websites see: your endpoint's AWS IP — never your home IP.** Same protection a
  commercial VPN gives, with a bonus no vendor can match: **ephemeral-by-default means a
  fresh IP every launch**, so yesterday's browsing and today's don't share an address.
- **What your network sees: an encrypted tunnel, nothing else.** The café Wi-Fi, hotel
  router, or ISP gets no sites, no DNS, no content.
- **What the VPN vendor sees: nothing — there is no vendor.** Every commercial VPN could
  observe all your traffic and asks to be trusted not to. Here no third party is in the
  path at all. This is the strongest privacy claim in the product and it's structural.
- Like *every* paid VPN, the service is tied to an account (in this case yours, at AWS) —
  so this is privacy from networks and websites, the thing VPNs are actually for; nobody
  can honestly sell "invisibility from a legal order," and we don't.
- **Not a streaming unblocker.** Streaming services blocklist datacenter IP ranges,
  including AWS. Netflix-from-abroad will mostly not work. We do not market it.
- **Availability caveat:** in countries that block AWS IP ranges wholesale, the tunnel may
  not connect at all. Not a censorship-circumvention tool; we don't claim it.
- **What it IS for:** public-Wi-Fi safety · privacy from your ISP · a fresh IP every
  session (or a stable personal IP if you keep one running) · region testing · ad-free
  DNS (premium, §12).

## 2. Architecture

```
Poppy frontend (AgentsPoppy container)          Your AWS account (chosen region)
┌──────────────────────────────────┐            ┌─────────────────────────────────┐
│ generate ALL WireGuard keys      │            │ EC2 t4g.nano (Ubuntu 24.04 arm) │
│ (X25519, in-app, never leave     │  RunInst.  │  wg0: server privkey + N peers  │
│  the machine except server's     │ ─────────► │  from user-data at first boot   │
│  own key inside user-data)       │            │  NAT masquerade, ip_forward     │
│ build client configs + QR codes  │            │  SG: UDP 51820 in — NOTHING else│
│ live cost meter (CloudWatch)     │            │  no SSH, no key pair, no IAM    │
└──────────────────────────────────┘            └─────────────────────────────────┘
         │  .conf download / QR scan
         ▼
   WireGuard apps (iOS/Android/macOS/Windows — official clients)
```

- **Protocol: WireGuard.** Modern, audited, in the Linux kernel, 4k-line codebase, silent
  to strangers, first-class official apps on every platform with **QR-code import** on
  mobile. (OpenVPN/IKEv2 rejected: heavier, uglier clients, no QR story.)
- **Compute: EC2 t4g.nano** (fallback t3.nano where t4g is absent), Ubuntu 24.04 ARM AMI
  resolved per region like VM-Poppy's `amis.ts`. ~$3/mo if left running 24/7; cents when
  ephemeral. *(Lightsail's bundled transfer was considered and rejected for MVP: different
  API surface + rating story; revisit post-MVP if heavy-use egress cost becomes a real
  complaint — see §4.)*
- **One CloudFormation-free, VM-Poppy-style direct EC2 deploy** (RunInstances + SG +
  tags). No stack needed for a single instance; reuses VM-Poppy's proven launch/teardown/
  ownership patterns (`tags.ts`, ec2-aware existence).
- **Running or gone — no "stop" state (§11.4).** A stopped instance can't be cost-free
  (kept IP + disk keep billing), so the product offers only the honest pair: running
  (stable IP while it lives) or torn down ($0). Relaunching takes ~60 s; device keys are
  reused from the poppy's store, so re-adding a device is just re-scanning the fresh QR.
  This also drops the Elastic-IP apparatus entirely — simpler teardown, smaller
  permission set.

## 3. The no-SSH key ceremony (the core design)

WireGuard keys are plain X25519 — generated **in the poppy backend on the user's machine**
(Node `crypto.generateKeyPair('x25519')`; no native deps):

1. At deploy, the poppy generates: 1 server key pair + **N device key pairs** (N = device
   slots, default 5) + one preshared key per device (quantum-hardening, free).
2. The **server config** (server private key + the N device public keys) is baked into
   user-data; first boot writes `/etc/wireguard/wg0.conf`, enables `ip_forward`, sets NAT
   masquerade, `systemctl enable --now wg-quick@wg0`. No agent, no callback, no SSH.
3. The **device configs** (device private key + server public key + endpoint IP:51820 +
   DNS) exist only in the poppy: shown as QR (mobile scans straight into the WireGuard
   app) and downloadable `.conf` (desktop). Stored in the poppy's local config store so
   the user can re-show a QR later.
4. Readiness: VM-Poppy's serial-console sentinel pattern (`GetConsoleOutput` →
   `VPNPOPPY_READY`), plus the definitive check — the WireGuard app's handshake.

**Consequences:**
- Nothing can log into the box (no SSH server, no key pair, no `GetPasswordData`).
- Device slots are **pre-provisioned at deploy** (default 10, selector 1–20 — slots are
  free keypairs, so the product promise stays "unlimited devices"): adding an 11th device
  = relaunch (~60 s; device keys persist in the poppy's config store, and after any
  relaunch devices just re-scan the fresh QR for the new endpoint IP).
- **Market context (2026-07 research):** the premium incumbents all cap devices —
  Mullvad 5, CyberGhost 7, ExpressVPN 8 (14 only top-tier), NordVPN 10, Proton VPN 10;
  only Surfshark/PIA/IPVanish are unlimited. VPN-Poppy's unlimited is *structural* (no
  vendor exists to count connections) — use this contrast in marketing copy.
- The server's private key transits user-data (readable post-hoc by the account's own
  admins via `DescribeInstanceAttribute` — i.e. by *you*; nobody else). Mitigated by
  ephemerality + per-deploy fresh keys; documented in the in-app security notes.
- **Deterministic egress rule (family lesson):** all key generation uses the platform
  crypto RNG at deploy time; nothing derives from wall-clock (`new Date()`) — re-runs must
  never silently reuse or duplicate identities.

## 4. Costs — "Show the money" (AGENTS.md §9; load-bearing here)

Egress is the honest headline: **AWS data transfer out is ~$0.09/GB** (first 100 GB/mo of
the account free). Browsing/email/maps for an evening = well under 1 GB ≈ **cents**.
50 GB of heavy use ≈ $4.50 — approaching a commercial VPN's monthly fee, so the app must
show it, not hide it:

- **Live session meter on the card:** instance-hours × hourly price + public-IPv4
  ~$0.005/h + `NetworkOut` bytes (CloudWatch `GetMetricData`, read-only) × the egress
  rate → "This session: 3 h · 1.2 GB ≈ **$0.14**". Rates fetched live per the cost
  doctrine (Price List API / no hardcoding); the free-tier 100 GB noted.
- Idle-but-running warning after N hours with ~zero egress ("still running in Frankfurt —
  $0.004/h — tear down?"). There is deliberately no "stop" state: stopped instances keep
  billing (kept IP + disk), so the app offers only running or torn-down (§11.4).
- Ephemeral default (§7) keeps the forgotten-instance bill near zero by construction.

## 5. Permission set & rating

VM-Poppy-class amber, but **smaller**: no key pairs, no password reads, no stop/start
complexity (MVP: running or destroyed; stop/start post-MVP if wanted).

- `ec2`: `DescribeInstances`, `DescribeImages`, `DescribeVpcs`, `DescribeSubnets`,
  `DescribeSecurityGroups`, `GetConsoleOutput` · `RunInstances`, `CreateSecurityGroup`,
  `AuthorizeSecurityGroupIngress`, `CreateTags` · `TerminateInstances`,
  `DeleteSecurityGroup` (mutations/deletes `tagged-as-self`)
- `cloudwatch`: `GetMetricData` (read-only, the cost meter)
- **No IAM. No instance role. Nothing account-wide.** All three attribution tags on every
  created resource; teardown hook + `npm run certify` leaves-no-trace before listing.
- **Family gotchas apply:** verify against the REAL `assessPermissionSet` (substring trap —
  note `GetConsoleOutput` contains "put", already survived in VM-Poppy) and stay well
  under the STS packed-policy budget (13 actions here — comfortably below VM-Poppy's
  proven DR5 ceiling of 18; the teardown-only lifecycle in §11.4 is what bought the
  headroom).

## 6. Security & privacy notes (surface in-app, SecurityInfo-style)

- Single exposed port: UDP 51820, and WireGuard answers only valid keys — the box is
  effectively invisible. No inbound TCP at all.
- Per-deploy fresh keys; preshared keys per device; client configs never leave the app
  except by the user's own QR/download.
- DNS inside the tunnel points at the endpoint's resolver (unbound, installed at boot) so
  the café Wi-Fi can't see your lookups. (Premium turns this resolver into an ad/tracker
  blocker — §12.)
- The §1b privacy panel ("what websites / your network / nobody sees" + the streaming
  caveat) shows on the deploy screen the first time, dismissible after.
- A long-running endpoint keeps one IP — uniquely yours, so it becomes a stable
  identifier across sites over time (like a home IP). The in-app copy nudges: for
  privacy, prefer ephemeral (fresh IP per session); for allowlisting, keep it running.
- Kill-switch guidance: the official WireGuard apps' on-demand/always-on settings are the
  kill switch; we link the how-to per platform rather than pretending to control it.

## 7. UX

- **Deploy card:** region picker (flag + city names, latency hint "closest to you" via a
  tiny ping probe), device-slots selector (default 10, "unlimited devices — add more with
  a quick relaunch"), lifecycle exactly like VM-Poppy: **auto-teardown after N hours the
  user submits (prefilled 8, editable)** vs "keep until I stop or tear it down". One
  primary button: **"Launch VPN"**.
- **Running card:** region + IP (CopyButton), live cost meter (§4), per-device rows —
  "📱 Phone · show QR" / "💻 Laptop · download .conf" (names editable), handshake status
  per device (parsed? No — server-side wg state is unreadable without SSH by design; we
  show "config issued" and teach the in-app check: the WireGuard app shows the
  handshake). One lifecycle action: **Tear down** (VM-Poppy terminate vocabulary). No
  Stop button by design — relaunching is 60 s and $0, stopping would silently keep
  billing (§11.4).
- **Empty state teaches the product:** "A VPN endpoint that exists only while you need
  it. Launch one before you join the airport Wi-Fi; destroy it after."
- Design kit `poppy.css`, `poppyAccent("com.vpnpoppy.desktop")`, plain language, no jargon
  ("endpoint" explained as "your private tunnel exit").

## 8. Reuse map (read-only references)

- `~/Projects/vm-poppy` — repo layout, `build-sidecar.mjs` (+ `--win32`), `tags.ts`
  ownership/attribution, `amis.ts` per-region AMI resolve, serial-console sentinel,
  teardown/certify flow, `CopyButton`, launch-form patterns, DR1–DR6 lessons.
- `~/Projects/agentspoppy/AGENTS.md` — the contract (rating, teardown, tags, §9 costs).
- `~/Projects/traffic-poppy/DESIGN.md` — the honesty-section style this doc mirrors.
- Packing/catalogue: `agentspoppy/scripts/pack-extension.mjs` + catalog-seed flow.

## 9. MVP vs post-MVP

**MVP (P0–P2):** one endpoint at a time per region · t4g.nano/t3.nano · 10-slot key
ceremony + QR/.conf · teardown + user-set auto-teardown hours (no stop state, §11.4) ·
cost meter · §1b privacy panel · certify green.
**Post-MVP:** multiple simultaneous endpoints ("fleet") · IPv6 inside the tunnel ·
Lightsail egress-bundle variant · split-tunnel helper profiles.

## 10. Open questions for the founder — ✅ ALL ANSWERED 2026-07-18, see §11

1. **Name.** `VPN-Poppy` (matches VM-Poppy convention). OK, or something friendlier
   ("TunnelPoppy")?
2. **Device slots default 5** and "add a device = redeploy (regenerates existing device
   configs too — re-scan QRs)" — acceptable MVP trade for the no-SSH guarantee?
3. **Premium feature (pick ONE, §12):** my recommendation is **(a) ad/tracker-blocking
   DNS**.
4. **Ephemeral default TTL 8 h** (self-destruct), "keep running" as the explicit opt-out —
   right default?
5. **Premium price point** — anchor: commercial VPNs $5–13/mo; we're the "no vendor"
   option. My instinct: **$2.5–3/mo or $25/yr** per deployment via the AgentsPoppy
   checkout.
6. **§1b privacy framing sign-off** *(revised per founder feedback 2026-07-18)*: lead with
   what it protects (websites see the AWS IP, fresh per launch; network sees only a
   tunnel; **no vendor exists to see anything**); one neutral account-linked line like any
   paid VPN; never market streaming unblocking — confirmed?

## 11. Locked decisions (founder, 2026-07-18) — final for the implementation session

1. **Name: VPN-Poppy.** "VPN" is clear, "Poppy" makes it friendly.
2. **Unlimited devices** as the product promise; **10 slots pre-provisioned at launch**
   (selector 1–20), adding more = quick relaunch. No artificial device limit — slots are
   free keypairs; the pre-provisioning exists only because of the no-SSH key ceremony.
   **Confirmed marketing asset (market research 2026-07-18):** premium incumbents cap
   devices — Mullvad 5, CyberGhost 7, ExpressVPN 8 (14 top-tier only), NordVPN 10,
   Proton VPN 10 — and enforce the cap on their servers. VPN-Poppy's unlimited is
   structural: no vendor exists to count your connections. Use in listing copy.
3. **Premium = Shielded DNS** (ad/tracker/malware blocking at the endpoint's resolver).
   NOT an AWS paid service — free software on the same instance, **zero extra AWS cost to
   the user**; blocklists refreshed at each boot.
4. **Lifecycle = teardown-only** *(founder revised 2026-07-18, superseding the earlier
   stop/start idea)*: the user tears down whenever they wish, or sets an **automatic
   teardown after N hours they submit** (launch form prefills 8, fully editable). "Stop"
   was dropped because it cannot be made cost-free (a stopped instance keeps billing its
   kept IP + disk) — rather than ship a button with a cost asterisk, the product offers
   only the honest pair: **running, or gone ($0)**. Relaunch is ~60 s; no Elastic IP
   apparatus needed, and the permission set shrinks to 13 actions.
5. **Price: $14.99/year per deployment, billed yearly** (≈ $1.25/month) via the
   AgentsPoppy first-party checkout (`kind=subscription`). Deliberately under commercial
   VPNs ($5–13/mo) since we don't serve the streaming use-case.
6. **Privacy framing (§1b): lead with strength.** More *private* than any commercial VPN —
   because there is no VPN company to trust: websites see only the endpoint IP (fresh
   every launch when ephemeral), the local network sees only a tunnel, and no vendor
   exists in the path. One neutral account-linked sentence (true of every paid VPN). The
   only warning box is **streaming/datacenter-IP + country availability**. Copy uses
   "private" as the load-bearing word (accurate and strong) rather than promising
   "anonymity" as a technical guarantee.

## 12. Monetization — free core + ONE premium

**Free forever:** launch/teardown, all regions, unlimited devices, QR/.conf, cost meter,
the full privacy design.
**Premium — LOCKED (§11.3): Shielded DNS, $14.99/year per deployment, billed yearly.**
The endpoint's resolver becomes an ad/tracker/malware-domain blocker (curated blocklists,
refreshed at boot): "block ads on every device, in every app, while connected — no
browser extension". NOT an AWS paid service — free software on the same instance, zero
extra AWS cost to the user; pure user-data addition, zero new permissions. Sold via the
AgentsPoppy first-party checkout (`kind=subscription`), like TrafficPoppy's True Reach.
*(Fleet mode and scheduled always-on remain free-tier post-MVP candidates, not premium.)*

## 13. Plan

- **P0 — walking skeleton:** scaffold (vm-poppy layout) → manifest + permission set
  verified against the real assessor → launch a bare t4g.nano with sentinel → card +
  teardown → `npm run certify` green → dev-install visible in AgentsPoppy.
- **P1 — the tunnel:** key ceremony (X25519 in Node, unit-tested against `wg` vectors) →
  WireGuard user-data (server conf + NAT + unbound) → SG UDP 51820 → QR + .conf issue →
  **live acceptance: phone on cellular, handshake, browse, IP = endpoint**.
- **P2 — honest economics + lifecycle:** cost meter (CloudWatch + live rates, incl.
  IPv4) · user-set auto-teardown hours · idle warning · §1b privacy panel · region
  latency hints.
- **P3 — polish + catalogue:** empty-state teaching, device renaming, per-region AMI
  table hardening, `--win32` build, pack + catalogue listing, README/screenshots.
- **P4 — premium: Shielded DNS** ($14.99/yr) + AgentsPoppy checkout wiring.
- Every phase ends with founder check-in; every live test in the founder's account is
  torn down + verified clean (working agreements, as CLAUDE.md will encode).

## 14. Status

**Design COMPLETE — all §10 questions answered and locked in §11 (2026-07-18).**

### P0 — walking skeleton: ✅ DONE (founder-verified live, 2026-07-18)

Live launch → readiness → teardown verified clean in the founder's account. (Formal
`npm run certify` deferred to pre-listing, P3/P4 — not blocking.)

### P1 — the tunnel: ✅ live-verified on mobile (2026-07-20)

Founder scanned a device QR in the official WireGuard app on a phone → tunnel came up
and worked. Live acceptance met. Laptop path (Download .conf → Import) uses the same
mechanism; optional to re-confirm.

**Onboarding lessons from the live test (fixed in-app, `main`):**
- A WireGuard QR holds a *config, not a URL*, so a phone **camera** app just offers a
  web search. The devices section now says, prominently and before any QR, to scan
  **from inside the WireGuard app** (with a "Get the WireGuard app" link), and splits
  📱 Phone-scans-QR vs 💻 Laptop-uses-.conf.
- **The official WireGuard app is not a "vendor" and does not break the no-vendor
  claim** (founder raised this; answered, no design change to §2/§11). It's free +
  open-source, has no account/telemetry, and is a *client* that runs the tunnel on the
  device and connects only to the user's own endpoint — nothing routes through any
  WireGuard server. In-app copy now states this. Building a custom client stays out of
  scope (DESIGN §2 deliberately uses the official clients — that's what enables QR
  import + "unlimited devices").
- Added a collapsed **"What is WireGuard?"** explainer in the devices callout (plain
  language, depth one click away).

**Other live-test fixes (`main`):**
- **Download `.conf` now works.** A sandboxed WKWebView ignores blob/`<a download>`, so
  the button silently no-op'd. Switched to the broker's `/ext-dl` one-shot-token handoff
  (backend mints a token + serves bytes with `Content-Disposition`; frontend opens the
  system browser via `openExternal`). Recorded as CLAUDE.md gotcha #6.
- **Teardown is a two-step confirm, not type-to-confirm.** The type-to-confirm gate was
  buggy (one-sided trim/case) *and* the wrong ceremony: a single throwaway endpoint is a
  *scoped* delete, which AGENTS.md §4 says takes a two-step dialog (type-to-confirm is
  for whole-footprint wipes, still used by the host's "tear down everything"). Now: click
  → dialog names the blast radius → confirm, with Cancel default-focused.

### P4 — Shielded DNS: feature built, awaiting live test + purchase gate (2026-07-20)

Premium feature implemented ahead of P2/P3 (founder's call, to lock in monetization).
The endpoint's unbound resolver becomes an ad/tracker/malware blocker — **pure user-data,
zero new AWS permissions or cost** (manifest unchanged), exactly as §12 promised.

- First boot (when `shieldedDns`) fetches a curated blocklist (StevenBlack hosts,
  refreshed each launch) → unbound NXDOMAIN local-zones. Hardened for the 512MB nano:
  **swap added first** (OOM guard) and **fail-open everywhere** (bad download /
  `unbound-checkconf` fail / resolver won't start → drop blocklist + restart, so the paid
  feature never breaks the free VPN). Canary `shielded.vpnpoppy → 10.9.9.9` is a
  deterministic "is the shield live?" self-test.
- Launch toggle (labelled "free while testing — will be $14.99/yr"), 🛡️ badge, in-card
  test hint with the `nslookup` canary + `doubleclick.net` checks. `vpnpoppy:shielded` tag.
- **Deliberately ungated for now** — the AgentsPoppy purchase gate (`commerce:purchase`,
  `kind=subscription`, $14.99/yr) is the **next step**.
- Live test (founder): launch a NEW endpoint with the box checked, connect a device, run
  the canary + a blocked-domain lookup.

### P1 — build detail (2026-07-19)

Built and green locally; **not yet live-tested** (that gate needs founder confirmation
before any AWS mutation, per CLAUDE.md working agreements):

- **Scaffold** on the vm-poppy layout (`frontend/ backend/ scripts/`), workspaces,
  `build-sidecar.mjs` (+ `--win32`), `.claude/launch.json`.
- **Manifest** = the locked §5 permission set, **13 actions**, verified **amber /
  zero-red** against the REAL `assessPermissionSet`. Committed gates
  `scripts/{validate-manifest,assess-permissions}.mjs` import the host's compiled
  core/extension-sdk directly (via a shared append-`.js` resolve hook) so the check is
  against the code the host runs; `assess-permissions` fails CI on any red.
- **Backend sidecar**: no-SSH bare-endpoint launch (no key pair, only UDP 51820),
  teardown-only lifecycle (`InstanceInitiatedShutdownBehavior=terminate`), readiness via
  `GetConsoleOutput` → `VPNPOPPY_READY`, per-region clients, teardown hook. 11 unit tests
  lock the no-SSH + single-UDP-port invariants. Sidecar builds to a native arm64 SEA.
- **Frontend**: deploy card (region/slots/lifecycle + cost hint), endpoint card with a
  two-step confirm teardown, §1b lead-with-strength copy; verified end-to-end vs a mock
  host bridge. Accent `#e8b8c9`.
- **Dev-installed** into `~/.agentspoppy/extensions/com.vpnpoppy.desktop` (layout verified).

**Implementation decisions recorded here (per the working agreement):**
1. **Declare the full locked 13-action set now**, including `cloudwatch:GetMetricData`
   (unused until P2's cost meter), rather than a P0 subset — the manifest is the
   founder-locked design, and declaring it once avoids the connection revoke+re-approve
   churn a scope change triggers each phase.
2. **Per-region EC2 clients + a persisted region pointer** (`backend/src/store.ts`): we
   persist only *which regions* we've launched into (never endpoint state — that's read
   live from EC2), so background-resume (AGENTS.md §5) and the teardown sweep (§4) stay
   correct after an app restart, and an endpoint in a non-home region is never stranded.
3. **P0 opens the real endpoint firewall** (UDP 51820 → 0.0.0.0/0) from the first commit,
   even though WireGuard itself lands in P1 — so teardown of the true SG shape is
   exercised now and the no-SSH invariant holds from the start.
4. **No per-file SPDX headers** — matching vm-poppy's actual convention (LICENSE file +
   `package.json` license field; only the host repo carries per-file headers).

**P1 — the tunnel (built, `main`):** X25519 key ceremony in `node:crypto` (no native
deps), verified against the **RFC 7748** Curve25519 vectors so keys interoperate with
the official `wg`; WireGuard + unbound first-boot user-data (NAT masquerade with the
NIC substituted at boot, in-tunnel DNS on `10.8.0.1`); device QR + `.conf` issue with
per-device rename; key custody in a 0600 keystore (device private keys only in the
poppy; server private key only in user-data). 27 tests green (12 new, incl. the
vectors); UI verified end-to-end vs a mock host.

**P1 implementation decisions (recorded per the working agreement):**
1. **Tunnel plan `10.8.0.0/24`** — server `.1`, devices `.2…` (fits the 1–20 slot
   range in a /24); device `AllowedIPs = 0.0.0.0/0, ::/0` (full-tunnel).
2. **unbound as the in-tunnel resolver on `10.8.0.1`** (recursive, access-limited to
   the tunnel + loopback). This is the resolver Premium (§12) turns into the ad/tracker
   blocker in P4 — no new AWS surface, no new port.
3. **NAT via `wg-quick` PostUp/PostDown** with a `%WGNIC%` placeholder that first-boot
   `sed`-replaces with the box's real default interface (`ens5` on Nitro, not `eth0`) —
   robust across instance types, and wg-quick tears the rules down with the tunnel.
4. **QR rendered in the frontend** (bundled `qrcode`, no external host) from the `.conf`
   the backend returns. The `.conf` (which contains the device private key) does reach
   the sandboxed webview — necessary to display/scan/download it, and safe: the webview
   has no network to AWS and can't exfiltrate. The UI labels it "treat like a password".

**Remaining P1 (founder-gated — needs the phone):** relaunch AgentsPoppy → launch an
endpoint → scan a device QR in the WireGuard app **on a phone on cellular** → confirm
handshake, browsing works, and the phone's public IP is the endpoint's → tear down
clean. Coordinated with the founder, never simulated (CLAUDE.md). Then P2 (cost meter +
lifecycle + §1b panel + latency hints).
