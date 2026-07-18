// VPN-Poppy backend sidecar — the HTTP surface the host proxies frontend calls to, plus
// the teardown hook. Spawned by AgentsPoppy with AGENTSPOPPY_BOOTSTRAP; listens on the
// injected loopback port. See DESIGN.md §2, §13 and AGENTS.md §7.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { EC2Client } from "@aws-sdk/client-ec2";
import { readBootstrap, brokerCredentialsProvider } from "./boot";
import { Ec2Service } from "./ec2";
import { loadUsedRegions, rememberRegion } from "./store";
import type { EndpointConfig } from "./types";

const boot = readBootstrap();
const credentials = brokerCredentialsProvider(boot);

/** A per-region EC2 client, so an endpoint can be launched/managed in any region the user
 *  picks — not just the connection's home region. Cached per region. */
const clients = new Map<string, Ec2Service>();
function svcFor(region: string): Ec2Service {
  let svc = clients.get(region);
  if (!svc) {
    const ec2 = new EC2Client({ region, credentials });
    svc = new Ec2Service(ec2, { accountId: boot.account.accountId, connectionId: boot.connectionId, region });
    clients.set(region, svc);
  }
  return svc;
}

/** All regions we might hold endpoints in: the connection's home region, every region we
 *  persisted having launched into (survives an app restart), and any live this session.
 *  This is what makes background-resume (AGENTS.md §5) and a complete teardown sweep
 *  (AGENTS.md §4) correct even after the app is closed and reopened. */
function regionsInPlay(): string[] {
  return [...new Set<string>([boot.account.region, ...loadUsedRegions(), ...clients.keys()])];
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/** One calm error line (what happened) for the UI — never a raw stack. */
function errorMessage(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return m.length > 400 ? m.slice(0, 400) : m;
}

/** Find an endpoint across every region in play (the frontend addresses it by id alone). */
async function findEndpointRegion(instanceId: string): Promise<string | undefined> {
  for (const region of regionsInPlay()) {
    const found = (await svcFor(region).listEndpoints()).some((e) => e.instanceId === instanceId);
    if (found) return region;
  }
  return undefined;
}

const server = createServer(async (req, res) => {
  try {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);

    // Health / meta
    if (method === "GET" && (parts.length === 0 || parts[0] === "health")) return json(res, 200, { ok: true });
    if (method === "GET" && parts[0] === "meta") {
      return json(res, 200, { account: boot.account, connectionId: boot.connectionId });
    }

    // Endpoints (live EC2 state)
    if (parts[0] === "endpoints") {
      if (method === "GET" && parts.length === 1) {
        // Reconstruct from the cloud across all regions we've touched this session.
        const all = (await Promise.all(regionsInPlay().map((r) => svcFor(r).listEndpoints()))).flat();
        all.sort((a, b) => (b.launchedAt ?? "").localeCompare(a.launchedAt ?? ""));
        return json(res, 200, { endpoints: all });
      }
      if (method === "POST" && parts[1] === "launch" && parts.length === 2) {
        const body = (await readBody(req)) as { config?: EndpointConfig } | undefined;
        const config = body?.config;
        if (!config?.region || !config?.instanceType || !config?.arch) {
          return json(res, 400, { error: "Missing endpoint configuration (region, instance type, architecture)." });
        }
        const endpoint = await svcFor(config.region).launch(config);
        rememberRegion(config.region); // so resume + teardown find it after a restart
        return json(res, 200, { endpoint });
      }
      if (parts.length >= 2) {
        const id = parts[1]!;
        const region = url.searchParams.get("region") ?? (await findEndpointRegion(id));
        if (!region) return json(res, 404, { error: "That endpoint isn't one VPN-Poppy is tracking." });
        if (method === "GET" && parts[2] === "status") return json(res, 200, await svcFor(region).status(id));
        if (method === "POST" && parts[2] === "teardown") {
          await svcFor(region).teardownEndpoint(id);
          return json(res, 200, { ok: true });
        }
      }
    }

    // Teardown hook (host POSTs this at the start of teardown; MUST be idempotent).
    // Sweep every region in play so nothing is left tagged as ours.
    if (method === "POST" && parts[0] === "teardown" && parts.length === 1) {
      const removed = await Promise.all(regionsInPlay().map((r) => svcFor(r).teardown()));
      return json(res, 200, { ok: true, removed });
    }

    return json(res, 404, { error: `No route for ${method} /${parts.join("/")}` });
  } catch (e) {
    return json(res, 500, { error: errorMessage(e) });
  }
});

const port = boot.port ?? (process.env.PORT ? Number(process.env.PORT) : 0);
server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  const actual = typeof addr === "object" && addr ? addr.port : port;
  console.log(`[vpnpoppy] backend listening on 127.0.0.1:${actual} (home region ${boot.account.region})`);
});
