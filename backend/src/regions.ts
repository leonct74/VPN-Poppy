// The regions VPN-Poppy offers, with friendly city labels for the picker (DESIGN §7).
// A curated list of general-purpose AWS regions where t4g (Graviton) is available, so
// the default t4g.nano launches everywhere on this list. Ordering is roughly by
// geography for the picker; the frontend adds a "closest to you" latency hint (P2).

export interface RegionInfo {
  /** AWS region id, e.g. "eu-central-1". */
  id: string;
  /** Human city/area label for the picker. */
  city: string;
  /** Flag emoji for the picker. */
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

/** The default endpoint size: cheapest Graviton — ~$0.004/hr (DESIGN §1, §4). */
export const DEFAULT_INSTANCE = { instanceType: "t4g.nano", arch: "arm64" as const };

/** x86 fallback for the rare region without t4g (revisit dynamic detection post-MVP). */
export const FALLBACK_INSTANCE = { instanceType: "t3.nano", arch: "x86_64" as const };

export function regionLabel(id: string): string {
  const r = REGIONS.find((x) => x.id === id);
  return r ? `${r.flag} ${r.city}` : id;
}
