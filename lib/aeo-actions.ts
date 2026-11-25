"use client";

// AEO actions and impact: turn a suggested fix (an Opportunity from a run, or a step from a prompt's plan) into
// tracked work with a status, then measure whether visibility moved on the answers it targets once it's done.
// Stored per project in the browser and synced with the workspace like AI-visibility runs.

import { metricsFor, ownerOf, type Answer, type Brand, type Opportunity, type OpportunityKind } from "@/lib/aeo";
import type { AiEngine } from "@/lib/research-types";
import { setLocal } from "@/lib/store";

export type ActionStatus = "todo" | "doing" | "done" | "dismissed";
export type Channel = "owned" | "outreach" | "community" | "technical" | "reputation";

export const ACTION_STATUS: Record<ActionStatus, { label: string; cls: string }> = {
  todo: { label: "To do", cls: "" },
  doing: { label: "In progress", cls: "sev-high" },
  done: { label: "Done", cls: "gain" },
  dismissed: { label: "Archived", cls: "" },
};

export const CHANNELS: Record<Channel, { label: string; hint: string }> = {
  owned: { label: "Owned content", hint: "Pages on your own site: create or update them." },
  outreach: { label: "Outreach", hint: "Get onto the third-party pages engines cite: lists, reviews, articles." },
  community: { label: "Community & social", hint: "Forums, Reddit, YouTube, LinkedIn: the conversations engines quote." },
  technical: { label: "Technical", hint: "Access, crawlers and engine-specific fixes." },
  reputation: { label: "Reputation", hint: "How answers describe you." },
};

const CHANNEL_OF: Record<OpportunityKind, Channel> = { create: "owned", update: "owned", outreach: "outreach", community: "community", technical: "technical", reputation: "reputation" };

/** Which answers an action is about, so "before" and "after" compare like with like. */
export interface Scope {
  prompts?: string[];
  /** A third-party site to get onto: answers that cite it. */
  domain?: string;
  engine?: AiEngine;
}

export interface Snapshot {
  at: string;
  answered: number;
  /** % of in-scope answers naming you. */
  visibility: number;
  citationRate: number;
  avgPosition: number | null;
}

export interface AeoAction {
  id: string;
  /** Created. */
  at: string;
  updatedAt: string;
  title: string;
  kind: OpportunityKind;
  channel: Channel;
  priority: "high" | "medium" | "low";
  why: string;
  steps: string[];
  targets: { label: string; url?: string }[];
  scope: Scope;
  status: ActionStatus;
  doneAt?: string;
  owner?: string;
  note?: string;
  /** Estimated visibility lift, in points of overall visibility, when the action was tracked. */
  lift: number;
  /** In-scope numbers from the run the action was tracked from. */
  baseline: Snapshot | null;
}

export interface RunAnswers {
  at: string;
  answers: Answer[];
}

const KEY = (projectId: string) => `metainfo:aeo-actions:${projectId}`;
const MAX_ACTIONS = 300;

export function loadActions(projectId: string): AeoAction[] {
  try {
    const xs = JSON.parse(localStorage.getItem(KEY(projectId)) ?? "[]");
    return Array.isArray(xs) ? xs : [];
  } catch {
    return [];
  }
}

export function saveActions(projectId: string, actions: AeoAction[]): AeoAction[] {
  // Archived actions are kept (not deleted) so a merge with another device doesn't bring them back as new.
  const kept = actions.slice(-MAX_ACTIONS);
  try {
    setLocal(KEY(projectId), JSON.stringify(kept));
  } catch {
    /* storage full: keep in memory for this view */
  }
  return kept;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function scopeOf(o: Opportunity): Scope {
  if (o.id.startsWith("outreach-")) return { domain: o.id.slice("outreach-".length) };
  if (o.id.startsWith("engine-")) return { engine: o.id.slice("engine-".length) as AiEngine };
  return o.prompts.length ? { prompts: [...o.prompts] } : {};
}

/** The same suggestion from a later run keeps the same id, so it shows as already tracked. */
export function actionId(o: Opportunity): string {
  const s = scopeOf(o);
  return `${o.id}-${hash([...(s.prompts ?? [])].sort().join("|") + (s.domain ?? "") + (s.engine ?? ""))}`;
}

const ok = (a: Answer) => a.answered && !a.error;
const onDomain = (host: string, d: string) => host === d || host.endsWith(`.${d}`);

export function inScope(a: Answer, s: Scope): boolean {
  if (s.prompts?.length && !s.prompts.includes(a.prompt)) return false;
  if (s.engine && a.engine !== s.engine) return false;
  if (s.domain && !a.sources.some((x) => onDomain(x.domain.toLowerCase().replace(/^www\./, ""), s.domain!))) return false;
  return true;
}

export function snapshot(at: string, answers: Answer[], scope: Scope, you: string): Snapshot {
  const m = metricsFor(answers.filter((a) => inScope(a, scope)), you);
  return { at, answered: m.answered, visibility: m.visibility, citationRate: m.citationRate, avgPosition: m.avgPosition };
}

/**
 * Upper bound on the visibility gain: the in-scope answers that leave you out, as points of all answers in the run.
 * Actions that improve position or tone rather than presence have no visibility lift (0).
 */
export function estimateLift(o: Opportunity, answers: Answer[], you: string): number {
  const done = answers.filter(ok);
  if (!done.length) return 0;
  const s = scopeOf(o);
  const gaps = done.filter((a) => inScope(a, s) && !a.brands?.find((b) => b.domain === you)?.mentioned).length;
  return Math.round((gaps / done.length) * 1000) / 10;
}

export function trackAction(o: Opportunity, run: RunAnswers, you: string): AeoAction {
  const now = new Date().toISOString();
  const scope = scopeOf(o);
  return {
    id: actionId(o),
    at: now,
    updatedAt: now,
    title: o.title,
    kind: o.kind,
    channel: CHANNEL_OF[o.kind],
    priority: o.priority,
    why: o.why,
    steps: o.steps,
    targets: o.targets.slice(0, 12),
    scope,
    status: "todo",
    lift: estimateLift(o, run.answers, you),
    baseline: snapshot(run.at, run.answers, scope, you),
  };
}

export interface Impact {
  before: Snapshot;
  after: Snapshot;
  /** Runs since the action was done. */
  runsAfter: number;
  visibility: number;
  citationRate: number;
  /** Positive = moved up. */
  position: number | null;
}

/**
 * Before: the last run up to when the action was done (or the baseline it was tracked with). After: the latest run
 * since. Null until a run happens after it's done, or if no answer since falls in its scope.
 */
export function actionImpact(a: AeoAction, runs: RunAnswers[], you: string): Impact | null {
  if (a.status !== "done" || !a.doneAt) return null;
  const done = Date.parse(a.doneAt);
  const after = runs.filter((r) => Date.parse(r.at) > done);
  if (!after.length) return null;
  const prior = runs.filter((r) => Date.parse(r.at) <= done).at(-1);
  const before = prior ? snapshot(prior.at, prior.answers, a.scope, you) : a.baseline;
  const now = snapshot(after.at(-1)!.at, after.at(-1)!.answers, a.scope, you);
  if (!before || !before.answered || !now.answered) return null;
  return {
    before,
    after: now,
    runsAfter: after.length,
    visibility: now.visibility - before.visibility,
    citationRate: now.citationRate - before.citationRate,
    position: before.avgPosition != null && now.avgPosition != null ? Math.round((before.avgPosition - now.avgPosition) * 10) / 10 : null,
  };
}

// ------------------------------------------------------------- your pages

export interface OwnedPage {
  url: string;
  title: string;
  /** Answers citing the page, per run (oldest first). */
  perRun: number[];
  /** In the latest run. */
  prompts: string[];
  engines: AiEngine[];
  /** Share of the latest run's prompts whose answers cite the page, %. */
  frequency: number;
  firstSeen: string;
}

export const cleanUrl = (u: string) => {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^utm_|^ref$|^srsltid$/i.test(k)) x.searchParams.delete(k);
    return x.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
};

/** Every page of yours (your site or your accounts) that AI answers cited, across runs. */
export function ownedPages(runs: RunAnswers[], brands: Brand[]): OwnedPage[] {
  const you = brands[0]?.domain;
  if (!you) return [];
  const pages = new Map<string, OwnedPage>();
  const latest = runs.at(-1);
  const latestPrompts = new Set(latest?.answers.filter(ok).map((a) => a.prompt));
  runs.forEach((r, i) => {
    for (const a of r.answers.filter(ok)) {
      const seen = new Set<string>();
      for (const s of a.sources) {
        if (ownerOf(s.url, s.domain, brands) !== you) continue;
        const url = cleanUrl(s.url);
        if (seen.has(url)) continue;
        seen.add(url);
        const p = pages.get(url) ?? { url, title: s.title, perRun: runs.map(() => 0), prompts: [], engines: [], frequency: 0, firstSeen: r.at };
        p.perRun[i]++;
        if (!p.title && s.title) p.title = s.title;
        if (r === latest) {
          if (!p.prompts.includes(a.prompt)) p.prompts.push(a.prompt);
          if (!p.engines.includes(a.engine)) p.engines.push(a.engine);
        }
        pages.set(url, p);
      }
    }
  });
  for (const p of pages.values()) p.frequency = latestPrompts.size ? Math.round((p.prompts.length / latestPrompts.size) * 100) : 0;
  return [...pages.values()].sort((a, b) => b.perRun.at(-1)! - a.perRun.at(-1)! || b.perRun.reduce((x, y) => x + y, 0) - a.perRun.reduce((x, y) => x + y, 0));
}
