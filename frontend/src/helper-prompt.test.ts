import { describe, expect, it } from "vitest";
import { buildHelperPrompt } from "./helper-prompt";
import { COST_FACTS, LAUNCH_FIELDS, REGIONS, SHIELDED_DNS, WIREGUARD_NOTE } from "./types";

// The helper prompt IS the user's training, pasted into a foreign AI (AGENTS.md §9). Its one job
// is to never disagree with the form: every option the form offers appears, in the form's own
// words, and nothing is invented. These tests fail the moment the catalogue in types.ts and the
// prompt drift apart — the only way a generated prompt can go wrong.
describe("the helper prompt", () => {
  it("carries every region the form offers, labelled as the dropdown labels it", () => {
    const p = buildHelperPrompt();
    for (const r of REGIONS) expect(p).toContain(`${r.flag} ${r.city} · ${r.id}`);
  });

  it("carries every field label, explanation and bound the form enforces", () => {
    const p = buildHelperPrompt();
    const f = LAUNCH_FIELDS;
    for (const field of [f.region, f.name, f.deviceSlots, f.lifecycle]) {
      expect(p).toContain(field.label);
      expect(p).toContain(field.what);
    }
    expect(p).toContain(`from ${f.deviceSlots.min} to ${f.deviceSlots.max}, default ${f.deviceSlots.default}`);
    expect(p).toContain(`${f.lifecycle.minHours}–${f.lifecycle.maxHours}, prefilled ${f.lifecycle.defaultHours}`);
    expect(p).toContain(f.lifecycle.keepLabel);
  });

  it("describes the premium option and its blocking behaviour in the toggle's own words", () => {
    const p = buildHelperPrompt();
    expect(p).toContain(SHIELDED_DNS.label);
    expect(p).toContain(SHIELDED_DNS.what);
    expect(p).toContain(SHIELDED_DNS.caution);
  });

  it("tells the AI to leave the shield off when it isn't on sale here", () => {
    expect(buildHelperPrompt({ shieldPurchasable: false })).toMatch(/isn't on sale for this install/);
    expect(buildHelperPrompt({ shieldPurchasable: true })).not.toMatch(/isn't on sale for this install/);
  });

  // DESIGN §1b/§2 and CLAUDE.md's copy rules: never market streaming unblocking, never claim
  // anonymity. An outside AI asked "which region for Netflix?" will invent an answer unless the
  // prompt pre-empts it — these assertions are the guard on that refusal.
  it("refuses the streaming and anonymity promises the product deliberately won't make", () => {
    const p = buildHelperPrompt();
    expect(p).toMatch(/NOT a streaming unblocker/);
    expect(p).toMatch(/do not pick a region as though it would work/);
    expect(p).toMatch(/NOT a censorship-circumvention tool/);
    expect(p).toMatch(/honest word is "private", not "anonymous"/);
    expect(p).toMatch(/nobody can honestly sell invisibility from a legal order/);
  });

  it("states the no-SSH invariant and the teardown-only lifecycle", () => {
    const p = buildHelperPrompt();
    expect(p).toMatch(/runs no SSH server and has no login of any kind/);
    expect(p).toMatch(/no Stop button by design/);
  });

  it("names WireGuard honestly as the prerequisite, with the exact step", () => {
    const p = buildHelperPrompt();
    expect(p).toContain(WIREGUARD_NOTE.step);
    expect(p).toContain(WIREGUARD_NOTE.note);
  });

  it("shows cost as arithmetic rather than a confident total", () => {
    const p = buildHelperPrompt();
    expect(p).toContain(`$${COST_FACTS.egressPerGb.toFixed(2)}/GB`);
    expect(p).toContain(`first ${COST_FACTS.freeEgressGbPerMonth} GB a month free`);
    expect(p).toMatch(/shown as arithmetic/);
  });

  it("mentions the account's home region when the connection knows it", () => {
    expect(buildHelperPrompt({ homeRegion: "eu-west-2" })).toMatch(/already be set to eu-west-2/);
    // An unknown region must never be presented as the account's own.
    expect(buildHelperPrompt({ homeRegion: "mars-north-1" })).toContain(
      `defaults to ${LAUNCH_FIELDS.region.fallback}`,
    );
  });

  it("puts the honest suitability verdict first in the answer shape", () => {
    const p = buildHelperPrompt();
    expect(p).toMatch(/1\. Does VPN-Poppy actually suit what I asked for\?/);
    expect(p).toMatch(/Say this FIRST and don't soften it/);
    expect(p).toMatch(/at most three short questions first/);
    expect(p).toMatch(/ANSWER IN EXACTLY THIS SHAPE/);
  });

  it("ends mid-sentence so the user's next words are the goal", () => {
    expect(buildHelperPrompt().endsWith("MY VPN IS FOR: ")).toBe(true);
  });
});
