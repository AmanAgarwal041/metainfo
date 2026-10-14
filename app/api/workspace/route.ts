import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/server/auth/accounts";
import { handle, requireOrg } from "@/lib/server/auth/session";
import { isSyncedKey, MAX_KEYS, MAX_VALUE_BYTES } from "@/lib/workspace-keys";

export const dynamic = "force-dynamic";

interface Row {
  key: string;
  value: string;
  version: number;
  updatedAt: number;
}

/** GET → the active organisation's whole workspace: { orgId, entries: { key: { value, version, updatedAt } } }. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const s = await requireOrg(req);
    const { results } = await s.db
      .prepare("SELECT key, value, version, updated_at AS updatedAt FROM workspace WHERE org_id = ?")
      .bind(s.org.id)
      .all<Row>();
    return NextResponse.json(
      { orgId: s.org.id, entries: Object.fromEntries(results.map(({ key, ...r }) => [key, r])) },
      { headers: { "cache-control": "no-store" } },
    );
  });
}

/**
 * PUT { orgId, changes: [{ key, value, baseVersion }] } → each change applies only if the stored version
 * still equals baseVersion (0 = new key). Returns { versions } for applied keys and { conflicts } with
 * the current server copy for the rest, which the client merges and retries. `value: null` deletes
 * (kept as a "null" row so versions stay monotonic).
 */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const s = await requireOrg(req);
    const body = (await req.json().catch(() => null)) as { orgId?: string; changes?: { key: string; value: string | null; baseVersion: number }[] } | null;
    // Guard against a tab that's still showing another organisation's data.
    if (body?.orgId !== s.org.id) throw new AuthError("Your active organisation changed in another tab. Reload to continue.", 409);
    const changes = (body.changes ?? []).slice(0, 50);
    for (const c of changes) {
      if (!isSyncedKey(c.key)) throw new AuthError(`${c.key} isn't part of a workspace.`);
      if (c.value != null && (typeof c.value !== "string" || c.value.length > MAX_VALUE_BYTES)) throw new AuthError(`${c.key} is larger than ${MAX_VALUE_BYTES / 1e6} MB.`, 413);
    }
    const count = (await s.db.prepare("SELECT COUNT(*) AS n FROM workspace WHERE org_id = ?").bind(s.org.id).first<{ n: number }>())?.n ?? 0;
    if (count + changes.length > MAX_KEYS) throw new AuthError("This workspace has too many items to sync.", 413);

    const t = Date.now();
    const results = await s.db.batch(
      changes.map((c) =>
        s.db
          .prepare(
            `INSERT INTO workspace (org_id, key, value, version, updated_at, updated_by) VALUES (?, ?, ?, 1, ?, ?)
             ON CONFLICT (org_id, key) DO UPDATE SET value = excluded.value, version = workspace.version + 1,
               updated_at = excluded.updated_at, updated_by = excluded.updated_by
             WHERE workspace.version = ?`,
          )
          .bind(s.org.id, c.key, c.value ?? "null", t, s.user.id, c.baseVersion),
      ),
    );
    const keys = changes.map((c) => c.key);
    const { results: now } = keys.length
      ? await s.db
          .prepare(`SELECT key, value, version, updated_at AS updatedAt FROM workspace WHERE org_id = ? AND key IN (${keys.map(() => "?").join(",")})`)
          .bind(s.org.id, ...keys)
          .all<Row>()
      : { results: [] as Row[] };
    const byKey = new Map(now.map((r) => [r.key, r]));
    const versions: Record<string, number> = {};
    const conflicts: Record<string, Omit<Row, "key">> = {};
    changes.forEach((c, i) => {
      const row = byKey.get(c.key)!;
      if (results[i].meta.changes > 0) versions[c.key] = row.version;
      else conflicts[c.key] = { value: row.value, version: row.version, updatedAt: row.updatedAt };
    });
    return NextResponse.json({ versions, conflicts });
  });
}
