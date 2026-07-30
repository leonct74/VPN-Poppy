import { useState } from "react";
import { copyText } from "./CopyButton";
import { ShieldedDnsToggle } from "./ShieldedDnsToggle";
import { buildHelperPrompt } from "./helper-prompt";
import { COST_FACTS, DEFAULT_INSTANCE, HOURLY_USD, IPV4_HOURLY_USD, LAUNCH_FIELDS, REGIONS, formatUsd, type EndpointConfig, type PurchasePrice } from "./types";

interface Props {
  busy: boolean;
  onLaunch: (config: EndpointConfig) => void;
  /** The connection's home region — used as the default pick. */
  homeRegion?: string;
  /** Shielded DNS entitlement: null = loading, true = subscribed, false = not. */
  shieldEntitled: boolean | null;
  /** True when a priced Shielded DNS product exists server-side. */
  shieldPurchasable: boolean;
  /** The server-set price for Shielded DNS (null while loading / not for sale). */
  shieldPrice: PurchasePrice | null;
}

/**
 * "Copy the helper prompt" — the INLINE variant (AGENTS.md §9). Inline rather than a banner
 * because this card is already carrying a premium panel and a cost banner in a narrow frame;
 * a third strip would be banner-on-banner. Sits beside the card's own title. Pulses until
 * first used; the kit's class holds still under prefers-reduced-motion.
 */
function HelperPromptButton(props: { homeRegion?: string; shieldPurchasable: boolean }) {
  const [copied, setCopied] = useState(false);
  const [used, setUsed] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    const ok = await copyText(buildHelperPrompt(props));
    setUsed(true);
    setCopied(ok);
    setFailed(!ok);
    window.setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2500);
  }

  return (
    <button
      className={`btn btn-sm btn-primary${used ? "" : " poppy-helper-pulse"}`}
      onClick={copy}
      title="Copies a prompt that explains this form. Paste it into any AI, say what you want the VPN for, and it tells you what to set."
    >
      {copied ? "Copied ✓" : failed ? "Select & copy manually" : "✨ Copy the helper prompt"}
    </button>
  );
}

/** The deploy card (DESIGN §7): pick a region, choose device slots + lifecycle, one button. */
export function LaunchForm({ busy, onLaunch, homeRegion, shieldEntitled, shieldPurchasable, shieldPrice }: Props) {
  const defaultRegion = REGIONS.some((r) => r.id === homeRegion) ? homeRegion! : LAUNCH_FIELDS.region.fallback;
  const [name, setName] = useState("");
  const [region, setRegion] = useState(defaultRegion);
  const [deviceSlots, setDeviceSlots] = useState<number>(LAUNCH_FIELDS.deviceSlots.default);
  const [autoTeardown, setAutoTeardown] = useState(true);
  const [hours, setHours] = useState<number>(LAUNCH_FIELDS.lifecycle.defaultHours);
  const [shieldedDns, setShieldedDns] = useState(false);

  const hourly = (HOURLY_USD[DEFAULT_INSTANCE.instanceType] ?? 0) + IPV4_HOURLY_USD;
  // Shielded DNS selected but not yet paid for → Launch is blocked until they subscribe or
  // turn it off. This is the client-side guard that keeps the premium feature paid-for.
  const shieldBlocking = shieldedDns && shieldEntitled !== true;

  function submit() {
    if (shieldBlocking) return; // guard: never launch a selected-but-unpaid shield
    onLaunch({
      name: name.trim() || undefined,
      region,
      instanceType: DEFAULT_INSTANCE.instanceType,
      arch: DEFAULT_INSTANCE.arch,
      deviceSlots,
      autoTeardownHours: autoTeardown ? Math.max(1, Math.round(hours)) : undefined,
      shieldedDns,
    });
  }

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Launch a VPN endpoint</h2>
        <HelperPromptButton homeRegion={homeRegion} shieldPurchasable={shieldPurchasable} />
      </div>

      <div className="grid-2">
        <label className="field">
          <span>{LAUNCH_FIELDS.region.label}</span>
          <select className="select" value={region} onChange={(e) => setRegion(e.target.value)} disabled={busy}>
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.flag} {r.city} · {r.id}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{LAUNCH_FIELDS.name.label}</span>
          <input
            className="input"
            placeholder={LAUNCH_FIELDS.name.placeholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      <label className="field">
        <span>
          {LAUNCH_FIELDS.deviceSlots.label} — {deviceSlots} (add more anytime with a ~60s relaunch)
        </span>
        <input
          className="input"
          type="range"
          min={LAUNCH_FIELDS.deviceSlots.min}
          max={LAUNCH_FIELDS.deviceSlots.max}
          value={deviceSlots}
          onChange={(e) => setDeviceSlots(Number(e.target.value))}
          disabled={busy}
        />
        <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Unlimited devices — slots are just free keys generated up front. Phone, laptop, tablet… scan a QR or
          download a config for each.
        </span>
      </label>

      <label className="field">
        <span>{LAUNCH_FIELDS.lifecycle.label}</span>
        <div className="row" style={{ gap: 16 }}>
          <label className="row" style={{ gap: 6 }}>
            <input type="radio" checked={autoTeardown} onChange={() => setAutoTeardown(true)} disabled={busy} />
            <span>{LAUNCH_FIELDS.lifecycle.autoLabel}</span>
            <input
              className="input"
              type="number"
              min={LAUNCH_FIELDS.lifecycle.minHours}
              max={LAUNCH_FIELDS.lifecycle.maxHours}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              disabled={busy || !autoTeardown}
              style={{ width: 72 }}
            />
            <span>hours</span>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="radio" checked={!autoTeardown} onChange={() => setAutoTeardown(false)} disabled={busy} />
            <span>{LAUNCH_FIELDS.lifecycle.keepLabel}</span>
          </label>
        </div>
      </label>

      <div style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 6 }}>Premium</div>
        <ShieldedDnsToggle
          checked={shieldedDns}
          onChange={setShieldedDns}
          disabled={busy}
          entitled={shieldEntitled}
          purchasable={shieldPurchasable}
          price={shieldPrice}
        />
      </div>

      <div className="banner info" style={{ margin: "8px 0 14px" }}>
        <strong>≈ {formatUsd(hourly)}/hr</strong> while running ({DEFAULT_INSTANCE.instanceType} + public IP, approx) — plus
        data transfer out at ~${COST_FACTS.egressPerGb.toFixed(2)}/GB (first {COST_FACTS.freeEgressGbPerMonth} GB/mo
        free). {COST_FACTS.note}
      </div>

      <div className="row" style={{ gap: 12 }}>
        <button className="btn btn-primary" onClick={submit} disabled={busy || shieldBlocking}>
          {busy ? (
            <>
              <span className="spinner" /> Launching…
            </>
          ) : (
            "Launch VPN"
          )}
        </button>
        {shieldBlocking && (
          <span className="muted" style={{ fontSize: 13 }}>
            Subscribe to Shielded DNS, or turn it off, to launch.
          </span>
        )}
      </div>
    </div>
  );
}
