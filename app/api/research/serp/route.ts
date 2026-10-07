import { call, items } from "@/lib/server/dataforseo";
import { param, requireProvider, researchRoute } from "@/lib/server/research-route";
import { bareDomain, type SerpResult } from "@/lib/research-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** Every {url, domain} object nested anywhere inside an AI Overview item. */
function aiReferences(node: Json, out: Map<string, { domain: string; url: string; title: string }>) {
  if (Array.isArray(node)) return node.forEach((n) => aiReferences(n, out));
  if (!node || typeof node !== "object") return;
  if (typeof node.url === "string" && node.url.startsWith("http")) {
    const domain = bareDomain(node.domain ?? node.url);
    if (!out.has(node.url)) out.set(node.url, { domain, url: node.url, title: String(node.title ?? node.source ?? domain) });
  }
  for (const v of Object.values(node)) if (v && typeof v === "object") aiReferences(v, out);
}

/** GET /api/research/serp?q=&loc=&device= → live Google results for a keyword. */
export const GET = researchRoute(async (req, { location }) => {
  requireProvider();
  const keyword = param(req, "q").slice(0, 200);
  const device = param(req, "device", false) === "mobile" ? "mobile" : "desktop";
  const r = await call("serp/google/organic/live/advanced", {
    keyword,
    location_code: location.code,
    language_code: location.lang,
    device,
    depth: 20,
  });
  const all = items(r.result);
  const fs = all.find((i) => i?.type === "featured_snippet");
  const ai = all.find((i) => i?.type === "ai_overview");
  const refs = new Map<string, { domain: string; url: string; title: string }>();
  if (ai) aiReferences(ai, refs);

  const out: SerpResult = {
    keyword,
    location: location.code,
    device,
    checkedAt: new Date().toISOString(),
    resultsCount: typeof r.result?.se_results_count === "number" ? r.result.se_results_count : null,
    features: Array.isArray(r.result?.item_types) ? r.result.item_types : [],
    organic: all
      .filter((i) => i?.type === "organic")
      .map((i) => ({
        position: Number(i.rank_group),
        absolute: Number(i.rank_absolute),
        domain: bareDomain(i.domain ?? i.url ?? ""),
        url: String(i.url ?? ""),
        title: String(i.title ?? ""),
        description: String(i.description ?? ""),
      })),
    featuredSnippet: fs ? { domain: bareDomain(fs.domain ?? fs.url ?? ""), url: String(fs.url ?? ""), title: String(fs.title ?? ""), text: String(fs.description ?? "") } : null,
    aiOverview: ai ? { present: true, references: [...refs.values()] } : null,
    peopleAlsoAsk: all
      .filter((i) => i?.type === "people_also_ask")
      .flatMap((i) => items(i))
      .map((q: Json) => String(q?.title ?? ""))
      .filter(Boolean),
    relatedSearches: all
      .filter((i) => i?.type === "related_searches")
      .flatMap((i) => items(i))
      .map((s: Json) => (typeof s === "string" ? s : String(s?.title ?? s?.keyword ?? "")))
      .filter(Boolean),
    cost: Math.round(r.cost * 10000) / 10000,
    cached: r.cached,
  };
  return out;
});
