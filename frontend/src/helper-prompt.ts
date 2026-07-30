// The AI helper prompt (AGENTS.md §9, REQUIRED — founder 2026-07-30): onboarding is a prompt,
// not a manual. The user pastes it into whatever AI they already talk to, says what they want
// the VPN for, and gets back the region, slot count and lifecycle to set — plus the honest
// answer about whether this tool suits what they asked for.
//
// Built LIVE from ./types.ts — REGIONS, LAUNCH_FIELDS, SHIELDED_DNS, COST_FACTS — the same
// constants the form renders, so the prompt can never offer a region or a bound the form lacks.
//
// The load-bearing honesty here is what VPN-Poppy DOESN'T do. Its positioning rules (DESIGN §1b,
// §2) forbid marketing it as a streaming unblocker or a censorship tool, and the word is
// "private", never "anonymous". An outside AI asked "which region for Netflix?" will happily
// invent an answer, so the prompt has to pre-empt that — otherwise the helper sells a promise
// the product deliberately refuses to make.

import {
  COST_FACTS,
  DEFAULT_INSTANCE,
  HOURLY_USD,
  IPV4_HOURLY_USD,
  LAUNCH_FIELDS,
  REGIONS,
  SHIELDED_DNS,
  WIREGUARD_NOTE,
  formatUsd,
} from "./types";

export function buildHelperPrompt(opts?: { homeRegion?: string; shieldPurchasable?: boolean }): string {
  const regionLines = REGIONS.map((r) => `  - ${r.flag} ${r.city} · ${r.id}`).join("\n");
  const hourly = (HOURLY_USD[DEFAULT_INSTANCE.instanceType] ?? 0) + IPV4_HOURLY_USD;
  const f = LAUNCH_FIELDS;

  const home =
    opts?.homeRegion && REGIONS.some((r) => r.id === opts.homeRegion)
      ? `The form will already be set to ${opts.homeRegion} (my AWS account's home region). Only tell me to change it if what I described needs a different exit country.`
      : `The form defaults to ${f.region.fallback}.`;

  return `You are helping me launch a personal VPN in VPN-Poppy — an app that starts a private WireGuard VPN server on a small machine in my own AWS account, for the hours I need it, and tears it down again. There is no VPN company in the middle: I own the server. I will describe, in my own words, what I want the VPN for. Your job: tell me exactly what to set in VPN-Poppy's "Launch a VPN endpoint" form. If my description is ambiguous or missing something important, ask me at most three short questions first.

THE FORM I WILL FILL IN:
1. ${f.region.label} — ${f.region.what} ${home} The regions offered are exactly these, and nothing else:
${regionLines}
2. ${f.name.label} — ${f.name.what} Example: "${f.name.placeholder}".
3. ${f.deviceSlots.label} — a slider from ${f.deviceSlots.min} to ${f.deviceSlots.max}, default ${f.deviceSlots.default}. ${f.deviceSlots.what}
4. ${f.lifecycle.label} — a choice of "${f.lifecycle.autoLabel} N hours" (${f.lifecycle.minHours}–${f.lifecycle.maxHours}, prefilled ${f.lifecycle.defaultHours}) or "${f.lifecycle.keepLabel}". ${f.lifecycle.what}
5. "${SHIELDED_DNS.label}" (premium, optional) — ${SHIELDED_DNS.what} CAUTION: ${SHIELDED_DNS.caution}${opts?.shieldPurchasable === false ? " Right now it isn't on sale for this install at all, so recommend leaving it off." : ""}

WHAT IT COSTS ME (approximate, and I'd rather you showed the arithmetic than a confident total):
- About ${formatUsd(hourly)} per hour while the endpoint is running (a ${DEFAULT_INSTANCE.instanceType} plus its public IP address).
- Data transfer out at roughly $${COST_FACTS.egressPerGb.toFixed(2)}/GB, with the first ${COST_FACTS.freeEgressGbPerMonth} GB a month free on the account. ${COST_FACTS.note}
- So heavy use is the thing that costs, not the hours: streaming video for days can reach the price of a commercial VPN. If what I described is high-bandwidth, say so plainly with the rough arithmetic.

AFTER IT LAUNCHES — the step people get stuck on:
- ${WIREGUARD_NOTE.step}
- ${WIREGUARD_NOTE.note}

RULES OF THE PRODUCT — plan within these, and tell me the relevant ones honestly even if it costs you the sale:
- NEVER recommend a region that isn't in the list above.
- This is NOT a streaming unblocker. Netflix, BBC iPlayer and the rest blocklist datacenter IP ranges, AWS included, so "watch my home country's catalogue from abroad" will mostly NOT work. If that's what I asked for, say so directly, first, before anything else — do not pick a region as though it would work.
- It is NOT a censorship-circumvention tool. In countries that block AWS address ranges wholesale, the tunnel may not connect at all.
- The honest word is "private", not "anonymous". It hides my traffic from the network I'm sitting on and hides my home address from the sites I visit; it does not make me untraceable, and nobody can honestly sell invisibility from a legal order. Don't imply otherwise.
- Traffic exits from an AWS datacenter address that is visibly a datacenter. Some sites treat that with extra suspicion (more CAPTCHAs, occasional blocks). Worth mentioning if I described everyday browsing.
- The endpoint runs no SSH server and has no login of any kind — only the WireGuard port is open. Don't suggest logging into it, running commands on it, or installing anything on it.
- There is no Stop button by design: the endpoint is running or gone. Teardown is a two-step confirm, stops billing immediately, disconnects my devices, and cannot be undone. Relaunching is about a minute.
- Every device key is generated on my own machine, never on a server. Adding device slots later requires a relaunch, which gives every device a new config.

ANSWER IN EXACTLY THIS SHAPE:
1. Does VPN-Poppy actually suit what I asked for? — "yes, because …", or "only partly — here's what won't work …", or "no — here's why, and what would". Say this FIRST and don't soften it.
2. Region: … (one line why, and the honest trade-off if I'm picking distance over speed)
3. Name: …
4. Device slots: … (one line — count my devices and add a couple spare)
5. Lifecycle: … (auto tear down after N hours, or keep running — with one line on which is safer for my bill)
6. Shielded DNS: "worth it because …" or "leave it off because …"
7. Roughly what this will cost me: … (hours × rate, plus a data estimate, shown as arithmetic)
8. What to do on each device once it's up: … (the WireGuard app step, in order)

MY VPN IS FOR: `;
}
