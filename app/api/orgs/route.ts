import { NextRequest, NextResponse } from "next/server";
import { AuthError, createOrg, setSessionOrg } from "@/lib/server/auth/accounts";
import { assertSameOrigin, currentSession, handle } from "@/lib/server/auth/session";

/** POST /api/orgs {name} → a new organisation owned by the caller, made active. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const s = await currentSession();
    if (!s) throw new AuthError("Sign in to continue.", 401);
    if (s.orgs.length >= 20) throw new AuthError("You can belong to at most 20 organisations.");
    const { name } = (await req.json().catch(() => ({}))) as { name?: string };
    const id = await createOrg(s.db, name ?? "", s.user.id);
    await setSessionOrg(s.db, s.hash, id);
    return NextResponse.json({ id });
  });
}
