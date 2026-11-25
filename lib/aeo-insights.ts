// AEO dashboard insights: what kind of page each cited URL is, per-URL citation rows, and per-run series (citation
// rate and mention rate per brand, citation mix by content type and channel) for the Dashboard, Citations and
// Impact views. Pure functions over stored answers; no requests.

import { classifyPrompt, metricsFor, ownerOf, PROMPT_TYPES, SOURCE_TYPES, classifySource, type Answer, type Brand, type PromptType, type SourceType } from "@/lib/aeo";
import { cleanUrl, type RunAnswers } from "@/lib/aeo-actions";
import type { AiEngine } from "@/lib/research-types";

export type ContentType = "listicle" | "comparison" | "guide" | "docs" | "pricing" | "product" | "review" | "discussion" | "social" | "video" | "repo" | "news" | "homepage" | "article" | "other";

export const CONTENT_TYPES: Record<ContentType, { label: string; color: string }> = {
  listicle: { label: "Listicle", color: "var(--series-1)" },
  comparison: { label: "Comparison", color: "var(--series-2)" },
  guide: { label: "Guide / how-to", color: "var(--series-3)" },
  docs: { label: "Docs", color: "var(--series-4)" },
  product: { label: "Product page", color: "var(--series-5)" },
  pricing: { label: "Pricing", color: "var(--series-6)" },
  review: { label: "Review", color: "var(--series-7)" },
  discussion: { label: "Discussion", color: "oklch(0.6 0.12 200)" },
  social: { label: "Social post", color: "oklch(0.6 0.13 240)" },
  video: { label: "Video", color: "oklch(0.58 0.17 15)" },
  repo: { label: "Code repository", color: "oklch(0.5 0.03 260)" },
  news: { label: "News", color: "oklch(0.62 0.1 120)" },
  homepage: { label: "Homepage", color: "oklch(0.55 0.13 300)" },
  article: { label: "Article / blog", color: "oklch(0.68 0.09 60)" },
  other: { label: "Other", color: "var(--text-3)" },
};

/** Channel colors in a fixed order: you, competitors, then the rest. */
export const CHANNEL_COLOR: Record<SourceType, string> = {
  you: "var(--accent)",
  competitor: "var(--fail)",
  forum: "var(--series-3)",
  review: "var(--series-7)",
  video: "var(--series-5)",
  social: "var(--series-1)",
  reference: "var(--series-4)",
  news: "var(--series-6)",
  blog: "var(--series-2)",
  other: "var(--text-3)",
};

const VIDEO = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|loom\.com|tiktok\.com)$/;
const DISCUSSION = /(^|\.)(reddit\.com|quora\.com|stackoverflow\.com|stackexchange\.com|news\.ycombinator\.com|discord\.com)$|^(community|forum|discuss)\./;
const SOCIAL_HOSTS = /(^|\.)(linkedin\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|threads\.net|bsky\.app|mastodon\.social)$/;
const REPO = /(^|\.)(github\.com|gitlab\.com|bitbucket\.org)$/;
const REVIEWS = /(^|\.)(g2\.com|capterra\.com|trustradius\.com|getapp\.com|softwareadvice\.com|trustpilot\.com|peerspot\.com)$/;

/** What kind of page a cited URL is, from its host, path and title. */
export function contentTypeOf(url: string, title = ""): ContentType {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase().replace(/^www\./, "");
    path = decodeURIComponent(u.pathname).toLowerCase();
  } catch {
    return "other";
  }
  const t = `${title} ${path.replace(/[-_/]+/g, " ")}`.toLowerCase();
  if (VIDEO.test(host)) return "video";
  if (DISCUSSION.test(host)) return "discussion";
  if (SOCIAL_HOSTS.test(host)) return "social";
  if (REPO.test(host)) return "repo";
  if (REVIEWS.test(host) || /\breviews?\b/.test(t)) return "review";
  if (/\b(vs\.?|versus|compared?|comparison)\b/.test(t)) return "comparison";
  if (/\b(best|top \d+|\d+ (best|top)|alternatives?|tools for|leading)\b/.test(t)) return "listicle";
  if (/\bpricing\b|\bplans\b|\bcost\b/.test(t)) return "pricing";
  if (/^docs\.|^developers?\./.test(host) || /^\/(docs?|documentation|reference|api|sdk)(\/|$)/.test(path)) return "docs";
  if (/\b(how to|how do|guide|tutorial|what is|what are|learn|explained|introduction to|getting started)\b/.test(t)) return "guide";
  if (/^\/(news|press)(\/|$)/.test(path) || /\b(announces|launches|raises)\b/.test(t)) return "news";
  if (/^\/(product|products|features|platform|solutions|integrations?)(\/|$)/.test(path)) return "product";
  if (path === "/" || path === "") return "homepage";
  if (/^\/(blog|articles?|posts?|insights|resources)(\/|$)/.test(path) || /^blog\./.test(host)) return "article";
  return "other";
}

const ok = (a: Answer) => a.answered && !a.error;
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");

export interface UrlRow {
  url: string;
  domain: string;
  title: string;
  channel: SourceType;
  content: ContentType;
  /** Answers citing the page. */
  citations: number;
  prompts: string[];
  engines: AiEngine[];
  /** Of those answers, how many name you. */
  withYou: number;
  /** Competitor domains named in answers that cite the page. */
  competitors: string[];
}

/** Every cited page, most cited first. */
export function urlTable(answers: Answer[], brands: Brand[]): UrlRow[] {
  const you = brands[0]?.domain ?? "";
  const comps = brands.slice(1).map((b) => b.domain);
  const rows = new Map<string, UrlRow>();
  const seen = new Map<string, Set<string>>();
  for (const a of answers.filter(ok)) {
    const key = `${a.engine}|${a.prompt}`;
    const named = new Set((a.brands ?? []).filter((b) => b.mentioned && !b.subject).map((b) => b.domain));
    for (const s of a.sources) {
      const url = cleanUrl(s.url);
      const r =
        rows.get(url) ??
        {
          url,
          domain: bare(s.domain),
          title: s.title,
          channel: classifySource(bare(s.domain), you, comps, ownerOf(s.url, s.domain, brands)),
          content: contentTypeOf(s.url, s.title),
          citations: 0,
          prompts: [],
          engines: [],
          withYou: 0,
          competitors: [],
        };
      const keys = seen.get(url) ?? new Set<string>();
      if (keys.has(key)) continue;
      keys.add(key);
      seen.set(url, keys);
      r.citations++;
      if (!r.title && s.title) r.title = s.title;
      if (!r.prompts.includes(a.prompt)) r.prompts.push(a.prompt);
      if (!r.engines.includes(a.engine)) r.engines.push(a.engine);
      if (named.has(you)) r.withYou++;
      for (const c of comps) if (named.has(c) && !r.competitors.includes(c)) r.competitors.push(c);
      rows.set(url, r);
    }
  }
  return [...rows.values()].sort((a, b) => b.citations - a.citations || a.url.localeCompare(b.url));
}

/** Citations (one per page per answer) by content type and by channel. */
export function composition(answers: Answer[], brands: Brand[]): { content: Partial<Record<ContentType, number>>; channel: Partial<Record<SourceType, number>>; total: number } {
  const content: Partial<Record<ContentType, number>> = {};
  const channel: Partial<Record<SourceType, number>> = {};
  let total = 0;
  for (const r of urlTable(answers, brands)) {
    content[r.content] = (content[r.content] ?? 0) + r.citations;
    channel[r.channel] = (channel[r.channel] ?? 0) + r.citations;
    total += r.citations;
  }
  return { content, channel, total };
}

/** Of the answers that cite at least one page, the share naming the brand, %. */
export function mentionRateWhenCited(answers: Answer[], domain: string): number | null {
  const cited = answers.filter((a) => ok(a) && a.sources.length);
  if (!cited.length) return null;
  return Math.round((cited.filter((a) => a.brands?.some((b) => b.domain === domain && b.mentioned)).length / cited.length) * 100);
}

// ---------------------------------------------------------------- prompts

export interface PromptRow {
  prompt: string;
  type: PromptType;
  /** % of this prompt's answers naming you, latest run. */
  visibility: number;
  /** Points vs the previous run; null if the prompt wasn't in it. */
  change: number | null;
  cited: boolean;
  answered: number;
  /** Brand named first most often when you're absent or behind. */
  leader: string | null;
}

export function promptRows(latest: Answer[], previous: Answer[], brands: Brand[], brand: string): PromptRow[] {
  const you = brands[0]?.domain ?? "";
  const prompts = [...new Set(latest.map((a) => a.prompt))];
  return prompts.map((p) => {
    const now = latest.filter((a) => a.prompt === p);
    const before = previous.filter((a) => a.prompt === p);
    const m = metricsFor(now, you);
    const b = before.some(ok) ? metricsFor(before, you) : null;
    const firsts = new Map<string, number>();
    for (const a of now.filter(ok)) {
      const top = (a.brands ?? []).filter((x) => x.mentioned && !x.subject && x.position != null).sort((x, y) => x.position! - y.position!)[0];
      if (top) firsts.set(top.domain, (firsts.get(top.domain) ?? 0) + 1);
    }
    const leader = [...firsts].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    return { prompt: p, type: classifyPrompt(p, brand), visibility: m.visibility, change: b ? m.visibility - b.visibility : null, cited: m.citationRate > 0, answered: m.answered, leader };
  });
}

/** Per engine, across every run that asked the prompt: in how many answers you were named. */
export function engineTally(prompt: string, runs: RunAnswers[], you: string): { engine: AiEngine; named: number; answered: number }[] {
  const by = new Map<AiEngine, { named: number; answered: number }>();
  for (const r of runs) {
    for (const a of r.answers) {
      if (a.prompt !== prompt || !ok(a)) continue;
      const e = by.get(a.engine) ?? { named: 0, answered: 0 };
      e.answered++;
      if (a.brands?.some((b) => b.domain === you && b.mentioned)) e.named++;
      by.set(a.engine, e);
    }
  }
  return [...by].map(([engine, x]) => ({ engine, ...x }));
}

/** Visibility tone for a 0-100 share. */
export const visTone = (v: number) => (v >= 60 ? "var(--pass)" : v >= 25 ? "var(--warn)" : "var(--fail)");

export const promptTypeLabel = (t: PromptType) => PROMPT_TYPES[t].label;
export const channelLabel = (t: SourceType) => (t === "you" ? "Owned" : SOURCE_TYPES[t].label);
export { metricsFor };

/** The runs' x labels and a value per run. */
export function perRun<T>(runs: RunAnswers[], f: (answers: Answer[]) => T): T[] {
  return runs.map((r) => f(r.answers));
}
