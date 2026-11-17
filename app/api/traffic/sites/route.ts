import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/server/auth/accounts";
import { handle, requireWorkspace } from "@/lib/server/auth/session";
import { deleteSite, issueToken, projectOf, publicSite, sitesFor } from "@/lib/server/traffic";

export const dynamic = "force-dynamic";

/** GET → the workspace's collectors: [{ projectId, domain, tokenHint, createdAt, lastEventAt, lastVia }]. Never a token. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const s = await requireWorkspace(req);
    const sites = await sitesFor(s.db, s.orgId);
    return NextResponse.json({ sites: sites.map((site) => publicSite(site, s.scope)) }, { headers: { "cache-control": "no-store" } });
  });
}

/** POST { projectId } → creates the project's collector token, or replaces it. The token is in this response only. Admins only. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const s = await requireWorkspace(req, "admin");
    const body = (await req.json().catch(() => null)) as { projectId?: unknown } | null;
    const p = await projectOf(s, body?.projectId);
    const { site, token } = await issueToken(s.db, s.orgId, p.id, p.domain, s.userId);
    return NextResponse.json({ site: publicSite(site, s.scope), token }, { headers: { "cache-control": "no-store" } });
  });
}

/** DELETE ?projectId= → disconnects the collector and deletes the project's traffic. Admins only. */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const s = await requireWorkspace(req, "admin");
    const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
    if (!/^[\w-]{1,64}$/.test(projectId)) throw new AuthError("Pick a project first.");
    await deleteSite(s.db, s.orgId, projectId);
    return NextResponse.json({ ok: true });
  });
}
