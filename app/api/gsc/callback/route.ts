import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, GscError, oauthConfigured, openToken, safeEqual, sealToken, SESSION_COOKIE, STATE_COOKIE } from "@/lib/server/gsc";
import { getDb } from "@/lib/server/db";
import { gscContext, saveConnection } from "@/lib/server/gsc-auth";
import { isLocalhost, sessionCookie } from "@/lib/server/gsc-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETURN_TO = ["/search-console", "/settings"];

interface State {
  s: string;
  /** Workspace (D1 orgs.id) the admin connected for; null on servers without accounts. */
  o: string | null;
  u: string | null;
  b: string;
  e: number;
}

/** Google redirects here with ?code&state. Exchange the code; store the refresh token for the workspace (or, without accounts, in a sealed cookie). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  let st: State | null = null;
  try {
    const raw = await openToken(req.cookies.get(STATE_COOKIE)?.value);
    st = raw ? (JSON.parse(raw) as State) : null;
  } catch {
    st = null;
  }
  const back = st && RETURN_TO.includes(st.b) ? st.b : RETURN_TO[0];
  const done = (params: Record<string, string>) => {
    const url = new URL(back, req.nextUrl.origin);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = NextResponse.redirect(url);
    res.cookies.set(STATE_COOKIE, "", { httpOnly: true, secure: !isLocalhost(req), sameSite: "lax", path: "/api/gsc/callback", maxAge: 0 });
    res.headers.set("cache-control", "no-store");
    return res;
  };

  if (!oauthConfigured()) return done({ gsc_error: "not-configured" });
  const state = q.get("state") ?? "";
  if (!st || typeof st.s !== "string" || !state || !safeEqual(state, st.s) || !(st.e > Date.now())) return done({ gsc_error: "state" });
  if (q.get("error")) return done({ gsc_error: q.get("error") === "access_denied" ? "denied" : "google" });
  const code = q.get("code");
  if (!code || code.length > 2000) return done({ gsc_error: "google" });

  try {
    const { accounts } = await gscContext(req);
    // Servers with accounts only store connections for a workspace whose admin started the flow.
    if (accounts && !st.o) return done({ gsc_error: "state" });
    const { refreshToken, email } = await exchangeCode(code, req.nextUrl.origin);
    const sealed = await sealToken(refreshToken);
    if (st.o) {
      const db = await getDb();
      if (!db) return done({ gsc_error: "google" });
      await saveConnection(db, st.o, sealed, email, st.u);
      return done({ connected: "1" });
    }
    const res = done({ connected: "1" });
    res.cookies.set(SESSION_COOKIE, sealed, { ...sessionCookie(req), maxAge: 60 * 60 * 24 * 180 });
    return res;
  } catch (e) {
    console.error("gsc callback:", e instanceof GscError ? e.code : e instanceof Error ? e.message : "error");
    return done({ gsc_error: e instanceof GscError && e.code === "config" ? "config" : "google" });
  }
}
