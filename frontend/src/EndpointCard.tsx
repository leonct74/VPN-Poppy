import { useEffect, useState } from "react";
import { api } from "./api";
import { CopyButton } from "./CopyButton";
import { DeviceConfigs } from "./DeviceConfigs";
import { host } from "./host";
import { regionLabel, SHIELD_CANARY, SHIELD_CANARY_IP, type EndpointStatus, type EndpointSummary } from "./types";

/** The in-tunnel resolver address devices query (the WireGuard gateway). */
const SERVER_ADDR = "10.8.0.1";

interface Props {
  endpoint: EndpointSummary;
  onChanged: () => void;
}

function stateBadge(e: EndpointSummary, ready: boolean) {
  if (e.state === "pending") return <span className="badge warn"><span className="spinner" />booting…</span>;
  if (e.state === "shutting-down" || e.state === "stopping") return <span className="badge warn"><span className="spinner" />tearing down…</span>;
  if (e.state === "running") {
    return ready
      ? <span className="badge ok"><span className="dot" />ready</span>
      : <span className="badge warn"><span className="spinner" />starting up…</span>;
  }
  return <span className="badge"><span className="dot" />{e.state}</span>;
}

export function EndpointCard({ endpoint, onChanged }: Props) {
  const [status, setStatus] = useState<EndpointStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Poll this endpoint's readiness from the cloud until it's ready (never from memory).
  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const s = await api.status(endpoint.instanceId);
        if (alive) setStatus(s);
        return s.ready;
      } catch {
        return false;
      }
    }
    void check();
    if (endpoint.state !== "running" || !status?.ready) {
      const t = window.setInterval(async () => {
        const ready = await check();
        if (ready) window.clearInterval(t);
      }, 6000);
      return () => {
        alive = false;
        window.clearInterval(t);
      };
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint.instanceId, endpoint.state]);

  const ready = status?.ready ?? false;
  const ip = endpoint.publicIp;

  async function tearDown() {
    setBusy(true);
    setErr(null);
    try {
      await api.teardown(endpoint.instanceId);
      setConfirming(false);
      await host.notify({ title: "Endpoint torn down", body: `“${endpoint.name}” is being deleted — no longer billing.` });
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="spread">
        <div className="row" style={{ gap: 8 }}>
          <strong>{endpoint.name}</strong>
          {stateBadge(endpoint, ready)}
          {endpoint.autoTeardownHours ? (
            <span className="badge warn"><span className="dot" />auto-teardown {endpoint.autoTeardownHours}h</span>
          ) : null}
          {endpoint.shielded ? (
            <span className="badge ok"><span className="dot" />🛡️ Shielded DNS</span>
          ) : null}
        </div>
        <span className="mono muted" style={{ fontSize: 12 }}>{regionLabel(endpoint.region)}</span>
      </div>

      <div className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>
        AWS id {endpoint.instanceId} · {endpoint.instanceType}
        {endpoint.launchedAt ? ` · launched ${new Date(endpoint.launchedAt).toLocaleString()}` : ""}
      </div>

      {/* Endpoint address */}
      <div className="card card-2" style={{ marginTop: 10, marginBottom: 10 }}>
        <div className="section-title">Endpoint address</div>
        {ip ? (
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="chip" style={{ userSelect: "all" }}>{ip}:51820</span>
            <CopyButton text={`${ip}:51820`} label="endpoint address" />
            <span className="muted" style={{ fontSize: 12 }}>UDP · WireGuard — the only open port</span>
          </div>
        ) : (
          <div className="muted">Waiting for a public IP…</div>
        )}
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          UDP is the only open port. WireGuard stays silent to anything without a valid key, so the box is invisible to
          port scans.
        </div>
      </div>

      {endpoint.shielded && (
        <div className="banner" style={{ borderColor: "var(--poppy-ok)", marginBottom: 10, fontSize: 12 }}>
          🛡️ <strong>Shielded DNS is on.</strong> Ads, trackers &amp; malware domains are blocked for every connected
          device. To prove it, connect a device and run{" "}
          <span className="chip">nslookup {SHIELD_CANARY} {SERVER_ADDR}</span> — it answers{" "}
          <span className="chip">{SHIELD_CANARY_IP}</span> only when the shield is live. A blocked domain like{" "}
          <span className="chip">nslookup doubleclick.net {SERVER_ADDR}</span> returns nothing (NXDOMAIN).
        </div>
      )}

      {(endpoint.state === "running" || endpoint.state === "pending") && (
        <DeviceConfigs endpointId={endpoint.instanceId} hasIp={!!ip} />
      )}

      {err && <div className="banner err" style={{ marginBottom: 10 }}>{err}</div>}

      <div className="row">
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => setConfirming(true)}>
          {busy ? <><span className="spinner" /> Tearing down…</> : "Tear down"}
        </button>
        {ip && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={() =>
              host.openExternal(
                `https://${endpoint.region}.console.aws.amazon.com/ec2/home?region=${endpoint.region}#InstanceDetails:instanceId=${endpoint.instanceId}`,
              )
            }
          >
            Open in AWS console
          </button>
        )}
      </div>

      {confirming && (
        <div className="scrim" onClick={() => !busy && setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Tear down “{endpoint.name}”?</h3>
            <p className="muted-2">
              This permanently <strong>terminates</strong> endpoint{" "}
              <span className="chip">{endpoint.instanceId}</span> and deletes its firewall. It{" "}
              <strong>stops billing immediately</strong> and <strong>cannot be undone</strong> — your devices will
              disconnect. Relaunching a fresh endpoint takes about a minute.
            </p>
            {err && <div className="banner err" style={{ marginBottom: 10 }}>{err}</div>}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
              {/* Cancel is the default focus, so a stray Enter/double-click can't destroy. */}
              <button className="btn" onClick={() => setConfirming(false)} disabled={busy} autoFocus>Cancel</button>
              <button className="btn btn-danger" disabled={busy} onClick={tearDown}>
                {busy ? <><span className="spinner" /> Tearing down…</> : "Tear down"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
