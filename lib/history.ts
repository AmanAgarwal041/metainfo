// Tracking: every scan of a URL is stored as a snapshot so you can see scores
// move over time, which fixes were verified by a rescan, and what regressed.
// Stored in localStorage (per browser). The /api/report endpoint covers
// server-side/CI tracking.

import type { CategoryScore, PlanPhase, Platform, Report, Status } from "@/lib/types";
import { setLocal } from "@/lib/store";

export type TaskState = "todo" | "doing" | "done" | "skipped";

export interface Snapshot {
  id: string;
  scannedAt: string;
  overall: number;
  scores: Partial<Record<Platform, number>>;
  statuses: Record<string, Status>;
  summary: Report["summary"];
  engineVersion: string;
  /** What the page says about itself, for drift alerts (absent on older snapshots). */
  fingerprint?: Fingerprint;
}

export interface Fingerprint {
  status: number | null;
  title: string | null;
  h1: string | null;
  canonical: string | null;
  noindex: boolean;
  schemaTypes: string[];
  ogImage: string | null;
  h2: string[];
  geo: number | null;
}

export function fingerprintOf(report: Report): Fingerprint {
  const shortType = (t: string) => t.replace(/^https?:\/\/(www\.)?schema\.org\//, "");
  return {
    status: report.status ?? null,
    title: report.page.title ?? null,
    h1: report.page.headings.find((h) => h.level === 1)?.text ?? null,
    canonical: report.page.canonicals[0] ?? null,
    noindex: report.checks.find((c) => c.id === "noindex")?.status === "fail",
    schemaTypes: [...new Set((report.schema?.items ?? []).flatMap((i) => i.types.map(shortType)))].sort(),
    ogImage: report.page.openGraph.find((o) => o.key === "og:image")?.value ?? null,
    h2: report.page.headings.filter((h) => h.level === 2).map((h) => h.text).slice(0, 30),
    geo: report.geo?.score.total ?? null,
  };
}

export interface DriftAlert {
  severity: "critical" | "high" | "medium";
  message: string;
}

/**
 * Content-level changes between two scans that a check status alone won't show
 * (after claude-seo's drift monitor): things removed, the page de-indexed,
 * titles or headings rewritten, the H2 outline reshuffled.
 */
export function driftAlerts(prev: Snapshot | undefined, next: Snapshot): DriftAlert[] {
  const a = prev?.fingerprint;
  const b = next.fingerprint;
  if (!a || !b) return [];
  const out: DriftAlert[] = [];
  const ok = (s: number | null) => s != null && s < 400;
  if (ok(a.status) && !ok(b.status)) out.push({ severity: "critical", message: `The page now returns HTTP ${b.status}.` });
  if (!a.noindex && b.noindex) out.push({ severity: "critical", message: "noindex was added: search engines will drop the page." });
  if (a.title && !b.title) out.push({ severity: "high", message: "The <title> was removed." });
  else if (a.title && b.title && a.title !== b.title) out.push({ severity: "medium", message: `Title changed from “${a.title}” to “${b.title}”.` });
  if (a.h1 && !b.h1) out.push({ severity: "high", message: `The H1 (“${a.h1}”) was removed.` });
  else if (a.h1 && b.h1 && similarity(a.h1, b.h1) < 0.5) out.push({ severity: "medium", message: `H1 rewritten: “${a.h1}” → “${b.h1}”.` });
  if (a.canonical && !b.canonical) out.push({ severity: "high", message: "The canonical tag was removed." });
  else if (a.canonical && b.canonical && a.canonical !== b.canonical) out.push({ severity: "high", message: `Canonical changed to ${b.canonical}.` });
  const lost = a.schemaTypes.filter((t) => !b.schemaTypes.includes(t));
  if (lost.length) out.push({ severity: "high", message: `Structured data removed: ${lost.join(", ")}.` });
  if (a.ogImage && !b.ogImage) out.push({ severity: "medium", message: "og:image was removed: link previews lose their image." });
  const goneH2 = a.h2.filter((h) => !b.h2.includes(h));
  if (a.h2.length >= 3 && goneH2.length / a.h2.length >= 0.5) out.push({ severity: "medium", message: `${goneH2.length} of ${a.h2.length} H2 sections changed or were removed.` });
  if (a.geo != null && b.geo != null && b.geo <= a.geo - 10) out.push({ severity: "medium", message: `GEO score fell from ${a.geo} to ${b.geo}.` });
  return out;
}

/** Word-overlap similarity (Jaccard), 0-1. */
function similarity(x: string, y: string): number {
  const w = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(Boolean));
  const a = w(x);
  const b = w(y);
  const inter = [...a].filter((t) => b.has(t)).length;
  return inter / Math.max(1, new Set([...a, ...b]).size);
}

export interface TrackedSite {
  key: string;
  url: string;
  title?: string | null;
  snapshots: Snapshot[];
  tasks: Record<string, { state: TaskState; updatedAt: string }>;
  /** Compact copy of the latest report, for the dashboard. */
  latest?: {
    plan: PlanPhase[];
    categories: CategoryScore[];
    blockedCrawlers: string[];
    llms: boolean;
    titles: Record<string, string>;
  };
}

const STORAGE_KEY = "metainfo:sites:v1";
const MAX_SNAPSHOTS = 200;

export function siteKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "") || "/"}${u.search}`;
  } catch {
    return url;
  }
}

export function loadSites(): Record<string, TrackedSite> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, TrackedSite>) : {};
  } catch {
    return {};
  }
}

function saveSites(sites: Record<string, TrackedSite>) {
  try {
    setLocal(STORAGE_KEY, JSON.stringify(sites));
  } catch {
    // Quota exceeded or storage blocked: tracking is best-effort.
  }
}

export function snapshotOf(report: Report): Snapshot {
  return {
    id: Math.random().toString(36).slice(2, 10),
    scannedAt: new Date().toISOString(),
    overall: report.summary.overall,
    scores: Object.fromEntries(report.scores.map((s) => [s.platform, s.score])),
    statuses: Object.fromEntries(report.checks.map((c) => [c.id, c.status])),
    summary: report.summary,
    engineVersion: report.engineVersion,
    fingerprint: fingerprintOf(report),
  };
}

/** Record a scan; returns the updated site. Tasks whose check now passes are marked done. */
export function recordScan(report: Report): TrackedSite {
  const sites = loadSites();
  const key = siteKey(report.finalUrl || report.url);
  const site: TrackedSite = sites[key] ?? { key, url: report.finalUrl || report.url, snapshots: [], tasks: {} };
  site.url = report.finalUrl || report.url;
  site.title = report.page.title;
  site.snapshots = [...site.snapshots, snapshotOf(report)].slice(-MAX_SNAPSHOTS);
  site.latest = {
    plan: report.plan,
    categories: report.categories,
    blockedCrawlers: report.crawlers.filter((c) => !c.allowed && c.purpose !== "training").map((c) => c.name),
    llms: Boolean(report.llms?.found),
    titles: Object.fromEntries(report.checks.map((c) => [c.id, c.title])),
  };
  const now = new Date().toISOString();
  for (const c of report.checks) {
    const t = site.tasks[c.id];
    if (c.status === "pass" && t && t.state !== "done") site.tasks[c.id] = { state: "done", updatedAt: now };
  }
  sites[key] = site;
  saveSites(sites);
  return site;
}

export function setTaskState(key: string, checkId: string, state: TaskState): TrackedSite | null {
  const sites = loadSites();
  const site = sites[key];
  if (!site) return null;
  site.tasks[checkId] = { state, updatedAt: new Date().toISOString() };
  saveSites(sites);
  return site;
}

export function removeSite(key: string) {
  const sites = loadSites();
  delete sites[key];
  saveSites(sites);
}

export interface Diff {
  fixed: string[];
  regressed: string[];
  stillFailing: string[];
}

export function diffSnapshots(prev: Snapshot | undefined, next: Snapshot): Diff {
  const bad = (s?: Status) => s === "fail" || s === "warn";
  const ids = Object.keys(next.statuses);
  if (!prev) return { fixed: [], regressed: [], stillFailing: ids.filter((id) => bad(next.statuses[id])) };
  return {
    fixed: ids.filter((id) => bad(prev.statuses[id]) && next.statuses[id] === "pass"),
    regressed: ids.filter((id) => prev.statuses[id] === "pass" && bad(next.statuses[id])),
    stillFailing: ids.filter((id) => bad(prev.statuses[id]) && bad(next.statuses[id])),
  };
}

/** The tracked site that best matches a project's domain (its homepage first). */
export function siteForDomain(sites: Record<string, TrackedSite>, domain: string): TrackedSite | null {
  if (!domain) return null;
  const all = Object.values(sites);
  return (
    sites[`${domain}/`] ??
    all
      .filter((s) => s.key === domain || s.key.startsWith(`${domain}/`))
      .sort((a, b) => (b.snapshots.at(-1)?.scannedAt ?? "").localeCompare(a.snapshots.at(-1)?.scannedAt ?? ""))[0] ??
    null
  );
}
