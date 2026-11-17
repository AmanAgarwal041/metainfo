// Traffic collectors: their tokens, ingesting what they report, and the
// numbers the Traffic page shows. Events are folded into hourly counts on the
// way in (see migrations/0003_traffic.sql); nothing about an individual
// visitor is stored: no IP, no cookie, no pseudonym.

import { randomId } from "@/lib/server/auth/crypto";
import { bareDomain } from "@/lib/research-types";
import {
  AI_KINDS,
  AI_SOURCES,
  OTHER_BOT,
  classify,
  hostMatches,
  normalisePath,
  referralSource,
  type CollectorSite,
  type Kind,
  type TrafficEvent,
  type TrafficStats,
} from "@/lib/traffic";

const HOUR = 3_600_000;
/** Counts older than this are dropped. */
export const RETENTION_DAYS = 120;
/** Per request: what a collector may send at once. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
export const MAX_EVENTS = 5000;
/** Events stamped further than this from the server's clock are refused. */
const MAX_PAST_MS = 48 * HOUR;
const MAX_FUTURE_MS = 10 * 60_000;
const VIA = /^[a-z0-9-]{1,32}$/;

export interface SiteRow {
  id: string;
  orgId: string;
  projectId: string;
  domain: string;
  tokenHint: string;
  createdAt: number;
  lastEventAt: number | null;
  lastVia: string | null;
}

/** What the API shows of a site (never the token). `workspace` is the id clients know the workspace by. */
export const publicSite = (s: SiteRow, workspace: string): CollectorSite => ({
  projectId: s.projectId,
  domain: s.domain,
  workspaceId: workspace,
  siteUrl: `https://${s.domain}`,
  tokenHint: s.tokenHint,
  createdAt: s.createdAt,
  lastEventAt: s.lastEventAt,
  lastVia: s.lastVia,
});

const SITE_COLUMNS =
  "id, org_id AS orgId, project_id AS projectId, domain, token_hint AS tokenHint, created_at AS createdAt, last_event_at AS lastEventAt, last_via AS lastVia";

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  return `mtr_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function sitesFor(db: D1Database, orgId: string): Promise<SiteRow[]> {
  const { results } = await db.prepare(`SELECT ${SITE_COLUMNS} FROM traffic_sites WHERE org_id = ? ORDER BY created_at`).bind(orgId).all<SiteRow>();
  return results;
}

export async function siteFor(db: D1Database, orgId: string, projectId: string): Promise<SiteRow | null> {
  return db.prepare(`SELECT ${SITE_COLUMNS} FROM traffic_sites WHERE org_id = ? AND project_id = ?`).bind(orgId, projectId).first<SiteRow>();
}

/** Creates the project's collector token, or replaces it (the old one stops working at once). Returns the token: it's shown once. */
export async function issueToken(db: D1Database, orgId: string, projectId: string, domain: string, userId: string): Promise<{ site: SiteRow; token: string }> {
  const token = newToken();
  const hash = await sha256Hex(token);
  await db
    .prepare(
      `INSERT INTO traffic_sites (id, org_id, project_id, domain, token_hash, token_hint, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (org_id, project_id) DO UPDATE SET domain = excluded.domain, token_hash = excluded.token_hash, token_hint = excluded.token_hint`,
    )
    .bind(randomId(), orgId, projectId, domain, hash, token.slice(-4), userId, Date.now())
    .run();
  const site = await siteFor(db, orgId, projectId);
  if (!site) throw new Error("The collector token wasn't saved.");
  return { site, token };
}

export async function deleteSite(db: D1Database, orgId: string, projectId: string): Promise<void> {
  const site = await siteFor(db, orgId, projectId);
  if (!site) return;
  await db.batch([db.prepare("DELETE FROM traffic_hits WHERE site_id = ?").bind(site.id), db.prepare("DELETE FROM traffic_sites WHERE id = ?").bind(site.id)]);
}

// ------------------------------------------------------------------ ingest

export interface IngestResult {
  accepted: number;
  rejected: number;
  /** Why events were refused, with counts (at most a few reasons). */
  reasons: Record<string, number>;
}

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v ? v.slice(0, max) : undefined);

function parseEvent(line: string): TrafficEvent | string {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line);
  } catch {
    return "not JSON";
  }
  if (!o || typeof o !== "object") return "not an object";
  if (o.v !== 1) return "unknown protocol version";
  const ts = typeof o.ts === "number" ? o.ts : NaN;
  const host = str(o.host, 255);
  const path = str(o.path, 2048);
  const method = str(o.method, 10)?.toUpperCase();
  if (!Number.isFinite(ts) || !host || !path || !method) return "missing ts, host, path or method";
  const status = typeof o.status === "number" && Number.isInteger(o.status) && o.status >= 0 && o.status < 1000 ? o.status : 0;
  return {
    v: 1,
    ts,
    method,
    host,
    path,
    status,
    ua: str(o.ua, 512) ?? "",
    referer: str(o.referer, 2048),
    utm: str(o.utm, 128),
    fetchMode: str(o.fetchMode, 32),
    signatureAgent: str(o.signatureAgent, 255),
  };
}

/** The counting key of an event: what's kept of it. */
function bucket(e: TrafficEvent): { hour: number; kind: Kind; agent: string; source: string; path: string; status: number } {
  const { kind, agent } = classify(e.ua, e.fetchMode, e.signatureAgent);
  return {
    hour: Math.floor(e.ts / HOUR),
    kind,
    agent,
    source: kind === "human" ? referralSource(e.referer, e.utm, e.host) : "",
    path: agent === OTHER_BOT ? "" : normalisePath(e.path),
    status: e.status,
  };
}

/** Folds an NDJSON batch from a collector into the site's hourly counts. */
export async function ingest(db: D1Database, site: { id: string; domain: string }, body: string, via: string | null): Promise<IngestResult> {
  const now = Date.now();
  const counts = new Map<string, number>();
  const reasons: Record<string, number> = {};
  let accepted = 0;
  let rejected = 0;
  const refuse = (why: string) => {
    rejected++;
    reasons[why] = (reasons[why] ?? 0) + 1;
  };

  const lines = body.split("\n");
  for (const raw of lines.slice(0, MAX_EVENTS)) {
    const line = raw.trim();
    if (!line) continue;
    const e = parseEvent(line);
    if (typeof e === "string") {
      refuse(e);
      continue;
    }
    if (e.ts < now - MAX_PAST_MS || e.ts > now + MAX_FUTURE_MS) {
      refuse("timestamp out of range");
      continue;
    }
    if (!hostMatches(e.host, site.domain)) {
      refuse(`host isn't ${site.domain}`);
      continue;
    }
    if (e.method !== "GET" && e.method !== "HEAD") {
      refuse("not a page load");
      continue;
    }
    const b = bucket(e);
    const key = JSON.stringify([b.hour, b.kind, b.agent, b.source, b.path, b.status]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    accepted++;
  }
  const overflow = lines.filter((l) => l.trim()).length - MAX_EVENTS;
  if (overflow > 0) {
    rejected += overflow;
    reasons[`more than ${MAX_EVENTS} events in one request`] = overflow;
  }

  const upsert = db.prepare(
    `INSERT INTO traffic_hits (site_id, hour, kind, agent, source, path, status, hits) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (site_id, hour, kind, agent, source, path, status) DO UPDATE SET hits = traffic_hits.hits + excluded.hits`,
  );
  const statements = [...counts].map(([key, n]) => upsert.bind(site.id, ...(JSON.parse(key) as unknown[]), n));
  statements.push(
    db.prepare("UPDATE traffic_sites SET last_event_at = ?, last_via = COALESCE(?, last_via) WHERE id = ?").bind(now, via && VIA.test(via) ? via : null, site.id),
  );
  // Now and then, drop counts past the retention window.
  if (Math.random() < 0.02) {
    statements.push(db.prepare("DELETE FROM traffic_hits WHERE site_id = ? AND hour < ?").bind(site.id, Math.floor(now / HOUR) - RETENTION_DAYS * 24));
  }
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
  return { accepted, rejected, reasons };
}

/** The site a collector token belongs to, with its workspace's id (the Clerk organisation or user id), or null. */
export async function siteForToken(db: D1Database, token: string): Promise<{ id: string; domain: string; workspace: string | null } | null> {
  if (!/^mtr_[0-9a-f]{48}$/.test(token)) return null;
  return db
    .prepare("SELECT s.id, s.domain, o.clerk_id AS workspace FROM traffic_sites s JOIN orgs o ON o.id = s.org_id WHERE s.token_hash = ?")
    .bind(await sha256Hex(token))
    .first<{ id: string; domain: string; workspace: string | null }>();
}

export type Route = { ok: true; site: { id: string; domain: string } } | { ok: false; status: number; error: string };

/**
 * Which site a collector's batch belongs to. All three of the collector's settings have to agree: the token
 * picks the site, and the workspace id and the site URL it sends must be that site's. So a token copied into
 * another site's config, or a config pointing at the wrong workspace, is refused rather than mixing data.
 */
export async function routeCollector(db: D1Database, token: string, workspace: string, siteUrl: string): Promise<Route> {
  if (!token || !workspace || !siteUrl) {
    return { ok: false, status: 400, error: "Set METAINFO_TOKEN, METAINFO_ORG and METAINFO_SITE (all three are on the Traffic page)." };
  }
  const site = await siteForToken(db, token);
  if (!site) return { ok: false, status: 401, error: "Unknown collector token. Create one on the Traffic page." };
  if (site.workspace !== workspace) return { ok: false, status: 403, error: "METAINFO_ORG isn't the workspace this token belongs to." };
  if (bareDomain(siteUrl) !== site.domain) return { ok: false, status: 403, error: `METAINFO_SITE doesn't match this token's site (${site.domain}).` };
  return { ok: true, site: { id: site.id, domain: site.domain } };
}

// ------------------------------------------------------------------- stats


const AI_SOURCE_IDS = AI_SOURCES;
const inList = (xs: string[]) => xs.map(() => "?").join(",");

export async function trafficStats(db: D1Database, siteId: string, days: number): Promise<TrafficStats> {
  const nowHour = Math.floor(Date.now() / HOUR);
  const fromDay = Math.floor(nowHour / 24) - days + 1;
  const from = fromDay * 24;
  const q = <T,>(sql: string, ...extra: unknown[]) =>
    db.prepare(sql).bind(siteId, from, ...extra).all<T>().then((r) => r.results);
  const W = "WHERE site_id = ? AND hour >= ?";

  const [daily, aiDaily, agents, failures, aiPaths, sources, aiLandings, topPages] = await Promise.all([
    q<{ day: number; kind: Kind; hits: number }>(`SELECT hour / 24 AS day, kind, SUM(hits) AS hits FROM traffic_hits ${W} GROUP BY day, kind`),
    q<{ day: number; hits: number }>(
      `SELECT hour / 24 AS day, SUM(hits) AS hits FROM traffic_hits ${W} AND kind = 'human' AND source IN (${inList(AI_SOURCE_IDS)}) GROUP BY day`,
      ...AI_SOURCE_IDS,
    ),
    q<{ agent: string; kind: Kind; hits: number; lastHour: number; errors: number; unknownStatus: number }>(
      `SELECT agent, kind, SUM(hits) AS hits, MAX(hour) AS lastHour,
              SUM(CASE WHEN status >= 400 THEN hits ELSE 0 END) AS errors,
              SUM(CASE WHEN status = 0 THEN hits ELSE 0 END) AS unknownStatus
       FROM traffic_hits ${W} AND kind != 'human' GROUP BY agent, kind ORDER BY hits DESC LIMIT 100`,
    ),
    q<{ agent: string; kind: Kind; status: number; path: string; hits: number }>(
      `SELECT agent, kind, status, path, SUM(hits) AS hits FROM traffic_hits ${W}
       AND kind IN (${inList([...AI_KINDS, "search"])}) AND status >= 400 GROUP BY agent, kind, status, path ORDER BY hits DESC LIMIT 50`,
      ...AI_KINDS,
      "search",
    ),
    q<{ path: string; hits: number; agents: string }>(
      `SELECT path, SUM(hits) AS hits, GROUP_CONCAT(DISTINCT agent) AS agents FROM traffic_hits ${W}
       AND kind IN (${inList(AI_KINDS)}) GROUP BY path ORDER BY hits DESC LIMIT 25`,
      ...AI_KINDS,
    ),
    q<{ source: string; hits: number }>(`SELECT source, SUM(hits) AS hits FROM traffic_hits ${W} AND kind = 'human' GROUP BY source ORDER BY hits DESC LIMIT 40`),
    q<{ path: string; source: string; hits: number }>(
      `SELECT path, source, SUM(hits) AS hits FROM traffic_hits ${W} AND kind = 'human' AND source IN (${inList(AI_SOURCE_IDS)})
       GROUP BY path, source ORDER BY hits DESC LIMIT 25`,
      ...AI_SOURCE_IDS,
    ),
    q<{ path: string; hits: number }>(`SELECT path, SUM(hits) AS hits FROM traffic_hits ${W} AND kind = 'human' GROUP BY path ORDER BY hits DESC LIMIT 15`),
  ]);

  const totals = { human: 0, ai_search: 0, ai_user: 0, ai_training: 0, search: 0, preview: 0, bot: 0 } as Record<Kind, number>;
  const byDay = new Map<number, TrafficStats["daily"][number]>();
  for (let d = fromDay; d < fromDay + days; d++) byDay.set(d, { day: d, counts: {}, aiReferrals: 0 });
  for (const r of daily) {
    totals[r.kind] = (totals[r.kind] ?? 0) + r.hits;
    const row = byDay.get(r.day);
    if (row) row.counts[r.kind] = (row.counts[r.kind] ?? 0) + r.hits;
  }
  for (const r of aiDaily) {
    const row = byDay.get(r.day);
    if (row) row.aiReferrals = r.hits;
  }
  return {
    days,
    fromDay,
    totals,
    daily: [...byDay.values()],
    agents,
    failures,
    aiPaths: aiPaths.map((r) => ({ path: r.path, hits: r.hits, agents: (r.agents ?? "").split(",").filter(Boolean) })),
    sources,
    aiLandings,
    topPages,
  };
}
