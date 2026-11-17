import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/server/auth/accounts";
import { handle, requireWorkspace } from "@/lib/server/auth/session";
import { publicSite, siteFor, trafficStats } from "@/lib/server/traffic";

export const dynamic = "force-dynamic";

const RANGES = new Set([7, 30, 90]);

/** GET ?projectId=&days=7 → { site, stats } for the project's collector, or { site: null } when it has none. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const s = await requireWorkspace(req);
    const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
    if (!/^[\w-]{1,64}$/.test(projectId)) throw new AuthError("Pick a project first.");
    const days = Number(req.nextUrl.searchParams.get("days") ?? 7);
    if (!RANGES.has(days)) throw new AuthError("days must be 7, 30 or 90.");
    const site = await siteFor(s.db, s.orgId, projectId);
    const headers = { "cache-control": "no-store" };
    if (!site) return NextResponse.json({ site: null }, { headers });
    return NextResponse.json({ site: publicSite(site, s.scope), stats: await trafficStats(s.db, site.id, days) }, { headers });
  });
}
