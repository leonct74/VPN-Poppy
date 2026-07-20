import { useEffect, useState } from "react";
import { host } from "./host";
import { SHIELD_PRODUCT_ID } from "./types";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** null = still loading entitlement; true = subscribed; false = not subscribed. */
  entitled: boolean | null;
  /** True when a priced product exists server-side (so a buy button can be shown). */
  purchasable: boolean;
}

const shieldSvg = (
  <svg className="shield-svg" viewBox="0 0 56 64" width="52" height="52">
    <circle className="shield-pulse" cx="28" cy="30" r="21" />
    <path className="shield-body" d="M28 5 L50 14 V30 C50 44 40 54 28 58 C16 54 6 44 6 30 V14 Z" />
    <path className="shield-check" d="M18 31 l7 7 l14 -15" />
  </svg>
);

/**
 * The premium Shielded DNS control with the in-app purchase gate.
 *  - Subscribed → a free, delightful toggle (shield activates on select) + a "Manage billing" link.
 *  - Not subscribed → clicking the shield PREVIEWS the activation animation first (the value made
 *    felt), THEN reveals the standard AgentsPoppy purchase button — so the animation is always seen
 *    before the checkout redirect (founder requirement). Once bought, the shield turns on for real.
 *  - Not purchasable yet (no server product) → still previews, but shows a calm "coming soon" note.
 */
export function ShieldedDnsToggle({ checked, onChange, disabled, entitled, purchasable }: Props) {
  const [preview, setPreview] = useState(false);
  const loading = entitled === null;
  const locked = entitled === false;
  const lit = locked ? preview : checked;

  // The instant a purchase lands (entitlement flips to true) after a preview, turn the shield on.
  useEffect(() => {
    if (entitled === true && preview) {
      onChange(true);
      setPreview(false);
    }
  }, [entitled, preview, onChange]);

  function toggle() {
    if (disabled || loading) return;
    if (locked) {
      setPreview(true); // preview the shield → reveal the buy button; never jump straight to checkout
      return;
    }
    onChange(!checked);
  }

  const stateLabel = locked ? (preview ? "Preview" : "Premium") : checked ? "Protected" : "Premium";

  return (
    <div>
      <label className={`shield-toggle${lit ? " on" : ""}${disabled || loading ? " disabled" : ""}`}>
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
            <span className="shield-state">{stateLabel}</span>
          </span>
          <span className="shield-sub muted">
            Block ads, trackers &amp; malware on every connected device, in every app — no browser extension, nothing to
            install.{" "}
            {locked ? (
              <>
                <strong>$14.99/yr.</strong> {preview ? "" : "Tap the shield to see it in action."}
              </>
            ) : (
              <>Adds ~30–60s to launch.</>
            )}
          </span>
        </span>
      </label>

      {locked && preview && (
        <div className="shield-cta">
          {purchasable ? (
            <>
              <span className="muted" style={{ fontSize: 13 }}>Looks good? Keep it on for every launch:</span>
              {/* Host-drawn button — plays checkout in the system browser, then the shield turns on. */}
              <agentspoppy-purchase product={SHIELD_PRODUCT_ID} />
            </>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>
              Subscriptions aren't switched on for this poppy yet — check back soon.
            </span>
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
