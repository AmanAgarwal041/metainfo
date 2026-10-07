// DataForSEO v3 client (https://docs.dataforseo.com/v3/). Live endpoints, one
// task per request, Basic auth. Responses are cached in memory so repeat
// lookups don't cost money twice.

import type {
  Anchor,
  Backlink,
  BacklinkSummary,
  Intent,
  KeywordMetrics,
  OrganicMetrics,
  ReferringDomain,
} from "@/lib/research-types";

// DATAFORSEO_API_URL can point at the sandbox (https://sandbox.dataforseo.com/v3/) for free testing.
const BASE = process.env.DATAFORSEO_API_URL ?? "https://api.dataforseo.com/v3/";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX = 500;

export class ProviderError extends Error {
  constructor(message: string, public status = 502, public code?: number) {
    super(message);
  }
}

export function dataForSeoConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const cache = new Map<string, { at: number; result: Json; cost: number }>();

const FRIENDLY: Record<number, string> = {
  40100: "DataForSEO rejected the credentials. Check DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD (use the API password from app.dataforseo.com/api-access).",
  40200: "DataForSEO says payment is required. Top up your balance at app.dataforseo.com.",
  40210: "Your DataForSEO balance is too low for this request. Top up at app.dataforseo.com.",
  40202: "DataForSEO rate limit reached (2000 requests/min). Try again in a minute.",
  40209: "Too many simultaneous DataForSEO requests. Try again in a moment.",
  40204: "The DataForSEO Backlinks API isn't activated on this account. Enable it at app.dataforseo.com/backlinks-subscription.",
};

export interface CallResult {
  result: Json;
  cost: number;
  cached: boolean;
}

/** POST one task to a live endpoint and return `tasks[0].result[0]`. */
export async function call(path: string, task: Record<string, unknown>): Promise<CallResult> {
  if (!dataForSeoConfigured()) throw new ProviderError("DataForSEO isn't configured.", 501);
  const key = `${path}|${JSON.stringify(task)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { result: hit.result, cost: 0, cached: true };

  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new ProviderError(`Couldn't reach DataForSEO: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body: Json = await res.json().catch(() => null);
  if (!body) throw new ProviderError(`DataForSEO returned HTTP ${res.status} with no JSON body.`);

  const top = body.status_code as number | undefined;
  if (top !== 20000) {
    throw new ProviderError(FRIENDLY[top ?? 0] ?? `DataForSEO error ${top}: ${body.status_message}`, top === 40100 ? 401 : 502, top);
  }
  const t = body.tasks?.[0];
  if (!t || t.status_code !== 20000) {
    const code = t?.status_code as number | undefined;
    // 40102 = "No Search Results": a valid, empty answer.
    if (code === 40102) return { result: null, cost: Number(t?.cost ?? 0), cached: false };
    throw new ProviderError(FRIENDLY[code ?? 0] ?? `DataForSEO task error ${code}: ${t?.status_message}`, 502, code);
  }
  const result = t.result?.[0] ?? null;
  const cost = Number(t.cost ?? body.cost ?? 0);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), result, cost });
  return { result, cost, cached: false };
}

/** GET a free catalog endpoint (e.g. model lists), cached for a day. */
export async function getCatalog(path: string): Promise<Json> {
  if (!dataForSeoConfigured()) throw new ProviderError("DataForSEO isn't configured.", 501);
  const key = `GET|${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 60 * 60 * 1000) return hit.result;
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64");
  const res = await fetch(BASE + path, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(30_000) });
  const body: Json = await res.json().catch(() => null);
  if (!body || body.status_code !== 20000) {
    throw new ProviderError(FRIENDLY[body?.status_code ?? 0] ?? `DataForSEO error ${body?.status_code}: ${body?.status_message ?? res.status}`, 502, body?.status_code);
  }
  const result = body.tasks?.[0]?.result ?? null;
  cache.set(key, { at: Date.now(), result, cost: 0 });
  return result;
}

// ---------------------------------------------------------------- normalisers

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const INTENTS: Intent[] = ["informational", "navigational", "commercial", "transactional"];

/** Accepts a Labs keyword item (`keyword_info` at top level) or its `keyword_data` wrapper. */
export function keywordMetrics(item: Json): KeywordMetrics | null {
  const k = item?.keyword_data ?? item;
  if (!k?.keyword) return null;
  const info = k.keyword_info ?? {};
  const monthly: Json[] = Array.isArray(info.monthly_searches) ? info.monthly_searches : [];
  const trend = monthly
    .filter((m) => typeof m?.search_volume === "number")
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map((m) => m.search_volume as number);
  const intent = k.search_intent_info?.main_intent;
  return {
    keyword: String(k.keyword),
    volume: num(info.search_volume),
    difficulty: num(k.keyword_properties?.keyword_difficulty),
    cpc: num(info.cpc),
    competition: num(info.competition),
    intent: INTENTS.includes(intent) ? intent : null,
    trend: trend.slice(-12),
  };
}

export function organicMetrics(m: Json): OrganicMetrics {
  const o = m?.organic ?? m ?? {};
  return {
    keywords: num(o.count) ?? 0,
    traffic: Math.round(num(o.etv) ?? 0),
    pos1: num(o.pos_1) ?? 0,
    pos2_3: num(o.pos_2_3) ?? 0,
    pos4_10: num(o.pos_4_10) ?? 0,
    pos11_20: num(o.pos_11_20) ?? 0,
  };
}

export function backlinkSummary(r: Json, target: string): BacklinkSummary {
  return {
    target,
    rank: num(r?.rank) ?? 0,
    backlinks: num(r?.backlinks) ?? 0,
    referringDomains: num(r?.referring_domains) ?? 0,
    referringMainDomains: num(r?.referring_main_domains) ?? 0,
    referringIps: num(r?.referring_ips) ?? 0,
    nofollowBacklinks: num(r?.referring_links_attributes?.nofollow) ?? 0,
    brokenBacklinks: num(r?.broken_backlinks) ?? 0,
    spamScore: num(r?.backlinks_spam_score),
    firstSeen: r?.first_seen ?? null,
    tlds: r?.referring_links_tld && typeof r.referring_links_tld === "object" ? r.referring_links_tld : {},
  };
}

export function backlink(i: Json): Backlink {
  return {
    domainFrom: String(i?.domain_from ?? ""),
    urlFrom: String(i?.url_from ?? ""),
    urlTo: String(i?.url_to ?? ""),
    anchor: String(i?.anchor ?? ""),
    dofollow: Boolean(i?.dofollow),
    domainRank: num(i?.domain_from_rank),
    firstSeen: i?.first_seen ?? null,
    lastSeen: i?.last_seen ?? null,
    isNew: Boolean(i?.is_new),
    isLost: Boolean(i?.is_lost),
  };
}

export function referringDomain(i: Json): ReferringDomain {
  return { domain: String(i?.domain ?? ""), rank: num(i?.rank), backlinks: num(i?.backlinks) ?? 0, firstSeen: i?.first_seen ?? null };
}

export function anchor(i: Json): Anchor {
  return { anchor: String(i?.anchor ?? ""), backlinks: num(i?.backlinks) ?? 0, referringDomains: num(i?.referring_domains) ?? 0 };
}

export const items = (r: Json): Json[] => (Array.isArray(r?.items) ? r.items : []);
