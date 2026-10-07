import { anchor, backlink, backlinkSummary, call, items, referringDomain, type CallResult } from "@/lib/server/dataforseo";
import { param, requireProvider, researchRoute } from "@/lib/server/research-route";
import { bareDomain, type BacklinkResearch, type LinkGapRow } from "@/lib/research-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/research/backlinks?target=&competitors=a.com,b.com
 * Backlink profile, top referring domains/anchors, newest links, and the link
 * gap: domains linking to competitors but not to you.
 */
export const GET = researchRoute(async (req) => {
  requireProvider();
  const target = bareDomain(param(req, "target"));
  const competitors = param(req, "competitors", false)
    .split(",")
    .map(bareDomain)
    .filter((d) => d && d !== target)
    .slice(0, 3);
  const warnings: string[] = [];
  let cost = 0;
  let cached = true;
  const track = (r: CallResult) => {
    cost += r.cost;
    cached &&= r.cached;
    return r;
  };
  // Secondary sections degrade to a warning; the summary failing (e.g. Backlinks API not enabled) is fatal.
  const soft = (p: Promise<CallResult>, label: string) =>
    p.then(track).catch((e) => {
      warnings.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });

  const summary = track(await call("backlinks/summary/live", { target, include_subdomains: true }));
  const [domains, anchors, recent, gap, ...compSummaries] = await Promise.all([
    soft(call("backlinks/referring_domains/live", { target, limit: 50, order_by: ["rank,desc"] }), "Referring domains"),
    soft(call("backlinks/anchors/live", { target, limit: 30, order_by: ["backlinks,desc"] }), "Anchors"),
    soft(call("backlinks/backlinks/live", { target, mode: "one_per_domain", limit: 50, order_by: ["first_seen,desc"] }), "Recent backlinks"),
    competitors.length
      ? soft(
          call("backlinks/domain_intersection/live", {
            targets: Object.fromEntries(competitors.map((c, i) => [String(i + 1), c])),
            exclude_targets: [target],
            limit: 50,
          }),
          "Link gap",
        )
      : Promise.resolve(null),
    ...competitors.map((c) => soft(call("backlinks/summary/live", { target: c, include_subdomains: true }), `Summary for ${c}`)),
  ]);

  const linkGap: LinkGapRow[] = items(gap?.result).map((it) => {
    const byIndex: Record<string, { target?: string; rank?: number; backlinks?: number }> = it?.domain_intersection ?? {};
    const entries = Object.entries(byIndex);
    const linksTo: Record<string, number> = {};
    for (const [idx, v] of entries) {
      const comp = competitors[Number(idx) - 1];
      if (comp) linksTo[comp] = Number(v?.backlinks ?? 0);
    }
    const first = entries[0]?.[1];
    return { domain: bareDomain(String(first?.target ?? "")), rank: typeof first?.rank === "number" ? first.rank : null, linksTo };
  }).filter((r) => r.domain);

  const out: BacklinkResearch = {
    target,
    summary: backlinkSummary(summary.result, target),
    competitors: compSummaries.map((r, i) => (r ? backlinkSummary(r.result, competitors[i]) : null)).filter((x) => x !== null),
    referringDomains: items(domains?.result).map(referringDomain),
    anchors: items(anchors?.result).map(anchor),
    recent: items(recent?.result).map(backlink),
    linkGap,
    warnings,
    cost: Math.round(cost * 10000) / 10000,
    cached,
  };
  return out;
});
