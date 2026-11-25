import { NextRequest, NextResponse } from "next/server";
import { listSites, matchSite, validSite, DAY_OPTIONS, GscError } from "@/lib/server/gsc";
import { gscContext, propertyFor, resolveAuth, validProjectId } from "@/lib/server/gsc-auth";
import { BadInput, buildOpportunities, type GscOpportunitiesResult, type ReportParams } from "@/lib/server/gsc-report";
import { gscError, NO_STORE } from "@/lib/server/gsc-route";
import { projectOf } from "@/lib/server/traffic-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; value: GscOpportunitiesResult }>();
const TTL = 10 * 60_000;

/**
 * GET ?projectId=&days=28[&domain=] → { connected: true, site, totals, previous, change, range, opportunities }
 * or { connected: false, reason, message } when Search Console isn't available to this caller (never an error).
 * The property is the project's saved one, else the one matching the project's domain (or ?domain= without accounts).
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const days = Number(sp.get("days") ?? 28);
    if (!(DAY_OPTIONS as readonly number[]).includes(days)) throw new BadInput(`"days" must be one of ${DAY_OPTIONS.join(", ")}`);
    const projectId = sp.get("projectId");
    const ctx = await gscContext(req);
    let auth;
    try {
      auth = await resolveAuth(req, ctx);
    } catch (e) {
      if (e instanceof GscError && (e.status === 401 || e.status === 501)) return NextResponse.json({ connected: false, reason: e.code, message: e.message }, { headers: NO_STORE });
      throw e;
    }

    let site: string | null = null;
    let domain = (sp.get("domain") ?? "").trim().slice(0, 253);
    if (ctx.session && validProjectId(projectId)) {
      site = await propertyFor(ctx.session.db, ctx.session.orgId, projectId);
      if (!site) domain = await projectOf(ctx.session, projectId).then((p) => p.domain, () => domain);
    }
    if (site && !validSite(site)) site = null;
    if (!site && domain) site = matchSite(await listSites(auth), domain)?.siteUrl ?? null;
    if (!site) return NextResponse.json({ connected: true, site: null, reason: "no-property", message: "No Search Console property matches this project.", opportunities: [] }, { headers: NO_STORE });

    const key = `${auth.via}:${auth.orgId ?? auth.email ?? ""}:${site}:${days}`;
    const hit = cache.get(key);
    let value = hit && Date.now() - hit.at < TTL ? hit.value : null;
    if (!value) {
      value = await buildOpportunities(auth, site, days as ReportParams["days"]);
      if (cache.size > 200) cache.clear();
      cache.set(key, { at: Date.now(), value });
    }
    return NextResponse.json({ connected: true, ...value }, { headers: NO_STORE });
  } catch (e) {
    return gscError(req, e);
  }
}
