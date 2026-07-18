import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { host, type AccessState } from "./host";
import { LaunchForm } from "./LaunchForm";
import { EndpointCard } from "./EndpointCard";
import { HOURLY_USD, IPV4_HOURLY_USD, formatUsd, isRunning, type EndpointSummary, type Meta } from "./types";

// Served from frontend dir → dist root; same file the manifest declares as the app icon.
const icon = "./vpnpoppy-icon.png";

type Phase = "loading" | "gate" | "ready";

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [access, setAccess] = useState<AccessState>("pending");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const pollRef = useRef<number | null>(null);

  /** Reconstruct live state from AWS (never from local memory) — framework §5. */
  const refresh = useCallback(async () => {
    try {
      const { endpoints: fresh } = await api.listEndpoints();
      setEndpoints(fresh);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  const connect = useCallback(async () => {
    setErr(null);
    try {
      const state = await host.ensureAccess();
      setAccess(state);
      if (state === "granted") {
        await refresh();
        setPhase("ready");
      } else {
        setPhase("gate");
      }
    } catch (e) {
      setErr((e as Error).message);
      setPhase("gate");
    }
  }, [refresh]);

  // Mount: read meta (no AWS), then request access.
  useEffect(() => {
    (async () => {
      try {
        setMeta(await api.meta());
      } catch {
        /* meta is best-effort */
      }
      await connect();
    })();
  }, [connect]);

  // Poll while granted — so a booting endpoint's state + IP fill in on their own, and a
  // teardown started elsewhere is reflected here (background-resume, framework §5).
  useEffect(() => {
    if (access !== "granted") return;
    pollRef.current = window.setInterval(refresh, 8000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [access, refresh]);

  async function launch(config: Parameters<typeof api.launch>[0]) {
    setLaunching(true);
    setErr(null);
    try {
      await api.launch(config);
      await refresh();
      await host.notify({ title: "VPN endpoint launching", body: "Your endpoint is booting — about a minute." });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLaunching(false);
    }
  }

  const header = (
    <div>
      <div className="app-header">
        <img src={icon} alt="" />
        <h1>VPN-Poppy</h1>
      </div>
      <p className="app-sub">
        A personal VPN on the fly, in your own AWS
        {meta ? (
          <>
            {" "}
            · <span className="mono">{meta.account.accountId}</span>
          </>
        ) : null}
      </p>
    </div>
  );

  if (phase === "loading") {
    return (
      <div className="app">
        {header}
        <div className="card">
          <span className="spinner" /> Connecting…
        </div>
      </div>
    );
  }

  if (phase === "gate" || access !== "granted") {
    return (
      <div className="app">
        {header}
        <div className="card">
          <h2 className="section-title">Connect your AWS</h2>
          <p className="muted-2">
            VPN-Poppy needs your approval to use short-lived, scoped access to your AWS account. It can only ever touch
            the VPN endpoints it creates — nothing else.
          </p>
          {access === "denied" && (
            <div className="banner err" style={{ margin: "10px 0" }}>Access was declined. You can approve it to continue.</div>
          )}
          {err && <div className="banner err" style={{ margin: "10px 0" }}>{err}</div>}
          <button className="btn btn-primary" onClick={connect}>Approve access</button>
        </div>
      </div>
    );
  }

  const live = endpoints.filter((e) => e.state !== "terminated");
  const running = live.filter(isRunning);
  const hourly = running.length * ((HOURLY_USD["t4g.nano"] ?? 0) + IPV4_HOURLY_USD);

  return (
    <div className="app">
      {header}
      {err && (
        <div className="banner err" style={{ marginBottom: 14 }}>
          {err} <button className="btn btn-sm btn-ghost" onClick={connect}>Reconnect</button>
        </div>
      )}

      {live.length === 0 && (
        <div className="banner info" style={{ marginBottom: 14 }}>
          A VPN endpoint that exists only while you need it. Launch one before you join the airport Wi-Fi; tear it down
          after. Websites see the endpoint's IP — never your home IP — and no VPN company sits in between, because there
          isn't one.
        </div>
      )}

      <LaunchForm busy={launching} onLaunch={launch} homeRegion={meta?.account.region} />

      <div className="spread" style={{ margin: "18px 2px 8px" }}>
        <h2 className="section-title" style={{ margin: 0 }}>Your endpoints</h2>
        <button className="btn btn-sm btn-ghost" onClick={refresh}>Refresh</button>
      </div>

      {running.length === 0 ? (
        <div className="banner info" style={{ marginBottom: 12 }}>
          <span className="badge ok" style={{ marginRight: 8 }}>
            <span className="dot" />$0/hr
          </span>
          Nothing running — you're not being billed.
        </div>
      ) : (
        <div className="banner" style={{ marginBottom: 12, borderColor: "var(--poppy-accent)" }}>
          <strong>Running now:</strong> {running.length} endpoint{running.length > 1 ? "s" : ""} ≈{" "}
          <strong>{formatUsd(hourly)}/hr</strong>
          <span className="muted"> · approx, plus data transfer. Tear down to reach $0.</span>
        </div>
      )}

      {live.length === 0 ? (
        <div className="card">
          <span className="muted">No endpoints yet. Pick a region above and hit Launch VPN — it's up in about a minute.</span>
        </div>
      ) : (
        live.map((e) => <EndpointCard key={e.instanceId} endpoint={e} onChanged={refresh} />)
      )}
    </div>
  );
}
