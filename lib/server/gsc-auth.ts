// Who reads Search Console for a request, in this order:
//  1. the signed-in workspace's connection (D1, one per organisation);
//  2. the server's service account (only for RESEARCH_TOKEN holders when that's set);
//  3. on servers without accounts (no D1 or no Clerk) only: the browser's sealed cookie.
// A signed-in request never uses the cookie.

import { getDb } from "./db";
import { clerkEnabled } from "./auth/clerk";
import { currentSession, type Signed } from "./auth/session";
import { roleAtLeast } from "./auth/accounts";
import { forgetConnection, GscError, isOwnerRequest, oauthAccessToken, oauthConfigured, openToken, serviceAccount, serviceAccountToken, SESSION_COOKIE, type GscAuth } from "./gsc";

export interface Connection {
  org_id: string;
  refresh_token: string;
  email: string | null;
  connected_by: string | null;
  created_at: number;
  last_used_at: number | null;
  last_error: string | null;
}

export async function connectionFor(db: D1Database, orgId: string): Promise<Connection | null> {
  return db.prepare("SELECT org_id, refresh_token, email, connected_by, created_at, last_used_at, last_error FROM gsc_connections WHERE org_id = ?").bind(orgId).first<Connection>();
}

export async function saveConnection(db: D1Database, orgId: string, sealedRefresh: string, email: string | null, userId: string | null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO gsc_connections (org_id, refresh_token, email, connected_by, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (org_id) DO UPDATE SET refresh_token = excluded.refresh_token, email = excluded.email, connected_by = excluded.connected_by,
         created_at = excluded.created_at, last_used_at = NULL, last_error = NULL`,
    )
    .bind(orgId, sealedRefresh, email, userId, Date.now())
    .run();
}

/** Removes the workspace's connection. Returns the refresh token so the caller can revoke it. */
export async function deleteConnection(db: D1Database, orgId: string): Promise<{ refresh: string | null; email: string | null }> {
  const c = await connectionFor(db, orgId);
  if (!c) return { refresh: null, email: null };
  await db.prepare("DELETE FROM gsc_connections WHERE org_id = ?").bind(orgId).run();
  const refresh = await openToken(c.refresh_token);
  if (refresh) await forgetConnection(refresh);
  return { refresh, email: c.email };
}

/** Whether another workspace connected the same Google account (revoking would cut it off too: Google revokes the whole grant). */
export async function emailInUse(db: D1Database, email: string | null): Promise<boolean> {
  if (!email) return false;
  return Boolean(await db.prepare("SELECT 1 AS x FROM gsc_connections WHERE email = ? LIMIT 1").bind(email).first());
}

export async function propertyFor(db: D1Database, orgId: string, projectId: string): Promise<string | null> {
  const r = await db.prepare("SELECT site_url FROM gsc_properties WHERE org_id = ? AND project_id = ?").bind(orgId, projectId).first<{ site_url: string }>();
  return r?.site_url ?? null;
}

export async function saveProperty(db: D1Database, orgId: string, projectId: string, siteUrl: string, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO gsc_properties (org_id, project_id, site_url, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (org_id, project_id) DO UPDATE SET site_url = excluded.site_url, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(orgId, projectId, siteUrl, userId, Date.now())
    .run();
}

export const validProjectId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);

export interface GscContext {
  /** The server keeps accounts (D1 + Clerk). Then the browser cookie is never used. */
  accounts: boolean;
  session: Signed | null;
}

export async function gscContext(req: Request): Promise<GscContext> {
  const db = await getDb();
  const accounts = Boolean(db) && clerkEnabled();
  return { accounts, session: accounts ? await currentSession(req) : null };
}

const cookieOf = (req: Request) => {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
};

const HOUR = 3_600_000;

/** An access token for an org connection; marks the row (and drops the cache) when Google refuses the grant. */
async function orgToken(db: D1Database, c: Connection): Promise<string> {
  const refresh = await openToken(c.refresh_token);
  if (!refresh) {
    await db.prepare("UPDATE gsc_connections SET last_error = ? WHERE org_id = ?").bind("The stored connection can't be read (the server's secret changed). Reconnect.", c.org_id).run();
    throw new GscError("This workspace's Search Console connection needs to be reconnected by an admin.", 401, "reconnect");
  }
  try {
    const token = await oauthAccessToken(refresh);
    const now = Date.now();
    if (!c.last_used_at || c.last_used_at < now - HOUR) await db.prepare("UPDATE gsc_connections SET last_used_at = ? WHERE org_id = ?").bind(now, c.org_id).run();
    return token;
  } catch (e) {
    if (e instanceof GscError && e.code === "not-connected") {
      await db.prepare("UPDATE gsc_connections SET last_error = ? WHERE org_id = ?").bind("Google revoked or expired the access. Reconnect.", c.org_id).run();
      throw new GscError("Google revoked or expired this workspace's Search Console access. An admin needs to reconnect it.", 401, "reconnect");
    }
    throw e;
  }
}

/** Resolve the request's Search Console access (see the order at the top). */
export async function resolveAuth(req: Request, ctx?: GscContext): Promise<GscAuth & { orgId?: string; session?: Signed | null }> {
  const { accounts, session } = ctx ?? (await gscContext(req));
  if (session) {
    const c = await connectionFor(session.db, session.orgId);
    if (c && !c.last_error && oauthConfigured()) return { token: await orgToken(session.db, c), via: "org", email: c.email ?? undefined, orgId: session.orgId, session };
    const sa = serviceAccount();
    if (sa && isOwnerRequest(req.headers)) return { token: await serviceAccountToken(sa), via: "service-account", email: sa.client_email, session };
    if (c?.last_error) throw new GscError("This workspace's Search Console connection stopped working. An admin needs to reconnect it.", 401, "reconnect");
    if (sa) throw new GscError("Search Console isn't connected for this workspace. An admin can connect it, or enter this server's access token to use its service account.", 401, "not-connected");
    if (!oauthConfigured()) throw notConfigured();
    throw new GscError(roleAtLeast(session.role, "admin") ? "Connect Google Search Console for this workspace." : "Search Console isn't connected for this workspace yet. Ask an admin to connect it.", 401, "not-connected");
  }
  const sa = serviceAccount();
  if (sa && isOwnerRequest(req.headers)) return { token: await serviceAccountToken(sa), via: "service-account", email: sa.client_email };
  if (!accounts && oauthConfigured()) {
    const refresh = await openToken(cookieOf(req));
    if (refresh) return { token: await oauthAccessToken(refresh), via: "browser" };
  }
  if (accounts && oauthConfigured()) throw new GscError("Sign in to use your team's Search Console connection.", 401, "sign-in");
  if (sa) throw new GscError("This server's Search Console service account needs its access token (RESEARCH_TOKEN), or connect your own Google account.", 401, "token");
  if (oauthConfigured()) throw new GscError("Connect Google Search Console to see your data.", 401, "not-connected");
  throw notConfigured();
}

const notConfigured = () =>
  new GscError("Search Console isn't configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (OAuth) or GSC_SERVICE_ACCOUNT_JSON.", 501, "not-configured");

export interface GscStatus {
  mode: "org" | "service-account" | "browser" | "none";
  /** A connection is usable right now (mode isn't none and it hasn't failed). */
  connected: boolean;
  oauthConfigured: boolean;
  /** The server keeps accounts; then connections belong to workspaces. */
  accounts: boolean;
  signedIn: boolean;
  role: "owner" | "admin" | "member" | null;
  /** May connect or disconnect (an admin of the workspace, or anyone on a server without accounts). */
  canManage: boolean;
  /** The connected Google account (org or browser mode when known). */
  account: string | null;
  /** Clerk user id of whoever connected the workspace. */
  connectedBy: string | null;
  connectedAt: number | null;
  /** Why the workspace connection stopped working: an admin should reconnect. */
  lastError: string | null;
  /** The service account's email, when configured and usable by this caller. */
  serviceAccount: string | null;
  /** RESEARCH_TOKEN is set and this caller didn't present it. */
  serviceAccountLocked: boolean;
  /** The project's saved property (workspace setting), when a projectId was given. */
  property: string | null;
}

/** What's configured and connected. Never calls Google. */
export async function gscStatus(req: Request, projectId?: string | null): Promise<GscStatus> {
  const { accounts, session } = await gscContext(req);
  const sa = serviceAccount();
  const owner = isOwnerRequest(req.headers);
  const saEmail = sa && owner ? sa.client_email : null;
  const conn = session ? await connectionFor(session.db, session.orgId) : null;
  const orgOk = Boolean(conn && !conn.last_error && oauthConfigured());
  const browserOk = !accounts && oauthConfigured() && (await openToken(cookieOf(req))) !== null;
  const mode: GscStatus["mode"] = orgOk ? "org" : saEmail ? "service-account" : browserOk ? "browser" : "none";
  return {
    mode,
    connected: mode !== "none",
    oauthConfigured: oauthConfigured(),
    accounts,
    signedIn: Boolean(session),
    role: session?.role ?? null,
    canManage: session ? roleAtLeast(session.role, "admin") : !accounts,
    account: conn?.email ?? null,
    connectedBy: conn?.connected_by ?? null,
    connectedAt: conn?.created_at ?? null,
    lastError: conn?.last_error ?? null,
    serviceAccount: saEmail,
    serviceAccountLocked: Boolean(sa && !owner),
    property: session && validProjectId(projectId) ? await propertyFor(session.db, session.orgId, projectId) : null,
  };
}
