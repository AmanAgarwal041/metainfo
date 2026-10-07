import { autocompleteIdeas, groupOf } from "@/lib/server/autocomplete";
import { call, dataForSeoConfigured, items, keywordMetrics, ProviderError } from "@/lib/server/dataforseo";
import { param, researchRoute } from "@/lib/server/research-route";
import type { KeywordMetrics, KeywordResearch, KeywordRow } from "@/lib/research-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/research/keywords?q=&loc= → keyword ideas (+ volumes/difficulty with DataForSEO). */
export const GET = researchRoute(async (req, { location }) => {
  const seed = param(req, "q").toLowerCase().slice(0, 80);
  const warnings: string[] = [];
  const auto = await autocompleteIdeas(seed, location.gl, location.lang).catch(() => ({ keywords: [] as string[], failed: -1 }));
  if (auto.failed === -1) warnings.push("Google Autocomplete didn't respond. Only provider keywords are shown.");
  else if (auto.failed > 0) warnings.push(`${auto.failed} autocomplete lookups failed (rate limited?). Results may be incomplete.`);

  const rows = new Map<string, KeywordRow>();
  const put = (m: KeywordMetrics, source: KeywordRow["source"]) => {
    const key = m.keyword.toLowerCase();
    const prev = rows.get(key);
    if (prev && prev.volume != null) return;
    rows.set(key, { ...m, keyword: key, source, group: groupOf(key, seed) });
  };

  let cost = 0;
  let cached = true;
  let seedMetrics: KeywordMetrics | null = null;
  const provider = dataForSeoConfigured() ? "dataforseo" : "free";

  if (provider === "dataforseo") {
    const base = { location_code: location.code, language_code: location.lang };
    const settle = async <T,>(p: Promise<T>, label: string): Promise<T | null> => {
      try {
        return await p;
      } catch (e) {
        if (e instanceof ProviderError && (e.code === 40100 || e.code === 40210 || e.code === 40200)) throw e;
        warnings.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    };
    const [sugg, related, overview] = await Promise.all([
      settle(call("dataforseo_labs/google/keyword_suggestions/live", { ...base, keyword: seed, include_seed_keyword: true, limit: 200 }), "Keyword suggestions"),
      settle(call("dataforseo_labs/google/related_keywords/live", { ...base, keyword: seed, depth: 1, limit: 100 }), "Related keywords"),
      auto.keywords.length
        ? settle(call("dataforseo_labs/google/keyword_overview/live", { ...base, keywords: [seed, ...auto.keywords].slice(0, 700) }), "Keyword overview")
        : Promise.resolve(null),
    ]);
    for (const r of [sugg, related, overview]) {
      if (!r) continue;
      cost += r.cost;
      cached &&= r.cached;
    }
    if (sugg?.result?.seed_keyword_data) seedMetrics = keywordMetrics({ ...sugg.result.seed_keyword_data, keyword: seed });
    for (const r of [overview, sugg, related]) {
      for (const it of items(r?.result)) {
        const m = keywordMetrics(it);
        if (!m) continue;
        if (m.keyword.toLowerCase() === seed) seedMetrics ??= m;
        else put(m, "dataforseo");
      }
    }
  }

  for (const k of auto.keywords) {
    if (k === seed || rows.has(k)) continue;
    rows.set(k, { keyword: k, volume: null, difficulty: null, cpc: null, competition: null, intent: null, trend: [], source: "autocomplete", group: groupOf(k, seed) });
  }

  const keywords = [...rows.values()].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.localeCompare(b.keyword));
  const out: KeywordResearch = { seed, provider, keywords, seedMetrics, warnings, cost: Math.round(cost * 10000) / 10000, cached: provider === "free" || cached };
  return out;
});
