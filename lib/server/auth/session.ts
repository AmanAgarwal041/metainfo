// Request-level helpers: who is signed in, in which organisation, with what role.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { AuthError, membershipsFor, roleAtLeast, SESSION_COOKIE, SESSION_DAYS, sessionUser, setSessionOrg, type OrgSummary, type Role, type User } from "./accounts";

export interface Signed {
  db: D1Database;
  hash: string;
  user: User;
  orgs: OrgSummary[];
  org: OrgSummary | null;
}

/** The signed-in user and their active organisation, or null (anonymous, or no database). */
export async function currentSession(): Promise<Signed | null> {
  const db = await getDb();
  if (!db) return null;
  const s = await sessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const orgs = await membershipsFor(db, s.user.id);
  let org = orgs.find((o) => o.id === s.orgId) ?? null;
  // The active org was deleted or the user was removed from it: fall back to their first one.
  if (!org && orgs.length) {
    org = orgs[0];
    await setSessionOrg(db, s.hash, org.id);
  }
  return { db, hash: s.hash, user: s.user, orgs, org };
}

/** Refuse cross-site state-changing requests (cookies are SameSite=Lax; this is defence in depth). */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new AuthError("Cross-site request refused.", 403);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin && origin !== process.env.APP_URL?.replace(/\/+$/, "")) throw new AuthError("Cross-site request refused.", 403);
}

/** Signed in with an active organisation, at least `role`. */
export async function requireOrg(req: Request, role: Role = "member"): Promise<Signed & { org: OrgSummary }> {
  assertSameOrigin(req);
  const s = await currentSession();
  if (!s) throw new AuthError("Sign in to continue.", 401);
  if (!s.org) throw new AuthError("Choose an organisation first.", 409);
  if (!roleAtLeast(s.org.role, role)) throw new AuthError(`Only ${role === "owner" ? "owners" : "admins"} can do that.`, 403);
  return s as Signed & { org: OrgSummary };
}

export function sessionCookie(res: NextResponse, req: Request, token: string | null) {
  res.cookies.set(SESSION_COOKIE, token ?? "", {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(process.env.APP_URL || req.url).protocol === "https:",
    path: "/",
    maxAge: token ? SESSION_DAYS * 86_400 : 0,
  });
  return res;
}

/** JSON error responses for AuthError (and a 500 for anything unexpected). */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
