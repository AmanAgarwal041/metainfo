// Request-level helpers: who is signed in, which workspace they're in, with what role.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { AuthError, roleAtLeast, workspaceFor, type Role } from "./accounts";
import { clerkAuth } from "./clerk";

export interface Signed {
  db: D1Database;
  userId: string;
  /** What the client calls the workspace: the active Clerk organisation id, or the user id for a personal workspace. */
  scope: string;
  personal: boolean;
  role: Role;
  /** The D1 `orgs` row the workspace is stored under. */
  orgId: string;
}

/** The signed-in user and their active workspace, or null (anonymous, or no database). */
export async function currentSession(req: Request): Promise<Signed | null> {
  const db = await getDb();
  if (!db) return null;
  const auth = await clerkAuth(req);
  if (!auth) return null;
  const personal = !auth.orgId;
  const scope = auth.orgId ?? auth.userId;
  // Your personal workspace is yours alone.
  const role: Role = personal ? "owner" : (auth.orgRole ?? "member");
  return { db, userId: auth.userId, scope, personal, role, orgId: await workspaceFor(db, scope, auth.userId, role) };
}

/** Refuse cross-site state-changing requests (defence in depth: the Clerk token normally comes in a header). */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new AuthError("Cross-site request refused.", 403);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin && origin !== process.env.APP_URL?.replace(/\/+$/, "")) throw new AuthError("Cross-site request refused.", 403);
}

/** Signed in, at least `role` in the active workspace. */
export async function requireWorkspace(req: Request, role: Role = "member"): Promise<Signed> {
  assertSameOrigin(req);
  const s = await currentSession(req);
  if (!s) throw new AuthError("Sign in to continue.", 401);
  if (!roleAtLeast(s.role, role)) throw new AuthError(`Only ${role === "owner" ? "owners" : "admins"} can do that.`, 403);
  return s;
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
