// Frontend mirror of the backend's shared types (kept in sync by hand — small surface).

export interface EndpointConfig {
  name?: string;
  region: string;
  instanceType: string;
  arch: "arm64" | "x86_64";
  deviceSlots: number;
  autoTeardownHours?: number;
}

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

export interface EndpointStatus {
  state: string;
  ready: boolean;
}

export interface Meta {
  account: { accountId: string; region: string };
  connectionId: string;
}

/** The regions VPN-Poppy offers (mirror of backend/src/regions.ts). */
export interface RegionInfo {
  id: string;
  city: string;
  flag: string;
}

export const REGIONS: RegionInfo[] = [
  { id: "us-east-1", city: "N. Virginia", flag: "🇺🇸" },
  { id: "us-east-2", city: "Ohio", flag: "🇺🇸" },
  { id: "us-west-2", city: "Oregon", flag: "🇺🇸" },
  { id: "ca-central-1", city: "Canada", flag: "🇨🇦" },
  { id: "eu-west-1", city: "Ireland", flag: "🇮🇪" },
  { id: "eu-west-2", city: "London", flag: "🇬🇧" },
  { id: "eu-west-3", city: "Paris", flag: "🇫🇷" },
  { id: "eu-central-1", city: "Frankfurt", flag: "🇩🇪" },
  { id: "eu-north-1", city: "Stockholm", flag: "🇸🇪" },
  { id: "eu-south-1", city: "Milan", flag: "🇮🇹" },
  { id: "ap-south-1", city: "Mumbai", flag: "🇮🇳" },
  { id: "ap-southeast-1", city: "Singapore", flag: "🇸🇬" },
  { id: "ap-southeast-2", city: "Sydney", flag: "🇦🇺" },
  { id: "ap-northeast-1", city: "Tokyo", flag: "🇯🇵" },
  { id: "ap-northeast-2", city: "Seoul", flag: "🇰🇷" },
  { id: "sa-east-1", city: "São Paulo", flag: "🇧🇷" },
];

/** Default endpoint size: cheapest Graviton (mirror of backend DEFAULT_INSTANCE). */
export const DEFAULT_INSTANCE = { instanceType: "t4g.nano", arch: "arm64" as const };

export function regionLabel(id: string): string {
  const r = REGIONS.find((x) => x.id === id);
  return r ? `${r.flag} ${r.city}` : id;
}

/**
 * Rough on-demand hourly rate for the endpoint sizes, USD (Linux). APPROX — varies by
 * region; the live Price List API replaces this in P2 (DESIGN §4). Used only for the
 * "≈ $/hr" hint next to the choice, always labelled approximate.
 */
export const HOURLY_USD: Record<string, number> = {
  "t4g.nano": 0.0042,
  "t3.nano": 0.0052,
};

/** Public-IPv4 hourly charge AWS applies to a running instance (~$0.005/hr). */
export const IPV4_HOURLY_USD = 0.005;

export function formatUsd(n: number): string {
  return n < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

export function isRunning(e: EndpointSummary): boolean {
  return e.state === "running" || e.state === "pending";
}
