"use client";

// AI visibility without answer tracking: what the site's own traffic collector (the Cloudflare worker) says about
// each AI engine (does its crawler read the site, does it send people), plus converters that turn traffic insights,
// agent simulations and Search Console opportunities into suggestions the Recommendations tab can track.

import { FACTORS, PROMPT_TYPES, type Opportunity, type OpportunityKind, type Simulation } from "@/lib/aeo";
import type { InsightLevel, Insight } from "@/lib/traffic-insights";
import type { TrafficStats } from "@/lib/traffic";
import { setLocal } from "@/lib/store";
import { AI_ENGINES, type AiEngine } from "@/lib/research-types";

// ---------------------------------------------------------------- engines

export interface EngineSignal {
  id: string;
  label: string;
  color: string;
  /** Search-index and live-fetch crawler hits: the visits that let an answer quote the site. */
  answerCrawls: number;
  /** Fetches made because someone asked the assistant right now. */
  liveFetches: number;
  trainingCrawls: number;
  /** People who clicked through from the engine's answers. */
  referrals: number;
  agents: string[];
}

const ENGINES: { id: string; label: string; color: string; answer: string[]; training: string[]; sources: string[] }[] = [
  { id: "chatgpt", label: "ChatGPT", color: "var(--series-3)", answer: ["oai-searchbot", "chatgpt-user"], training: ["gptbot"], sources: ["chatgpt"] },
  { id: "claude", label: "Claude", color: "var(--series-5)", answer: ["claude-searchbot", "claude-user"], training: ["claudebot"], sources: ["claude"] },
  { id: "perplexity", label: "Perplexity", color: "var(--series-4)", answer: ["perplexitybot", "perplexity-user"], training: [], sources: ["perplexity"] },
  { id: "gemini", label: "Gemini & AI Overviews", color: "var(--series-1)", answer: ["google-agent", "googlebot"], training: [], sources: ["gemini"] },
  { id: "copilot", label: "Copilot", color: "var(--series-7)", answer: ["bingbot"], training: [], sources: ["copilot"] },
  { id: "meta", label: "Meta AI", color: "var(--series-2)", answer: ["meta-externalfetcher"], training: ["meta-externalagent"], sources: ["meta-ai"] },
  { id: "mistral", label: "Le Chat", color: "var(--series-6)", answer: ["mistralai-user"], training: [], sources: ["mistral"] },
];

/** The engines most buyers use: the denominator of coverage. */
export const MAJOR_ENGINES = ["chatgpt", "claude", "perplexity", "gemini", "copilot"];

export function engineSignals(stats: TrafficStats): EngineSignal[] {
  const hits = (ids: string[], kinds?: string[]) => stats.agents.filter((a) => ids.includes(a.agent) && (!kinds || kinds.includes(a.kind))).reduce((n, a) => n + a.hits, 0);
  return ENGINES.map((e) => ({
    id: e.id,
    label: e.label,
    color: e.color,
    answerCrawls: hits(e.answer),
    liveFetches: hits(e.answer, ["ai_user"]),
    trainingCrawls: hits(e.training),
    referrals: stats.sources.filter((s) => e.sources.includes(s.source)).reduce((n, s) => n + s.hits, 0),
    agents: stats.agents.filter((a) => (e.answer.includes(a.agent) || e.training.includes(a.agent)) && a.hits > 0).map((a) => a.agent),
  }));
}

/** Of the major engines, the share that read the site for answers or send people from them, %. */
export function coverage(signals: EngineSignal[]): { pct: number; reached: string[]; missing: string[] } {
  const major = signals.filter((s) => MAJOR_ENGINES.includes(s.id));
  const reached = major.filter((s) => s.answerCrawls > 0 || s.referrals > 0);
  return { pct: major.length ? Math.round((reached.length / major.length) * 100) : 0, reached: reached.map((s) => s.label), missing: major.filter((s) => !reached.includes(s)).map((s) => s.label) };
}

// ----------------------------------------------------------- suggestions

/** Where a suggestion came from. */
export type SuggestionSource = "answers" | "traffic" | "simulation" | "search-console";

export const SOURCE_LABEL: Record<SuggestionSource, string> = {
  answers: "AI answers",
  traffic: "Traffic collector",
  simulation: "Agent simulation",
  "search-console": "Search Console",
};

export interface Suggestion extends Opportunity {
  source: SuggestionSource;
  /** What doing it is worth, when it isn't a visibility lift (e.g. "+40 clicks / 28 days"). */
  estimate?: string;
}

const PRIORITY: Record<InsightLevel, Opportunity["priority"]> = { high: "high", medium: "medium", low: "low", good: "low" };

/** A traffic insight about AI crawlers, AI referrals or errors, as a suggestion. "All good" notes are skipped. */
export function fromInsight(i: Insight, domain: string): Suggestion | null {
  if (i.level === "good" || i.area === "people" && !i.id.startsWith("people-ai")) return null;
  const kind: OpportunityKind = i.area === "errors" || i.id === "ai-missing-crawlers" || i.id === "ai-bing" || i.id === "ai-stopped" ? "technical" : "update";
  return {
    id: `traffic-${i.id}`,
    source: "traffic",
    kind,
    priority: PRIORITY[i.level],
    title: i.title,
    why: i.why,
    steps: i.steps,
    prompts: [],
    targets: [
      ...(i.paths ?? []).map((p) => ({ label: `${p.path} (${p.note})`, url: `https://${domain}${p.path === "/" ? "" : p.path}` })),
      ...(i.action ? [{ label: i.action.label, url: i.action.href.startsWith("/") ? undefined : i.action.href }] : []),
    ],
  };
}

const engineLabel = (e: AiEngine) => AI_ENGINES.find((x) => x.id === e)?.label ?? e;

/** A simulation's score gaps on one prompt and engine, as one suggestion to improve your page. */
export function fromSimulation(s: Simulation): Suggestion | null {
  const gaps = [...s.gaps].sort((a, b) => b.them - b.you - (a.them - a.you));
  const llmChanges = s.llm && "changes" in s.llm ? s.llm.changes : [];
  if (!s.you && !gaps.length) return null;
  const best = s.cited.length ? Math.max(...s.cited.map((c) => c.total)) : null;
  const mine = s.you?.total ?? 0;
  if (s.you && !gaps.length && !llmChanges.length && (best == null || mine >= best)) return null;
  const type = PROMPT_TYPES[s.type]?.label ?? "Prompt";
  return {
    id: `sim-${s.engine}`,
    source: "simulation",
    kind: s.you ? "update" : "create",
    priority: !s.you || (best != null && best - mine >= 20) ? "high" : gaps.length >= 3 ? "medium" : "low",
    title: s.you ? `Make ${pathOf(s.you.url)} the best answer to “${s.prompt}”` : `Publish a page that answers “${s.prompt}”`,
    why: s.you
      ? `${engineLabel(s.engine)} simulation (${type}): your page scores ${mine}/100${best != null ? ` against ${best} for the best cited page` : ""}.${gaps.length ? ` Biggest gaps: ${gaps.slice(0, 3).map((g) => FACTORS[g.factor].label.toLowerCase()).join(", ")}.` : ""}`
      : `${engineLabel(s.engine)} simulation (${type}): none of your pages answers this prompt, so there's nothing for the engine to cite.`,
    steps: [...gaps.map((g) => g.fix), ...llmChanges.map((c) => `${c.what} (${c.why})`), ...s.notes].slice(0, 8),
    prompts: [s.prompt],
    targets: [...(s.you ? [{ label: `Your page: ${s.you.url}`, url: s.you.url }] : []), ...s.cited.slice(0, 5).map((c) => ({ label: `Cited: ${c.title || c.url} (${c.total}/100)`, url: c.url }))],
  };
}

const pathOf = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname === "/" ? x.hostname.replace(/^www\./, "") : x.pathname;
  } catch {
    return u;
  }
};

/** A Search Console opportunity (loosely typed: the endpoint owns the shape). */
export interface GscOpportunity {
  id: string;
  kind: string;
  title: string;
  why: string;
  steps: string[];
  query?: string;
  page?: string;
  impressions?: number;
  clicks?: number;
  position?: number;
  gain?: number | null;
  estGain?: number | null;
  estClicks?: number | null;
}

export function fromGsc(o: GscOpportunity, days: number): Suggestion {
  const gain = o.gain ?? o.estGain ?? o.estClicks ?? null;
  const kind: OpportunityKind = /cannibal/i.test(o.kind) ? "update" : /question|ai|answer/i.test(o.kind) ? "create" : "update";
  return {
    id: `gsc-${o.id}`,
    source: "search-console",
    kind,
    priority: gain != null && gain >= 50 ? "high" : gain != null && gain >= 10 ? "medium" : /declin/i.test(o.kind) ? "medium" : "low",
    title: o.title,
    why: o.why,
    steps: o.steps,
    prompts: o.query ? [o.query] : [],
    targets: o.page ? [{ label: o.page, url: o.page }] : [],
    estimate: gain ? `+${Math.round(gain)} clicks / ${days} days` : undefined,
  };
}

// ------------------------------------------------------------ simulations

export interface SavedSimulation extends Simulation {
  at: string;
}

const SIMS = (projectId: string) => `metainfo:aeo-sims:${projectId}`;
const MAX_SIMS = 60;

export function loadSims(projectId: string): SavedSimulation[] {
  try {
    const xs: SavedSimulation[] = JSON.parse(localStorage.getItem(SIMS(projectId)) ?? "[]");
    if (!Array.isArray(xs)) return [];
    // A merge with another device can bring two of the same prompt and engine: keep the newest.
    const latest = new Map<string, SavedSimulation>();
    for (const x of [...xs].sort((a, b) => a.at.localeCompare(b.at))) latest.set(`${x.engine}|${x.prompt}`, x);
    return [...latest.values()];
  } catch {
    return [];
  }
}

/** Keep the latest simulation per prompt and engine. */
export function saveSim(projectId: string, sim: Simulation): SavedSimulation[] {
  const rest = loadSims(projectId).filter((s) => !(s.prompt === sim.prompt && s.engine === sim.engine));
  // The written answer is long and only useful on screen; keep the verdict and changes.
  const llm = sim.llm && "changes" in sim.llm ? { ...sim.llm, suggestedAnswer: "" } : sim.llm;
  const kept = [...rest, { ...sim, llm, at: new Date().toISOString() }].slice(-MAX_SIMS);
  try {
    setLocal(SIMS(projectId), JSON.stringify(kept));
  } catch {
    /* storage full */
  }
  return kept;
}
