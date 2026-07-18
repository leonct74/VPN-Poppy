// VPN-Poppy backend — shared types.
// Kept free of AWS-SDK imports so the pure logic (userdata, tags, mapping) is unit-testable.

/**
 * What the frontend sends to launch an endpoint. VPN-Poppy has no reusable "templates"
 * like VM-Poppy — an endpoint is a single on-the-fly resource — so this is a launch
 * request, not a persisted config.
 */
export interface EndpointConfig {
  /** Optional friendly label, e.g. "Frankfurt". Defaults applied server-side. */
  name?: string;
  /** AWS region id, e.g. "eu-central-1". */
  region: string;
  /** t4g.nano (arm64, default) or t3.nano (x86_64, fallback where t4g is absent). */
  instanceType: string;
  arch: "arm64" | "x86_64";
  /**
   * Device slots pre-provisioned at launch (1–20, default 10). Slots are free keypairs;
   * the product promise stays "unlimited devices" (DESIGN §11.2). Unused until P1's key
   * ceremony — carried now so the launch shape is stable.
   */
  deviceSlots: number;
  /**
   * Auto-teardown after N hours (self-destruct). Undefined = keep running until the user
   * tears down. There is deliberately no "stop" state (DESIGN §11.4): running or gone.
   */
  autoTeardownHours?: number;
}

/** A live endpoint's state as reconstructed from EC2 (never from local storage). */
export interface EndpointSummary {
  instanceId: string;
  name: string;
  region: string;
  state: string; // pending | running | shutting-down | terminated | ...
  instanceType: string;
  publicIp?: string;
  launchedAt?: string;
  autoTeardownHours?: number;
}

/** Readiness for one endpoint, derived from the serial console (never local state). */
export interface EndpointStatus {
  state: string;
  /** True once the first-boot script has printed the readiness sentinel. */
  ready: boolean;
}

/**
 * The sentinel the first-boot script prints to the SERIAL CONSOLE when the endpoint is
 * up. The backend detects "ready" via GetConsoleOutput — with no instance IAM role and
 * no SSH (DESIGN §3.4). P1 adds the definitive check: the WireGuard app's handshake.
 */
export const READY_SENTINEL = "VPNPOPPY_READY";

/** The single UDP port WireGuard listens on. The ONLY ingress VPN-Poppy ever opens. */
export const WIREGUARD_PORT = 51820;
