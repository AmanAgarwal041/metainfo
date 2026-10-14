import { NextRequest, NextResponse } from "next/server";
import { AuthError, setSessionOrg } from "@/lib/server/auth/accounts";
import { assertSameOrigin, currentSession, handle } from "@/lib/server/auth/session";

/** POST /api/session/org {orgId} → switch the active organisation. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const s = await currentSession();
    if (!s) throw new AuthError("Sign in to continue.", 401);
    const { orgId } = (await req.json().catch(() => ({}))) as { orgId?: string };
    const org = s.orgs.find((o) => o.id === orgId);
    if (!org) throw new AuthError("You're not a member of that organisation.", 403);
    await setSessionOrg(s.db, s.hash, org.id);
    return NextResponse.json({ org });
  });
}
