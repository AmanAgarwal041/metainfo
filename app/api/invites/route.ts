import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { acceptInvites, AuthError, lookupInvite, setSessionOrg } from "@/lib/server/auth/accounts";
import { assertSameOrigin, currentSession, handle } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";

/** GET ?token= → which organisation and email an invite is for (public). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const db = await getDb();
    const token = req.nextUrl.searchParams.get("token");
    const invite = db && token ? await lookupInvite(db, token) : null;
    if (!invite) throw new AuthError("This invite has expired or was revoked.", 404);
    return NextResponse.json(invite);
  });
}

/** POST {token} → accept while signed in. The invite's email must be one of yours. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const s = await currentSession();
    if (!s) throw new AuthError("Sign in to accept the invite.", 401);
    const { token } = (await req.json().catch(() => ({}))) as { token?: string };
    const { preferred, tokenMismatch } = await acceptInvites(s.db, s.user, token ?? null);
    if (tokenMismatch || !preferred) throw new AuthError(`This invite was sent to a different email address than ${s.user.email}.`, 403);
    await setSessionOrg(s.db, s.hash, preferred);
    return NextResponse.json({ orgId: preferred });
  });
}
