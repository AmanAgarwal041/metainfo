import { call, items, keywordMetrics } from "@/lib/server/dataforseo";
import { BadRequest, param, requireProvider, researchRoute } from "@/lib/server/research-route";
import { bareDomain, type GapRow, type KeywordGap } from "@/lib/research-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 300;

/**
 * GET /api/research/gap?you=&them=a.com,b.com&loc=
 * Keywords competitors rank for that you don't ("missing"), where they outrank
 * you ("weak") and where you lead ("strong").
 */
export const GET = researchRoute(async (req, { location }) => {
  requireProvider();
  const you = bareDomain(param(req, "you"));
  const them = param(req, "them")
    .split(",")
    .map(bareDomain)
    .filter((d) => d && d !== you)
    .slice(0, 3);
  if (!them.length) throw new BadRequest("Add at least one competitor domain.");
  const base = { location_code: location.code, language_code: location.lang, limit: LIMIT, item_types: ["organic"] };

  const calls = them.flatMap((c) => [
    // Keywords where the competitor ranks and you don't.
    call("dataforseo_labs/google/domain_intersection/live", { ...base, target1: c, target2: you, intersections: false }).then((r) => ({ c, kind: "missing" as const, r })),
    // Keywords where you both rank.
    call("dataforseo_labs/google/domain_intersection/live", { ...base, target1: you, target2: c, intersections: true }).then((r) => ({ c, kind: "shared" as const, r })),
  ]);
  const results = await Promise.all(calls);

  const rows = new Map<string, GapRow>();
  let cost = 0;
  let cached = true;
  for (const { c, kind, r } of results) {
    cost += r.cost;
    cached &&= r.cached;
    for (const it of items(r.result)) {
      const m = keywordMetrics(it);
      if (!m) continue;
      const key = m.keyword.toLowerCase();
      const row = rows.get(key) ?? { ...m, keyword: key, positions: {}, urls: {}, status: "missing" as const };
      const first = it.first_domain_serp_element;
      const second = it.second_domain_serp_element;
      if (kind === "missing" && first?.rank_group) {
        row.positions[c] = first.rank_group;
        row.urls[c] = first.url;
      }
      if (kind === "shared") {
        if (first?.rank_group) {
          row.positions[you] = first.rank_group;
          row.urls[you] = first.url;
        }
        if (second?.rank_group) {
          row.positions[c] = second.rank_group;
          row.urls[c] = second.url;
        }
      }
      rows.set(key, row);
    }
  }

  for (const row of rows.values()) {
    const mine = row.positions[you];
    const best = Math.min(...them.map((c) => row.positions[c] ?? Infinity));
    row.status = mine == null ? "missing" : best < mine ? "weak" : "strong";
  }

  const out: KeywordGap = {
    you,
    competitors: them,
    rows: [...rows.values()].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)),
    warnings: results.some((x) => items(x.r.result).length >= LIMIT) ? [`Showing the top ${LIMIT} keywords per competitor by search volume.`] : [],
    cost: Math.round(cost * 10000) / 10000,
    cached,
  };
  return out;
});
