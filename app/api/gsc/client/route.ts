import { NextRequest, NextResponse } from "next/server";
import { AuthError, roleAtLeast } from "@/lib/server/auth/accounts";
import { GscError, validClientId, validClientSecret } from "@/lib/server/gsc";
import { deleteClient, gscContext, saveClient } from "@/lib/server/gsc-auth";
import { gscError, NO_STORE, readJson, sameOrigin } from "@/lib/server/gsc-route";
import { BadInput } from "@/lib/server/gsc-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in admin's workspace, or a thrown AuthError. Clients belong to workspaces, so servers without accounts have none. */
async function adminSession(req: NextRequest) {
  if (!sameOrigin(req)) throw new AuthError("Cross-site request refused.", 403);
  const { accounts, session } = await gscContext(req);
  if (!accounts) throw new GscError("This server has no workspaces: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in its environment instead.", 400, "bad-input");
  if (!session) throw new AuthError("Sign in to set up Search Console for your team.", 401);
  if (!roleAtLeast(session.role, "admin")) throw new AuthError("Only admins can change this workspace's Google OAuth client.", 403);
  return session;
}

/** PUT {clientId, clientSecret?} → save this workspace's Google OAuth client. An empty secret keeps the saved one. */
export async function PUT(req: NextRequest) {
  try {
    const session = await adminSession(req);
    const body = await readJson(req);
    const id = typeof body.clientId === "string" ? body.clientId.trim() : "";
    const secret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
    if (!validClientId(id)) throw new BadInput("The client ID should look like 1234-abc.apps.googleusercontent.com.");
    if (secret && !validClientSecret(secret)) throw new BadInput("That client secret doesn't look right. Copy it again from Google Cloud.");
    const { disconnected } = await saveClient(session.db, session.orgId, id, secret || null, session.userId);
    return NextResponse.json({ ok: true, disconnected }, { headers: NO_STORE });
  } catch (e) {
    return gscError(req, e);
  }
}

/** DELETE → remove this workspace's client and its Search Console connection. */
export async function DELETE(req: NextRequest) {
  try {
    const session = await adminSession(req);
    await deleteClient(session.db, session.orgId);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    return gscError(req, e);
  }
}
