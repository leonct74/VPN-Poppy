// The STANDARD AgentsPoppy purchase button (`<agentspoppy-purchase>`), defined against our
// inlined host bridge — a faithful copy of the SDK's element (packages/extension-sdk/
// purchase-button.ts). A poppy must not restyle or fake it: it renders a fixed, recognisable
// look in a shadow root, shows the server-set price, flips to "Owned" + an always-present
// "Manage" control once bought (a platform requirement — how a buyer cancels / sees receipts),
// and dispatches a bubbling `purchased` event so the poppy can unlock. Payment never touches
// the poppy; entitlement is server-verified (AGENTS.md §11). Call definePurchaseButton() once.

import { host } from "./host";

const TAG = "agentspoppy-purchase";
const SYMBOLS: Record<string, string> = { usd: "$", eur: "€", gbp: "£", cad: "$", aud: "$" };

function formatPrice(p: { amountMinor: number; currency: string; kind: string; interval?: string }): string {
  const amount = `${SYMBOLS[p.currency] ?? p.currency.toUpperCase() + " "}${(p.amountMinor / 100).toFixed(2)}`;
  return p.kind === "subscription" ? `${amount}/${p.interval === "month" ? "mo" : "yr"}` : amount;
}

// Fixed look (clay is the host's reserved purchase colour — deliberate, so the button reads as
// a platform control, not poppy chrome).
const STYLE = `
  :host { display: inline-block; font-family: system-ui, -apple-system, sans-serif; }
  button { display: inline-flex; align-items: center; gap: 7px; border: none; border-radius: 999px;
    padding: 8px 15px; font-size: 14px; font-weight: 600; cursor: pointer; background: #d97757; color: #1a1712; }
  button:hover:not(:disabled) { background: #e08a6d; }
  button:disabled { opacity: 0.6; cursor: default; }
  .mark { width: 14px; height: 14px; flex: none; }
  .owned { color: #2f8f4e; font-weight: 600; font-size: 14px; display: inline-flex; align-items: center; gap: 6px; }
  .owned .mark { color: #2f8f4e; }
  .manage { margin-left: 9px; background: none; border: none; padding: 0; color: #8f8a80; font-size: 13px; text-decoration: underline; cursor: pointer; }
  .manage:hover { color: #1a1712; }
`;
const MARK = `<svg class="mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7" r="4"/><circle cx="12" cy="17" r="4"/><circle cx="7" cy="12" r="4"/><circle cx="17" cy="12" r="4"/></svg>`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function definePurchaseButton(): void {
  if (typeof window === "undefined" || typeof customElements === "undefined") return;
  if (customElements.get(TAG)) return;

  class PurchaseButton extends HTMLElement {
    private root = this.attachShadow({ mode: "open" });
    connectedCallback(): void {
      void this.refresh();
    }
    private get product(): string {
      return this.getAttribute("product") ?? "";
    }
    private get opts(): { target?: string } | undefined {
      const t = this.getAttribute("target") ?? undefined;
      return t ? { target: t } : undefined;
    }
    async refresh(): Promise<void> {
      this.paint(`<span class="owned">…</span>`);
      const info = await host.purchaseInfo(this.product, this.opts).catch(() => null);
      if (!info) return this.paint(""); // couldn't load — render nothing, not a broken button
      if (info.owned) {
        this.paint(`<span class="owned">${MARK} Owned</span><button type="button" class="manage">Manage</button>`);
        this.root
          .querySelector(".manage")
          ?.addEventListener("click", () => void host.manageSubscription(this.product, this.opts).catch(() => {}));
        return;
      }
      if (!info.price) return this.paint(""); // not for sale (no server product) — nothing to show
      const label =
        this.getAttribute("label") ?? `${info.price.kind === "subscription" ? "Subscribe" : "Buy"} · ${formatPrice(info.price)}`;
      this.paint(`<button type="button">${MARK}<span>${escapeHtml(label)}</span></button>`);
      this.root.querySelector("button")?.addEventListener("click", () => void this.buy());
    }
    private async buy(): Promise<void> {
      const btn = this.root.querySelector("button");
      if (btn) {
        btn.disabled = true;
        btn.querySelector("span")!.textContent = "Waiting for payment…";
      }
      const res = await host.buyProduct(this.product, this.opts).catch(() => ({ owned: false }));
      if (res.owned) {
        this.dispatchEvent(new CustomEvent("purchased", { bubbles: true, detail: { product: this.product } }));
      }
      void this.refresh();
    }
    private paint(inner: string): void {
      this.root.innerHTML = `<style>${STYLE}</style>${inner}`;
    }
  }
  customElements.define(TAG, PurchaseButton);
}
