import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "./auth/accounts";
import { BadInput } from "./gsc-report";
import { gscContext, resolveAuth } from "./gsc-auth";
import { COOKIE_PATH, GscError, SESSION_COOKIE, type GscAuth } from "./gsc";
import type { Signed } from "./auth/session";

export const NO_STORE = { "cache-control": "no-store" };

export const isLocalhost = (req: NextRequest) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(req.nextUrl.hostname);

/** Cookie attributes for the browser-mode refresh token: HttpOnly, Secure except on localhost, SameSite=Lax, sent only to /api/gsc. */
export const sessionCookie = (req: NextRequest) => ({ httpOnly: true, secure: !isLocalhost(req), sameSite: "lax" as const, path: COOKIE_PATH });

/** Refuse cross-site state-changing requests. */
export function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin || origin === process.env.APP_URL?.replace(/\/+$/, "");
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 10_000) throw new BadInput("Request body too large.");
  try {
    const v = JSON.parse(text || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new BadInput("Send a JSON object.");
  }
}

/** Errors to JSON responses. */
export function gscError(req: NextRequest, e: unknown): NextResponse {
  if (e instanceof BadInput) return NextResponse.json({ error: e.message, code: "bad-input" }, { status: 400, headers: NO_STORE });
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
  if (e instanceof GscError) {
    const res = NextResponse.json({ error: e.message, code: e.code }, { status: e.status, headers: NO_STORE });
    // A revoked browser grant can't recover: drop the cookie so the UI offers to reconnect.
    if (e.code === "not-connected" && req.cookies.has(SESSION_COOKIE)) res.cookies.set(SESSION_COOKIE, "", { ...sessionCookie(req), maxAge: 0 });
    return res;
  }
  console.error("gsc:", e instanceof Error ? e.message : e);
  return NextResponse.json({ error: "Search Console request failed." }, { status: 500, headers: NO_STORE });
}

/** Resolve Search Console auth for the request (workspace, service account, or browser cookie) and turn errors into JSON. */
export function gscRoute(fn: (req: NextRequest, auth: GscAuth & { orgId?: string; session?: Signed | null }) => Promise<unknown>) {
  return async (req: NextRequest) => {
    try {
      if (req.method !== "GET" && !sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
      const auth = await resolveAuth(req, await gscContext(req));
      return NextResponse.json(await fn(req, auth), { headers: NO_STORE });
    } catch (e) {
      return gscError(req, e);
    }
  };
}
