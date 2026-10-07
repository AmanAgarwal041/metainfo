import { call, items, organicMetrics } from "@/lib/server/dataforseo";
import { param, requireProvider, researchRoute } from "@/lib/server/research-route";
import { bareDomain, type CompetitorResearch } from "@/lib/research-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/research/competitors?domain=&loc= → who you compete with in organic search. */
export const GET = researchRoute(async (req, { location }) => {
  requireProvider();
  const domain = bareDomain(param(req, "domain"));
  const base = { target: domain, location_code: location.code, language_code: location.lang };
  const [comp, overview] = await Promise.all([
    call("dataforseo_labs/google/competitors_domain/live", { ...base, limit: 25, exclude_top_domains: true, item_types: ["organic"] }),
    call("dataforseo_labs/google/domain_rank_overview/live", base),
  ]);
  const out: CompetitorResearch = {
    domain,
    overview: items(overview.result)[0]?.metrics ? organicMetrics(items(overview.result)[0].metrics) : null,
    competitors: items(comp.result)
      .filter((i) => i?.domain && bareDomain(i.domain) !== domain)
      .map((i) => ({
        domain: bareDomain(i.domain),
        commonKeywords: Number(i.intersections ?? 0),
        avgPosition: typeof i.avg_position === "number" ? Math.round(i.avg_position * 10) / 10 : null,
        organic: organicMetrics(i.full_domain_metrics),
      })),
    cost: Math.round((comp.cost + overview.cost) * 10000) / 10000,
    cached: comp.cached && overview.cached,
  };
  return out;
});
