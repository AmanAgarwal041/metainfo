import { NextRequest, NextResponse } from "next/server";
import { handle, requireWorkspace } from "@/lib/server/auth/session";
import { CloudflareError, deployCollector, planDeploy, publicPlan } from "@/lib/server/cloudflare";
import { issueToken, projectOf, publicSite } from "@/lib/server/traffic";
import { HOSTED_ENDPOINT } from "@/lib/traffic";

export const dynamic = "force-dynamic";

/**
 * POST { projectId, apiToken, replace? } → one-click Cloudflare setup (admins only): checks the token, finds the
 * site's zone, issues the project's collector token, uploads the collector worker with its secrets to the
 * site owner's account and adds the routes. The Cloudflare token is used for this request only and never stored.
 *
 * 409 { conflicts, plan }: another worker holds a route; nothing has changed. Send `replace: true` to take it over.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const s = await requireWorkspace(req, "admin");
    const body = (await req.json().catch(() => null)) as { projectId?: unknown; apiToken?: unknown; replace?: unknown } | null;
    const p = await projectOf(s, body?.projectId);
    const apiToken = typeof body?.apiToken === "string" ? body.apiToken.trim() : "";
    try {
      const plan = await planDeploy(apiToken, p.domain);
      if (plan.conflicts.length && body?.replace !== true) {
        return NextResponse.json({ error: "Another worker is already on your site's routes.", conflicts: plan.conflicts, plan: publicPlan(plan) }, { status: 409 });
      }
      const app = (process.env.APP_URL?.replace(/\/+$/, "") || req.nextUrl.origin) + "/api/traffic/events";
      const endpoint = app === HOSTED_ENDPOINT ? undefined : app;
      const { site, token } = await issueToken(s.db, s.orgId, p.id, p.domain, s.userId);
      const pub = publicSite(site, s.scope);
      const result = await deployCollector({ token: apiToken, plan, secrets: { token, org: pub.workspaceId, site: pub.siteUrl, endpoint } });
      return NextResponse.json(
        {
          site: pub,
          deploy: result,
          warning: endpoint && /^https?:\/\/(localhost|127\.|\[::1\])/.test(endpoint) ? `This MetaInfo runs on ${new URL(endpoint).host}, which Cloudflare can't reach, so events won't arrive until it's deployed.` : undefined,
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (e) {
      if (e instanceof CloudflareError) return NextResponse.json({ error: e.message, ...e.detail }, { status: e.status });
      throw e;
    }
  });
}
