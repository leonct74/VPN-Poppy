import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api } from "./api";
import { CopyButton } from "./CopyButton";
import { host } from "./host";
import type { DeviceConfig, DevicesResponse } from "./types";

const WIREGUARD_INSTALL_URL = "https://www.wireguard.com/install/";

interface Props {
  endpointId: string;
  /** True once the endpoint has a public IP — device configs need it to be complete. */
  hasIp: boolean;
}

/** Renders a WireGuard .conf into a QR canvas the WireGuard app can scan. */
function Qr({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, text, { width: 240, margin: 1 }).catch(() => setErr(true));
  }, [text]);
  if (err) return <div className="muted">Couldn't draw the QR — use the .conf download instead.</div>;
  return <canvas ref={ref} width={240} height={240} style={{ borderRadius: 8, background: "#fff", padding: 8 }} />;
}

function download(name: string, conf: string) {
  const blob = new Blob([conf], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vpnpoppy-${name.replace(/[^A-Za-z0-9._-]/g, "_") || "device"}.conf`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DeviceConfigs({ endpointId, hasIp }: Props) {
  const [data, setData] = useState<DevicesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [qr, setQr] = useState<DeviceConfig | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.devices(endpointId));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [endpointId]);

  useEffect(() => {
    void load();
  }, [load, hasIp]);

  async function saveName(index: number) {
    const name = draft.trim();
    if (name) {
      try {
        await api.renameDevice(endpointId, index, name);
      } catch (e) {
        setErr((e as Error).message);
      }
    }
    setRenaming(null);
    await load();
  }

  if (err) return <div className="banner err" style={{ marginTop: 10 }}>{err}</div>;
  if (!data) return <div className="muted" style={{ marginTop: 10, fontSize: 12 }}><span className="spinner" /> Loading devices…</div>;

  const emoji = (i: number) => (i === 0 ? "📱" : i === 1 ? "💻" : i === 2 ? "📟" : "🖥️");

  return (
    <div className="card card-2" style={{ marginTop: 10 }}>
      <div className="section-title">Your devices — {data.devices.length} slots</div>

      {/* Upfront: you need the WireGuard app BEFORE the QR is any use (a QR holds a config,
          not a link — the phone camera can't use it). Shown before the device rows so nobody
          reaches for their camera first. */}
      <div className="banner" style={{ borderColor: "var(--poppy-accent)", marginBottom: 12 }}>
        <strong>Each device needs the free WireGuard app first.</strong>
        <div style={{ marginTop: 4 }}>
          📱 <strong>Phone:</strong> scan the QR <strong>from inside WireGuard</strong> — not your camera (the QR is a
          config, not a web link).
        </div>
        <div style={{ marginTop: 2 }}>
          💻 <strong>Laptop:</strong> use <strong>Download .conf</strong>, then Import it into WireGuard.
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          WireGuard is free and open-source — <strong>not a VPN company</strong>. It just runs the tunnel on your device
          and connects only to your endpoint, so no one sits in the middle.
        </div>
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-sm" onClick={() => host.openExternal(WIREGUARD_INSTALL_URL)}>
            Get the WireGuard app
          </button>
        </div>
      </div>

      {!hasIp && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Waiting for the endpoint's address — configs complete once it's up.
        </div>
      )}
      <div className="stack">
        {data.devices.map((d) => (
          <div key={d.index} className="spread">
            <div className="row" style={{ gap: 8 }}>
              <span>{emoji(d.index)}</span>
              {renaming === d.index ? (
                <input
                  className="input"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveName(d.index)}
                  onBlur={() => saveName(d.index)}
                  style={{ width: 140, padding: "3px 8px" }}
                />
              ) : (
                <button
                  className="btn btn-sm btn-ghost"
                  title="Rename this device"
                  onClick={() => {
                    setRenaming(d.index);
                    setDraft(d.name);
                  }}
                  style={{ fontWeight: 600 }}
                >
                  {d.name}
                </button>
              )}
              <span className="mono muted" style={{ fontSize: 12 }}>{d.address}</span>
            </div>
            <div className="row">
              <button className="btn btn-sm" disabled={!d.conf} onClick={() => d.conf && setQr(d)}>Show QR</button>
              <button className="btn btn-sm btn-ghost" disabled={!d.conf} onClick={() => d.conf && download(d.name, d.conf)}>
                Download .conf
              </button>
            </div>
          </div>
        ))}
      </div>

      {qr && qr.conf && (
        <div className="scrim" onClick={() => setQr(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
            <h3 style={{ marginTop: 0 }}>{qr.name}</h3>
            <p className="muted-2" style={{ fontSize: 13 }}>
              Open the free <strong>WireGuard app</strong> on your device → tap <strong>＋</strong> →{" "}
              <strong>Create/Scan from QR code</strong> → point it here.
            </p>
            <div className="banner" style={{ fontSize: 12, margin: "0 0 10px", textAlign: "left" }}>
              Use the WireGuard app to scan — <strong>not your phone's camera</strong>. A WireGuard QR holds a config,
              not a web link, so the camera app will just offer to search for it.
            </div>
            <div style={{ display: "flex", justifyContent: "center", margin: "10px 0" }}>
              <Qr text={qr.conf} />
            </div>
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn btn-sm btn-ghost" onClick={() => download(qr.name, qr.conf!)}>Download .conf instead</button>
              <CopyButton text={qr.conf} label="config" />
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              This config contains a private key — treat it like a password. Anyone with it can use your tunnel.
            </p>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn" onClick={() => setQr(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
