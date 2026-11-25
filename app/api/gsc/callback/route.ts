import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, GscError, oauthConfigured, safeEqual, sealToken, SESSION_COOKIE, STATE_COOKIE } from "@/lib/server/gsc";
import { isLocalhost, sessionCookie } from "@/lib/server/gsc-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETURN_TO = ["/search-console", "/settings"];

/** Google redirects here with ?code&state. Exchange the code and keep the refresh token in an encrypted HttpOnly cookie. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const [expected = "", backRaw = ""] = (req.cookies.get(STATE_COOKIE)?.value ?? "").split("|");
  const back = RETURN_TO.includes(backRaw) ? backRaw : RETURN_TO[0];
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
  if (!expected || !state || !safeEqual(state, expected)) return done({ gsc_error: "state" });
  if (q.get("error")) return done({ gsc_error: q.get("error") === "access_denied" ? "denied" : "google" });
  const code = q.get("code");
  if (!code || code.length > 2000) return done({ gsc_error: "google" });

  try {
    const refresh = await exchangeCode(code, req.nextUrl.origin);
    const res = done({ connected: "1" });
    res.cookies.set(SESSION_COOKIE, await sealToken(refresh), { ...sessionCookie(req), maxAge: 60 * 60 * 24 * 180 });
    return res;
  } catch (e) {
    console.error("gsc callback:", e instanceof GscError ? e.code : "error");
    return done({ gsc_error: e instanceof GscError && e.code === "config" ? "config" : "google" });
  }
}
