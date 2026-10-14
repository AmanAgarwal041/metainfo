// Merging two copies of a workspace value (this browser's and the account's)
// without losing either side's work. Values are JSON: projects, scan history,
// rank checks, crawl and AI-visibility runs. Lists are unioned by each record's
// identity, objects merged key by key; on a true conflict this browser wins.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const isObj = (v: unknown): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A record's identity: its id, or the timestamp/URL fields history entries are keyed by. */
function identity(v: Json): string {
  if (isObj(v)) {
    for (const k of ["id", "at", "date", "time", "ts", "checkedAt", "scannedAt", "url", "key"]) {
      const x = v[k];
      if (typeof x === "string" || typeof x === "number") return `${k}:${x}`;
    }
  }
  return `json:${JSON.stringify(v)}`;
}

export function mergeJson(remote: Json, local: Json): Json {
  if (Array.isArray(remote) && Array.isArray(local)) {
    const out = new Map<string, Json>();
    for (const r of remote) out.set(identity(r), r);
    for (const l of local) {
      const id = identity(l);
      out.set(id, out.has(id) ? mergeJson(out.get(id)!, l) : l);
    }
    const merged = [...out.values()];
    // History lists are chronological: keep that order when records carry a timestamp.
    const time = (v: Json) => (isObj(v) ? Number(new Date((v.at ?? v.date ?? v.time ?? v.ts ?? v.checkedAt ?? v.scannedAt) as string | number)) : NaN);
    if (merged.every((v) => !Number.isNaN(time(v)))) merged.sort((a, b) => time(a) - time(b));
    return merged;
  }
  if (isObj(remote) && isObj(local)) {
    const out: Record<string, Json> = { ...remote };
    for (const [k, v] of Object.entries(local)) out[k] = k in remote ? mergeJson(remote[k], v) : v;
    return out;
  }
  return local === undefined ? remote : local;
}

/** Merge two serialised values; falls back to this browser's copy if either isn't JSON. */
export function mergeValues(remote: string, local: string): string {
  try {
    return JSON.stringify(mergeJson(JSON.parse(remote), JSON.parse(local)));
  } catch {
    return local;
  }
}
