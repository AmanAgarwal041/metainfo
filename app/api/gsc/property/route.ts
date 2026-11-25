import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/server/auth/accounts";
import { requireWorkspace } from "@/lib/server/auth/session";
import { validSite } from "@/lib/server/gsc";
import { saveProperty, validProjectId } from "@/lib/server/gsc-auth";
import { BadInput } from "@/lib/server/gsc-report";
import { gscError, NO_STORE, readJson } from "@/lib/server/gsc-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT {projectId, site} → the property the whole workspace sees for this project. Any member. */
export async function PUT(req: NextRequest) {
  try {
    const s = await requireWorkspace(req);
    const body = await readJson(req);
    if (!validProjectId(body.projectId)) throw new AuthError("Pick a project first.");
    if (!validSite(body.site)) throw new BadInput('"site" must be a Search Console property.');
    await saveProperty(s.db, s.orgId, body.projectId, body.site, s.userId);
    return NextResponse.json({ ok: true, property: body.site }, { headers: NO_STORE });
  } catch (e) {
    return gscError(req, e);
  }
}
