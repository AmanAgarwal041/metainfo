import { NextRequest, NextResponse } from "next/server";
import { AuthError, roleAtLeast } from "@/lib/server/auth/accounts";
import { openToken, revoke, SESSION_COOKIE } from "@/lib/server/gsc";
import { deleteConnection, emailInUse, gscContext } from "@/lib/server/gsc-auth";
import { gscError, NO_STORE, sameOrigin, sessionCookie } from "@/lib/server/gsc-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST → remove the workspace's connection (admins) or, without accounts, this browser's; revoke at Google best effort. */
export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
    const { accounts, session } = await gscContext(req);
    const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
    if (accounts) {
      if (!session) throw new AuthError("Sign in to manage Search Console.", 401);
      if (!roleAtLeast(session.role, "admin")) throw new AuthError("Only admins can disconnect Search Console for this workspace.", 403);
      const { refresh, email } = await deleteConnection(session.db, session.orgId);
      // Revoking ends the whole Google grant, so skip it while another workspace uses the same account.
      if (refresh && !(await emailInUse(session.db, email))) await revoke(refresh);
    } else {
      const refresh = await openToken(req.cookies.get(SESSION_COOKIE)?.value);
      if (refresh) await revoke(refresh);
    }
    if (req.cookies.has(SESSION_COOKIE)) res.cookies.set(SESSION_COOKIE, "", { ...sessionCookie(req), maxAge: 0 });
    return res;
  } catch (e) {
    return gscError(req, e);
  }
}
