// Rank tracking: every SERP check records where you and your competitors
// ranked, so positions can be followed over time. Stored in this browser.

export interface RankCheck {
  checkedAt: string;
  /** Domain → position (null = not in the checked results). */
  positions: Record<string, number | null>;
  /** Domain → ranking URL. */
  urls?: Record<string, string>;
  /** Whether Google showed an AI Overview, and whether it cited the project's domain. */
  ai?: { present: boolean; cited: boolean };
  features?: string[];
}

const KEY = "metainfo:ranks:v1";
const MAX = 100;

function load(): Record<string, RankCheck[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export const rankKey = (keyword: string, location: number, device: string) => `${keyword.toLowerCase()}|${location}|${device}`;

export function rankHistory(key: string): RankCheck[] {
  return load()[key] ?? [];
}

export function recordRanks(key: string, check: RankCheck): RankCheck[] {
  const all = load();
  const list = [...(all[key] ?? []), check].slice(-MAX);
  all[key] = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked */
  }
  return list;
}

export function trackedKeywords(): { key: string; keyword: string; location: number; device: string; last: RankCheck }[] {
  return Object.entries(load())
    .filter(([, v]) => v.length)
    .map(([key, v]) => {
      const [keyword, location, device] = key.split("|");
      return { key, keyword, location: Number(location), device, last: v[v.length - 1] };
    })
    .sort((a, b) => b.last.checkedAt.localeCompare(a.last.checkedAt));
}

/** Turn a SERP result into a rank check for the given domains (first = the project). */
export function checkFromSerp(
  serp: { checkedAt: string; organic: { position: number; domain: string; url: string }[]; aiOverview: { references: { domain: string }[] } | null; features: string[] },
  domains: string[],
): RankCheck {
  const positions: Record<string, number | null> = {};
  const urls: Record<string, string> = {};
  const owns = (d: string, dom: string) => d === dom || d.endsWith(`.${dom}`);
  for (const dom of domains) {
    const hit = serp.organic.find((o) => owns(o.domain, dom));
    positions[dom] = hit?.position ?? null;
    if (hit) urls[dom] = hit.url;
  }
  const you = domains[0];
  return {
    checkedAt: serp.checkedAt,
    positions,
    urls,
    ai: { present: !!serp.aiOverview, cited: !!you && !!serp.aiOverview?.references.some((r) => owns(r.domain, you)) },
    features: serp.features.filter((f) => f !== "organic"),
  };
}
