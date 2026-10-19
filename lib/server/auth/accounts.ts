// Accounts are Clerk's: users, organisations, members, roles and invites live
// there. D1 keeps one `orgs` row per synced workspace, keyed by MetaInfo's own
// id (the `workspace` table points at it), with the Clerk scope it belongs to
// in `clerk_id`: a Clerk organisation id, or a Clerk user id for someone's
// personal workspace.

import { randomId } from "./crypto";
import { verifiedEmails } from "./clerk";

export type Role = "owner" | "admin" | "member";
const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };
export const roleAtLeast = (role: Role | null | undefined, needed: Role) => !!role && RANK[role] >= RANK[needed];

export class AuthError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Workspaces made with the sign-in MetaInfo had before Clerk carry over: the
 * first Clerk workspace that one of their owners opens (as an admin, or their
 * personal one), signed in with the same verified email, takes the oldest such
 * workspace they owned that nothing has claimed yet.
 */
async function unclaimedLegacyOrg(db: D1Database, userId: string): Promise<string | null> {
  const emails = await verifiedEmails(userId);
  if (!emails.length) return null;
  const row = await db
    .prepare(
      `SELECT o.id FROM orgs o
         JOIN members m ON m.org_id = o.id AND m.role = 'owner'
         JOIN user_emails e ON e.user_id = m.user_id
       WHERE o.clerk_id IS NULL AND e.email IN (${emails.map(() => "?").join(",")})
       ORDER BY o.created_at LIMIT 1`,
    )
    .bind(...emails)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** The D1 workspace behind a Clerk scope, created (or carried over) on first use. */
export async function workspaceFor(db: D1Database, scope: string, userId: string, role: Role): Promise<string> {
  const find = () => db.prepare("SELECT id FROM orgs WHERE clerk_id = ?").bind(scope).first<{ id: string }>();
  const known = await find();
  if (known) return known.id;
  const legacy = roleAtLeast(role, "admin") ? await unclaimedLegacyOrg(db, userId) : null;
  if (legacy) await db.prepare("UPDATE orgs SET clerk_id = ? WHERE id = ? AND clerk_id IS NULL").bind(scope, legacy).run();
  if (!(await find())) {
    // The unique index on clerk_id settles two first requests racing each other.
    await db
      .prepare("INSERT OR IGNORE INTO orgs (id, name, created_by, created_at, clerk_id) VALUES (?, ?, ?, ?, ?)")
      .bind(randomId(), scope === userId ? "Personal" : "Organisation", userId, Date.now(), scope)
      .run();
  }
  const row = await find();
  if (!row) throw new AuthError("Couldn't open this workspace. Try again.", 500);
  return row.id;
}
