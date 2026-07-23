import { host } from "./host";
import { SHIELD_PRODUCT_ID, formatPrice, billingNote, type PurchasePrice } from "./types";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** null = still loading entitlement; true = subscribed; false = not subscribed. */
  entitled: boolean | null;
  /** True when a priced product exists server-side (so a buy button can be shown). */
  purchasable: boolean;
  /** The server-set price (null while loading / not for sale) — the source for the shown price. */
  price: PurchasePrice | null;
}

const shieldSvg = (
  <svg className="shield-svg" viewBox="0 0 56 64" width="52" height="52">
    <circle className="shield-pulse" cx="28" cy="30" r="21" />
    <path className="shield-body" d="M28 5 L50 14 V30 C50 44 40 54 28 58 C16 54 6 44 6 30 V14 Z" />
    <path className="shield-check" d="M18 31 l7 7 l14 -15" />
  </svg>
);

/**
 * The premium Shielded DNS control + purchase gate. Selecting it is a real toggle, but the
 * feature can't be *used* until it's paid for — so:
 *   - Subscribed → selecting turns the shield green ("Protected"); it launches with the box.
 *   - NOT subscribed → selecting shows a red "Not active until subscribed" state + the buy
 *     button, and (via the parent) DISABLES Launch until the user either subscribes or turns
 *     it back off. No ambiguous "preview" — the choice is: pay, or deselect.
 *   - Not purchasable yet (no server product) → same block, with a "not on sale yet" note.
 */
export function ShieldedDnsToggle({ checked, onChange, disabled, entitled, purchasable, price }: Props) {
  const loading = entitled === null;
  const active = checked && entitled === true; // paid + selected → really on
  const blocking = checked && entitled !== true && !loading; // selected but not paid → must resolve

  function toggle() {
    if (disabled || loading) return;
    onChange(!checked);
  }

  const stateLabel = active ? "Protected" : blocking ? "Not active until subscribed" : "Premium";
  const cls = `shield-toggle${active ? " on" : ""}${blocking ? " blocking" : ""}${disabled || loading ? " disabled" : ""}`;

  return (
    <div>
      <label className={cls}>
        <input
          className="sr-only"
          type="checkbox"
          checked={checked}
          disabled={disabled || loading}
          onChange={toggle}
        />
        <span className="shield-visual" aria-hidden>
          {shieldSvg}
        </span>
        <span className="shield-copy">
          <span className="shield-head">
            <strong>Shielded DNS</strong>
            <span className={`shield-state${blocking ? " danger" : ""}`}>{stateLabel}</span>
          </span>
          <span className="shield-sub muted">
            Block ads, trackers &amp; malware on every connected device, in every app — no browser extension, nothing to
            install. Pages load faster and lighter, too: blocked ads and trackers are never downloaded.{" "}
            {entitled === true ? (
              <>Adds ~30–60s to launch.</>
            ) : price ? (
              price.trialDays ? (
                <>
                  <strong>{price.trialDays} days free</strong>, then {formatPrice(price)}
                  {billingNote(price) ? ` · ${billingNote(price)}` : ""}.
                </>
              ) : (
                <>
                  <strong>{formatPrice(price)}</strong>
                  {billingNote(price) ? ` · ${billingNote(price)}` : ""}.
                </>
              )
            ) : null}
          </span>
        </span>
      </label>

      {blocking && (
        <div className="shield-cta" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          <span className="shield-block-note">
            {purchasable
              ? `Shielded DNS is selected but not active — ${
                  price?.trialDays ? "start your free trial" : "subscribe"
                } to switch it on, or turn it off to launch a standard VPN.`
              : "Shielded DNS isn't on sale for this poppy yet — turn it off to launch a standard VPN."}
          </span>
          {purchasable && (
            <div className="row" style={{ gap: 12 }}>
              {/* Host-drawn button — checkout in the system browser, then the shield turns on. */}
              <agentspoppy-purchase product={SHIELD_PRODUCT_ID} />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(false)}>
                Turn off
              </button>
            </div>
          )}
        </div>
      )}

      {entitled === true && (
        <div className="shield-cta">
          <button className="btn btn-sm btn-ghost" onClick={() => void host.manageSubscription(SHIELD_PRODUCT_ID)}>
            Manage billing
          </button>
        </div>
      )}
    </div>
  );
}
