import { NextRequest, NextResponse } from "next/server";
import { AuthError, roleAtLeast } from "@/lib/server/auth/accounts";
import { authUrl, GscError, randomToken, sealToken, STATE_COOKIE } from "@/lib/server/gsc";
import { gscContext, oauthClient } from "@/lib/server/gsc-auth";
import { gscError, isLocalhost, NO_STORE, readJson, sameOrigin } from "@/lib/server/gsc-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETURN_TO = ["/search-console", "/settings"];
const TTL = 600;

/**
 * POST {return?} from the app (with the Clerk session) → { url } to send the browser to Google.
 * On a server with accounts only a workspace admin may connect; the workspace and user are bound
 * into a sealed, short-lived state cookie, because the callback is a plain browser redirect whose
 * Clerk session may have expired during Google's consent screen.
 */
export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
    const body = await readJson(req);
    const back = RETURN_TO.includes(String(body.return ?? "")) ? String(body.return) : RETURN_TO[0];
    const ctx = await gscContext(req);
    const { accounts, session } = ctx;
    if (accounts && !session) throw new AuthError("Sign in to connect Search Console for your team.", 401);
    if (session && !roleAtLeast(session.role, "admin")) throw new AuthError("Only admins can connect Search Console for this workspace.", 403);
    const client = await oauthClient(ctx);
    if (!client) throw new GscError(accounts ? "Add this workspace's Google OAuth client in Settings first." : "Search Console OAuth isn't configured on this server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET).", 501, "not-configured");
    const state = randomToken();
    const sealed = await sealToken(JSON.stringify({ s: state, o: session?.orgId ?? null, u: session?.userId ?? null, b: back, e: Date.now() + TTL * 1000 }));
    const res = NextResponse.json({ url: authUrl(req.nextUrl.origin, state, client) }, { headers: NO_STORE });
    // CSRF: the callback must echo `state`. HttpOnly, sealed (so the workspace can't be swapped), only sent to the callback.
    res.cookies.set(STATE_COOKIE, sealed, { httpOnly: true, secure: !isLocalhost(req), sameSite: "lax", path: "/api/gsc/callback", maxAge: TTL });
    return res;
  } catch (e) {
    return gscError(req, e);
  }
}
