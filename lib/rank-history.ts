// Rank tracking: every SERP check records where you and your competitors
// ranked, so positions can be followed over time. Stored in this browser.

export interface RankCheck {
  checkedAt: string;
  /** Domain → position (null = not in the checked results). */
  positions: Record<string, number | null>;
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
