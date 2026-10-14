// Users, sessions, organisations, members and invites on D1. Ported from
// socialbrewery's accounts layer, with one table per record type instead of
// whole-collection JSON documents.

import { randomId, randomToken, sha256 } from "./crypto";

export type Role = "owner" | "admin" | "member";
export const ROLES: Role[] = ["owner", "admin", "member"];
const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };
export const roleAtLeast = (role: Role | null | undefined, needed: Role) => !!role && RANK[role] >= RANK[needed];

export const SESSION_COOKIE = "mi_session";
export const SESSION_DAYS = 30;
const INVITE_DAYS = 14;
const STATE_MINUTES = 10;

export interface User {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}
export interface OrgSummary {
  id: string;
  name: string;
  role: Role;
}
export interface Identity {
  provider: string;
  subject: string;
  /** Verified addresses only; the first is the primary one. */
  emails: string[];
  name: string | null;
  picture: string | null;
}

export class AuthError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const now = () => Date.now();
const clean = (email: string) => email.trim().toLowerCase();

// ------------------------------------------------------------------ OAuth state

export async function saveAuthState(db: D1Database, s: { provider: string; verifier: string | null; invite: string | null; returnTo: string | null }) {
  const state = randomToken();
  await db.prepare("DELETE FROM auth_states WHERE expires_at < ?").bind(now()).run();
  await db
    .prepare("INSERT INTO auth_states (state_hash, provider, verifier, invite, return_to, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256(state), s.provider, s.verifier, s.invite, s.returnTo, now() + STATE_MINUTES * 60_000)
    .run();
  return state;
}

/** Single use: the row is deleted whether or not it's still valid. */
export async function takeAuthState(db: D1Database, state: string) {
  const row = await db
    .prepare("DELETE FROM auth_states WHERE state_hash = ? RETURNING provider, verifier, invite, return_to, expires_at")
    .bind(await sha256(state))
    .first<{ provider: string; verifier: string | null; invite: string | null; return_to: string | null; expires_at: number }>();
  return row && row.expires_at > now() ? row : null;
}

// ------------------------------------------------------------------ users

/** Find the user by provider login, then by any verified email; create one otherwise. */
export async function upsertUser(db: D1Database, id: Identity): Promise<User> {
  const emails = [...new Set(id.emails.map(clean))];
  if (!emails.length) throw new AuthError("Your account has no verified email address.");
  let userId =
    (await db.prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?").bind(id.provider, id.subject).first<{ user_id: string }>())?.user_id ??
    (await db
      .prepare(`SELECT user_id FROM user_emails WHERE email IN (${emails.map(() => "?").join(",")}) LIMIT 1`)
      .bind(...emails)
      .first<{ user_id: string }>())?.user_id;

  const t = now();
  const stmts: D1PreparedStatement[] = [];
  if (!userId) {
    userId = randomId();
    stmts.push(
      db.prepare("INSERT INTO users (id, email, name, picture, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)").bind(userId, emails[0], id.name, id.picture, t, t),
    );
  } else {
    stmts.push(
      db.prepare("UPDATE users SET name = COALESCE(?, name), picture = COALESCE(?, picture), last_login_at = ? WHERE id = ?").bind(id.name, id.picture, t, userId),
    );
  }
  stmts.push(db.prepare("INSERT OR IGNORE INTO identities (provider, subject, user_id) VALUES (?, ?, ?)").bind(id.provider, id.subject, userId));
  for (const e of emails) stmts.push(db.prepare("INSERT OR IGNORE INTO user_emails (email, user_id) VALUES (?, ?)").bind(e, userId));
  await db.batch(stmts);
  return (await db.prepare("SELECT id, email, name, picture FROM users WHERE id = ?").bind(userId).first<User>())!;
}

async function userEmails(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db.prepare("SELECT email FROM user_emails WHERE user_id = ?").bind(userId).all<{ email: string }>();
  return results.map((r) => r.email);
}

// ------------------------------------------------------------------ sessions

export async function createSession(db: D1Database, userId: string, orgId: string | null) {
  const token = randomToken();
  const t = now();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    db
      .prepare("INSERT INTO sessions (token_hash, user_id, org_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256(token), userId, orgId, t, t + SESSION_DAYS * 86_400_000),
  ]);
  return token;
}

export async function sessionUser(db: D1Database, token: string | undefined) {
  if (!token) return null;
  const hash = await sha256(token);
  const row = await db
    .prepare(
      "SELECT s.token_hash, s.org_id, s.expires_at, u.id, u.email, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
    )
    .bind(hash)
    .first<{ token_hash: string; org_id: string | null; expires_at: number } & User>();
  if (!row || row.expires_at < now()) return null;
  return { hash, orgId: row.org_id, user: { id: row.id, email: row.email, name: row.name, picture: row.picture } as User };
}

export async function deleteSession(db: D1Database, token: string | undefined) {
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export async function setSessionOrg(db: D1Database, hash: string, orgId: string) {
  await db.prepare("UPDATE sessions SET org_id = ? WHERE token_hash = ?").bind(orgId, hash).run();
}

// ------------------------------------------------------------------ organisations

export async function membershipsFor(db: D1Database, userId: string): Promise<OrgSummary[]> {
  const { results } = await db
    .prepare("SELECT o.id, o.name, m.role FROM members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY m.joined_at")
    .bind(userId)
    .all<OrgSummary>();
  return results;
}

export async function roleIn(db: D1Database, orgId: string, userId: string): Promise<Role | null> {
  return (await db.prepare("SELECT role FROM members WHERE org_id = ? AND user_id = ?").bind(orgId, userId).first<{ role: Role }>())?.role ?? null;
}

export async function createOrg(db: D1Database, name: string, ownerId: string): Promise<string> {
  const id = randomId();
  const t = now();
  await db.batch([
    db.prepare("INSERT INTO orgs (id, name, created_by, created_at) VALUES (?, ?, ?, ?)").bind(id, orgName(name), ownerId, t),
    db.prepare("INSERT INTO members (org_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, ownerId, t),
  ]);
  return id;
}

export function orgName(name: unknown): string {
  const n = String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!n) throw new AuthError("Give the organisation a name.");
  return n;
}

export async function renameOrg(db: D1Database, orgId: string, name: unknown) {
  await db.prepare("UPDATE orgs SET name = ? WHERE id = ?").bind(orgName(name), orgId).run();
}

export async function orgDetails(db: D1Database, orgId: string) {
  const [org, members, invites] = await Promise.all([
    db.prepare("SELECT id, name, created_at AS createdAt FROM orgs WHERE id = ?").bind(orgId).first<{ id: string; name: string; createdAt: number }>(),
    db
      .prepare(
        "SELECT u.id, u.email, u.name, u.picture, m.role, m.joined_at AS joinedAt FROM members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.joined_at",
      )
      .bind(orgId)
      .all<User & { role: Role; joinedAt: number }>(),
    db
      .prepare("SELECT id, email, role, created_at AS createdAt, expires_at AS expiresAt FROM invites WHERE org_id = ? AND expires_at > ? ORDER BY created_at DESC")
      .bind(orgId, now())
      .all<{ id: string; email: string; role: Role; createdAt: number; expiresAt: number }>(),
  ]);
  return { org, members: members.results, invites: invites.results };
}

async function ownerCount(db: D1Database, orgId: string) {
  return (await db.prepare("SELECT COUNT(*) AS n FROM members WHERE org_id = ? AND role = 'owner'").bind(orgId).first<{ n: number }>())?.n ?? 0;
}

export async function changeRole(db: D1Database, orgId: string, actor: Role, targetId: string, role: Role) {
  if (!ROLES.includes(role)) throw new AuthError("Unknown role.");
  const current = await roleIn(db, orgId, targetId);
  if (!current) throw new AuthError("That person isn't a member.", 404);
  if ((current === "owner" || role === "owner") && actor !== "owner") throw new AuthError("Only an owner can change owners.", 403);
  if (current === "owner" && role !== "owner" && (await ownerCount(db, orgId)) < 2) throw new AuthError("An organisation needs at least one owner.");
  await db.prepare("UPDATE members SET role = ? WHERE org_id = ? AND user_id = ?").bind(role, orgId, targetId).run();
}

export async function removeMember(db: D1Database, orgId: string, actor: Role, actorId: string, targetId: string) {
  const current = await roleIn(db, orgId, targetId);
  if (!current) throw new AuthError("That person isn't a member.", 404);
  if (targetId !== actorId && !roleAtLeast(actor, "admin")) throw new AuthError("Only admins can remove members.", 403);
  if (current === "owner" && actor !== "owner") throw new AuthError("Only an owner can remove an owner.", 403);
  if (current === "owner" && (await ownerCount(db, orgId)) < 2) throw new AuthError("An organisation needs at least one owner. Make someone else an owner first.");
  await db.batch([
    db.prepare("DELETE FROM members WHERE org_id = ? AND user_id = ?").bind(orgId, targetId),
    db.prepare("UPDATE sessions SET org_id = NULL WHERE user_id = ? AND org_id = ?").bind(targetId, orgId),
  ]);
}

// ------------------------------------------------------------------ invites

export async function createInvite(db: D1Database, orgId: string, actor: Role, actorId: string, email: unknown, role: Role) {
  const addr = clean(String(email ?? ""));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new AuthError("Enter a valid email address.");
  if (!ROLES.includes(role)) throw new AuthError("Unknown role.");
  if (role === "owner" && actor !== "owner") throw new AuthError("Only an owner can invite an owner.", 403);
  const token = randomToken();
  const id = randomId();
  const t = now();
  await db.batch([
    db.prepare("DELETE FROM invites WHERE org_id = ? AND email = ?").bind(orgId, addr),
    db
      .prepare("INSERT INTO invites (id, org_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, orgId, addr, role, await sha256(token), actorId, t, t + INVITE_DAYS * 86_400_000),
  ]);
  return { id, token };
}

export async function revokeInvite(db: D1Database, orgId: string, inviteId: string) {
  await db.prepare("DELETE FROM invites WHERE id = ? AND org_id = ?").bind(inviteId, orgId).run();
}

export async function lookupInvite(db: D1Database, token: string) {
  return db
    .prepare("SELECT i.email, i.role, o.name AS orgName FROM invites i JOIN orgs o ON o.id = i.org_id WHERE i.token_hash = ? AND i.expires_at > ?")
    .bind(await sha256(token), now())
    .first<{ email: string; role: Role; orgName: string }>();
}

/**
 * Join every live invite addressed to one of the user's verified emails. A
 * token alone isn't enough: the invite's email must be one of theirs.
 * Returns the org ids joined, and whether a presented token didn't match.
 */
export async function acceptInvites(db: D1Database, user: User, token: string | null) {
  const emails = await userEmails(db, user.id);
  const { results } = await db
    .prepare(`SELECT id, org_id, role, token_hash FROM invites WHERE expires_at > ? AND email IN (${emails.map(() => "?").join(",")})`)
    .bind(now(), ...emails)
    .all<{ id: string; org_id: string; role: Role; token_hash: string }>();
  const tokenHash = token ? await sha256(token) : null;
  const t = now();
  const stmts = results.flatMap((i) => [
    db.prepare("INSERT OR IGNORE INTO members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)").bind(i.org_id, user.id, i.role, t),
    db.prepare("DELETE FROM invites WHERE id = ?").bind(i.id),
  ]);
  if (stmts.length) await db.batch(stmts);
  const matched = tokenHash ? results.find((i) => i.token_hash === tokenHash) : undefined;
  return {
    joined: results.map((i) => i.org_id),
    preferred: matched?.org_id ?? results.at(-1)?.org_id ?? null,
    tokenMismatch: !!tokenHash && !matched,
  };
}
