interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

/**
 * The premium Shielded DNS toggle, rendered as a delightful "activate the shield" control:
 * off it's a muted outline shield; on, the shield fills, a checkmark strokes in, a soft
 * ring pulses, and the state pill flips to "Protected". This is deliberate — the premium
 * feature should feel valuable the instant the user touches it. All animation is CSS
 * (theme.css `.shield-*`), token-only, and disabled under prefers-reduced-motion.
 */
export function ShieldedDnsToggle({ checked, onChange, disabled }: Props) {
  return (
    <label className={`shield-toggle${checked ? " on" : ""}${disabled ? " disabled" : ""}`}>
      <input
        className="sr-only"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="shield-visual" aria-hidden>
        <svg className="shield-svg" viewBox="0 0 56 64" width="52" height="52">
          <circle className="shield-pulse" cx="28" cy="30" r="21" />
          <path className="shield-body" d="M28 5 L50 14 V30 C50 44 40 54 28 58 C16 54 6 44 6 30 V14 Z" />
          <path className="shield-check" d="M18 31 l7 7 l14 -15" />
        </svg>
      </span>
      <span className="shield-copy">
        <span className="shield-head">
          <strong>Shielded DNS</strong>
          <span className="shield-state">{checked ? "Protected" : "Premium"}</span>
        </span>
        <span className="shield-sub muted">
          Block ads, trackers &amp; malware on every connected device, in every app — no browser extension, nothing to
          install. <strong>Free while testing</strong> (will be $14.99/yr). Adds ~30–60s to launch.
        </span>
      </span>
    </label>
  );
}
