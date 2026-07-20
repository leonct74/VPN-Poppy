import { useState } from "react";
import { DEFAULT_INSTANCE, HOURLY_USD, IPV4_HOURLY_USD, REGIONS, formatUsd, type EndpointConfig } from "./types";

interface Props {
  busy: boolean;
  onLaunch: (config: EndpointConfig) => void;
  /** The connection's home region — used as the default pick. */
  homeRegion?: string;
}

/** The deploy card (DESIGN §7): pick a region, choose device slots + lifecycle, one button. */
export function LaunchForm({ busy, onLaunch, homeRegion }: Props) {
  const defaultRegion = REGIONS.some((r) => r.id === homeRegion) ? homeRegion! : "eu-central-1";
  const [name, setName] = useState("");
  const [region, setRegion] = useState(defaultRegion);
  const [deviceSlots, setDeviceSlots] = useState(10);
  const [autoTeardown, setAutoTeardown] = useState(true);
  const [hours, setHours] = useState(8);
  const [shieldedDns, setShieldedDns] = useState(false);

  const hourly = (HOURLY_USD[DEFAULT_INSTANCE.instanceType] ?? 0) + IPV4_HOURLY_USD;

  function submit() {
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
      <h2 className="section-title">Launch a VPN endpoint</h2>

      <div className="grid-2">
        <label className="field">
          <span>Region — where your traffic exits to the internet</span>
          <select className="select" value={region} onChange={(e) => setRegion(e.target.value)} disabled={busy}>
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.flag} {r.city} · {r.id}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Name (optional) — just a label for you</span>
          <input
            className="input"
            placeholder="e.g. Airport"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      <label className="field">
        <span>Device slots — {deviceSlots} (add more anytime with a ~60s relaunch)</span>
        <input
          className="input"
          type="range"
          min={1}
          max={20}
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
        <span>Lifecycle</span>
        <div className="row" style={{ gap: 16 }}>
          <label className="row" style={{ gap: 6 }}>
            <input type="radio" checked={autoTeardown} onChange={() => setAutoTeardown(true)} disabled={busy} />
            <span>Auto tear down after</span>
            <input
              className="input"
              type="number"
              min={1}
              max={720}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              disabled={busy || !autoTeardown}
              style={{ width: 72 }}
            />
            <span>hours</span>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="radio" checked={!autoTeardown} onChange={() => setAutoTeardown(false)} disabled={busy} />
            <span>Keep running until I tear it down</span>
          </label>
        </div>
      </label>

      <label className="field">
        <span>Premium</span>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={shieldedDns}
            onChange={(e) => setShieldedDns(e.target.checked)}
            disabled={busy}
            style={{ marginTop: 3 }}
          />
          <div>
            <div>
              🛡️ <strong>Shielded DNS</strong> — block ads, trackers &amp; malware on every connected device, in every
              app.
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Turns this endpoint's DNS into an ad, tracker &amp; malware blocker — no browser extension, nothing to
              install on your devices. <strong>Free while testing</strong> (will be $14.99/yr). Adds ~30–60s to launch.
            </div>
          </div>
        </div>
      </label>

      <div className="banner info" style={{ margin: "8px 0 14px" }}>
        <strong>≈ {formatUsd(hourly)}/hr</strong> while running ({DEFAULT_INSTANCE.instanceType} + public IP, approx) — plus
        data transfer out at ~$0.09/GB (first 100 GB/mo free). An evening of browsing is well under a GB — cents.{" "}
        <span className="muted">A live meter shows the real number once it's up.</span>
      </div>

      <button className="btn btn-primary" onClick={submit} disabled={busy}>
        {busy ? (
          <>
            <span className="spinner" /> Launching…
          </>
        ) : (
          "Launch VPN"
        )}
      </button>
    </div>
  );
}
