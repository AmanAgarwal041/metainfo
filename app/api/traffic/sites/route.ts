import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/server/auth/accounts";
import { handle, requireWorkspace, type Signed } from "@/lib/server/auth/session";
import { deleteSite, issueToken, publicSite, sitesFor } from "@/lib/server/traffic";
import { bareDomain } from "@/lib/research-types";

export const dynamic = "force-dynamic";

/** The project as the workspace has it (the synced copy, so the domain can't be made up). */
async function projectOf(s: Signed, projectId: unknown): Promise<{ id: string; domain: string }> {
  if (typeof projectId !== "string" || !/^[\w-]{1,64}$/.test(projectId)) throw new AuthError("Pick a project first.");
  const row = await s.db.prepare("SELECT value FROM workspace WHERE org_id = ? AND key = 'metainfo:projects:v2'").bind(s.orgId).first<{ value: string }>();
  let projects: { id?: string; domain?: string }[] = [];
  try {
    projects = (JSON.parse(row?.value ?? "null") as { projects?: typeof projects } | null)?.projects ?? [];
  } catch {
    /* unreadable: treated as missing */
  }
  const p = projects.find((x) => x.id === projectId);
  if (!p) throw new AuthError("This project hasn't been saved to your workspace yet. Wait a moment and try again.", 409);
  const domain = bareDomain(p.domain ?? "");
  if (!domain) throw new AuthError("Give this project a domain first (Settings → Projects).");
  return { id: projectId, domain };
}

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
