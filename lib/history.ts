// Tracking: every scan of a URL is stored as a snapshot so you can see scores
// move over time, which fixes were verified by a rescan, and what regressed.
// Stored in localStorage (per browser). The /api/report endpoint covers
// server-side/CI tracking.

import type { CategoryScore, PlanPhase, Platform, Report, Status } from "@/lib/types";

export type TaskState = "todo" | "doing" | "done" | "skipped";

export interface Snapshot {
  id: string;
  scannedAt: string;
  overall: number;
  scores: Partial<Record<Platform, number>>;
  statuses: Record<string, Status>;
  summary: Report["summary"];
  engineVersion: string;
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sites));
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
