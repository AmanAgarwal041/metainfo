"use client";

// AI visibility: is the brand mentioned or cited when people ask AI engines
// the questions that matter? Answers are matched in code (no LLM judge):
// "mentioned" = the brand name or domain appears as a whole word in the
// answer (URLs masked); "cited" = a source URL is on the brand's domain.

import type { AiAnswer, AiEngine } from "@/lib/research-types";

export interface Match {
  mentioned: boolean;
  cited: boolean;
}

export interface Observation {
  prompt: string;
  engine: AiEngine;
  model: string;
  answered: boolean;
  error?: string;
  you: Match;
  competitors: Record<string, Match>;
  sources: { url: string; domain: string; title: string }[];
  excerpt: string;
}

export interface AiRun {
  id: string;
  at: string;
  cost: number;
  observations: Observation[];
}

const KEY = (projectId: string) => `metainfo:ai-runs:${projectId}`;
const MAX_RUNS = 40;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function wordRe(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "iu");
}

/** Match a brand (name + domain) against an answer and its sources. */
export function matchBrand(answer: Pick<AiAnswer, "text" | "sources">, brand: string, domain: string): Match {
  const masked = answer.text.replace(/https?:\/\/\S+/g, " ").replace(/\S+@\S+\.\S+/g, " ");
  const terms = [brand, domain].map((t) => t.trim()).filter((t) => t.length >= 2);
  const mentioned = terms.some((t) => wordRe(t).test(masked));
  const d = domain.toLowerCase();
  const cited = !!d && answer.sources.some((s) => s.domain === d || s.domain.endsWith(`.${d}`));
  // A citation in an AI Overview (no answer text) also counts as a mention.
  return { mentioned: mentioned || (cited && !answer.text), cited };
}

export function brandOf(domain: string): string {
  const label = domain.split(".")[0] ?? "";
  return label ? label[0].toUpperCase() + label.slice(1) : "";
}

export function loadRuns(projectId: string): AiRun[] {
  try {
    return JSON.parse(localStorage.getItem(KEY(projectId)) ?? "[]");
  } catch {
    return [];
  }
}

export function saveRun(projectId: string, run: AiRun): AiRun[] {
  const runs = [...loadRuns(projectId), run].slice(-MAX_RUNS);
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify(runs));
  } catch {
    /* storage full: keep in memory for this view */
  }
  return runs;
}

export interface Rates {
  answered: number;
  mentionRate: number;
  citationRate: number;
}

/** Rates over answered observations only; failed or empty answers are not counted as absence. */
export function rates(obs: Observation[], who: (o: Observation) => Match | undefined = (o) => o.you): Rates {
  const answered = obs.filter((o) => o.answered && !o.error);
  const m = answered.filter((o) => who(o)?.mentioned).length;
  const c = answered.filter((o) => who(o)?.cited).length;
  return {
    answered: answered.length,
    mentionRate: answered.length ? Math.round((m / answered.length) * 100) : 0,
    citationRate: answered.length ? Math.round((c / answered.length) * 100) : 0,
  };
}

export function topSources(obs: Observation[], limit = 15): { domain: string; answers: number; prompts: number }[] {
  const by = new Map<string, { answers: Set<string>; prompts: Set<string> }>();
  for (const o of obs) {
    for (const s of new Set(o.sources.map((x) => x.domain))) {
      const e = by.get(s) ?? { answers: new Set(), prompts: new Set() };
      e.answers.add(`${o.engine}|${o.prompt}`);
      e.prompts.add(o.prompt);
      by.set(s, e);
    }
  }
  return [...by.entries()]
    .map(([domain, e]) => ({ domain, answers: e.answers.size, prompts: e.prompts.size }))
    .sort((a, b) => b.answers - a.answers)
    .slice(0, limit);
}

/** Starter prompts from a project's keywords, brand and competitors. */
export function suggestPrompts(keywords: string[], brand: string, competitors: string[]): string[] {
  const out: string[] = [];
  for (const k of keywords.slice(0, 6)) {
    out.push(`What is the best ${k}?`, `Which ${k} should I use?`);
  }
  for (const c of competitors.slice(0, 3)) {
    const name = brandOf(c);
    if (brand && name) out.push(`${brand} vs ${name}: which is better?`, `What are the best alternatives to ${name}?`);
  }
  if (brand) out.push(`What is ${brand}?`, `Is ${brand} any good?`);
  return [...new Set(out)];
}
