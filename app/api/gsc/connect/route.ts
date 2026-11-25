import { NextRequest, NextResponse } from "next/server";
import { authUrl, oauthConfigured, randomToken, STATE_COOKIE } from "@/lib/server/gsc";
import { isLocalhost } from "@/lib/server/gsc-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETURN_TO = ["/search-console", "/settings"];

/** Start the Google OAuth flow. ?return=/settings brings the user back there. */
export function GET(req: NextRequest) {
  const back = RETURN_TO.includes(req.nextUrl.searchParams.get("return") ?? "") ? req.nextUrl.searchParams.get("return")! : RETURN_TO[0];
  if (!oauthConfigured()) return NextResponse.redirect(new URL(`${back}?gsc_error=not-configured`, req.nextUrl.origin));
  const state = randomToken();
  const res = NextResponse.redirect(authUrl(req.nextUrl.origin, state));
  // CSRF: the callback must echo this state. Short-lived, HttpOnly, only sent to the callback.
  res.cookies.set(STATE_COOKIE, `${state}|${back}`, { httpOnly: true, secure: !isLocalhost(req), sameSite: "lax", path: "/api/gsc/callback", maxAge: 600 });
  res.headers.set("cache-control", "no-store");
  return res;
}
