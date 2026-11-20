import type { FactorId, Opportunity } from "./aeo";
import { FACTORS } from "./aeo";
import type { SiteFinding, TemplateIssue } from "./site-audit";
import type { Insight } from "./traffic-insights";
import type { Check } from "./types";

// Prompts for coding and writing assistants (Claude Code, Cursor, Copilot, ChatGPT) that apply MetaInfo's fixes.
// One prompt per fix, or one prompt for several. Kept short on purpose: what's wrong, what to change, where,
// and how to check, with long text clipped and examples capped, so the assistant's context goes on the code.

/** Where the change happens, which decides the instruction the assistant gets. */
export type FixKind =
  /** Markup, templates, headers, server or CDN config: done in the codebase. */
  | "code"
  /** Words on a page: the assistant drafts, using only facts the site already states. */
  | "content"
  /** Outside the site (listings, reviews, other sites): the assistant drafts and plans, never posts. */
  | "offsite";

export interface Fix {
  id: string;
  title: string;
  kind: FixKind;
  /** What's wrong now, in a line. */
  problem?: string;
  /** What to change: a sentence or ordered steps. */
  change: string | string[];
  /** Pages or paths to change. */
  where?: string[];
  /** Example code. */
  snippet?: string;
  /** How to check it worked. */
  verify?: string;
}

export interface PromptContext {
  /** The site or page the fixes are for, e.g. https://example.com/pricing. */
  site: string;
  /** Which MetaInfo report found them, e.g. "page audit". */
  source: string;
}

/** Beyond this, a collated prompt keeps the first fixes (they're listed by priority) and says how many it left out. */
export const MAX_FIXES = 15;
const TEXT = 220;
const STEP = 160;
const STEPS = 4;
const PAGES = 5;
const SNIPPET = 700;
const SNIPPET_COLLATED = 400;
const SNIPPETS_COLLATED = 3;

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

function clipBlock(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return `${cut.slice(0, Math.max(cut.lastIndexOf("\n"), n * 0.6)).trimEnd()}\n…`;
}

function changeLines(change: Fix["change"], indent: string): string[] {
  if (typeof change === "string") return [`${indent}Do: ${clip(change, TEXT)}`];
  const steps = change.filter(Boolean);
  if (steps.length === 1) return [`${indent}Do: ${clip(steps[0], TEXT)}`];
  return [`${indent}Do:`, ...steps.slice(0, STEPS).map((s, i) => `${indent}  ${i + 1}. ${clip(s, STEP)}`)];
}

function whereLine(where: string[] | undefined, indent: string): string[] {
  const w = [...new Set(where?.filter(Boolean) ?? [])];
  if (!w.length) return [];
  const more = w.length > PAGES ? `, and ${w.length - PAGES} more` : "";
  return [`${indent}Pages: ${w.slice(0, PAGES).join(", ")}${more}`];
}

const RULES: Record<FixKind, string> = {
  code: "Find where it's produced in the codebase (a shared layout or component first, then the page, then server or CDN config) and make the smallest change that fixes it. Leave everything else as it is.",
  content: "Edit the page's copy. Use only facts the site already states; mark anything you'd need to confirm with [CHECK]. Keep the page's voice.",
  offsite: "This is outside the codebase. Draft the text and a short checklist for me to act on. Don't post or submit anything.",
};

const fence = (code: string) => {
  const ticks = code.includes("```") ? "````" : "```";
  return [ticks, code, ticks];
};

/** A prompt for one fix. */
export function fixPrompt(fix: Fix, ctx: PromptContext): string {
  const lines = [`Fix on ${ctx.site} (found by a MetaInfo ${ctx.source}): ${fix.title}.`, ""];
  if (fix.problem) lines.push(`Now: ${clip(fix.problem, TEXT)}`);
  lines.push(...changeLines(fix.change, ""), ...whereLine(fix.where, ""));
  if (fix.snippet) lines.push("", "Example:", ...fence(clipBlock(fix.snippet, SNIPPET)));
  lines.push("", RULES[fix.kind]);
  if (fix.verify) lines.push(`Done when: ${clip(fix.verify, TEXT)}`);
  return lines.join("\n");
}

/** One prompt for several fixes, numbered so the assistant can report back on each. */
export function fixesPrompt(fixes: Fix[], ctx: PromptContext): string {
  if (fixes.length === 1) return fixPrompt(fixes[0], ctx);
  const list = fixes.slice(0, MAX_FIXES);
  const left = fixes.length - list.length;
  const lines = [`Fix these ${list.length} issues on ${ctx.site}, found by a MetaInfo ${ctx.source}. They're in priority order.`, ""];
  list.forEach((f, i) => {
    lines.push(`${i + 1}. ${f.title}${list.some((x) => x.kind !== f.kind) || f.kind !== "code" ? ` [${f.kind}]` : ""}`);
    if (f.problem) lines.push(`   Now: ${clip(f.problem, TEXT)}`);
    lines.push(...changeLines(f.change, "   "), ...whereLine(f.where, "   "));
    if (f.verify && list.filter((x) => x.verify === f.verify).length === 1) lines.push(`   Done when: ${clip(f.verify, STEP)}`);
  });
  // A check shared by several fixes is said once.
  const shared = new Map<string, number[]>();
  list.forEach((f, i) => f.verify && list.filter((x) => x.verify === f.verify).length > 1 && shared.set(f.verify, [...(shared.get(f.verify) ?? []), i + 1]));
  if (left > 0) lines.push("", `(${left} lower-priority fixes left out to keep this short.)`);

  const examples = list.map((f, i) => ({ n: i + 1, s: f.snippet })).filter((x): x is { n: number; s: string } => !!x.s).slice(0, SNIPPETS_COLLATED);
  for (const x of examples) lines.push("", `Example for ${x.n}:`, ...fence(clipBlock(x.s, SNIPPET_COLLATED)));

  if (shared.size) lines.push("", ...[...shared].map(([v, ns]) => `Done when (${ns.length === list.length ? "all" : ns.join(", ")}): ${clip(v, STEP)}`));

  const kinds = [...new Set(list.map((f) => f.kind))];
  lines.push("", kinds.length === 1 ? RULES[kinds[0]] : kinds.map((k) => `[${k}] ${RULES[k]}`).join("\n"));
  if (kinds.includes("code")) lines.push("Several fixes may share one cause (a layout, a header, a config): fix it once there.");
  lines.push("When done, list each number with what you changed, or why you couldn't.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- from each report's fixes


/** A page-audit check (Issues, Plan). */
export function fromCheck(c: Check): Fix {
  return {
    id: c.id,
    title: c.title,
    kind: c.category === "content" ? "content" : "code",
    problem: c.finding,
    change: c.recommendation || c.why,
    snippet: c.snippet,
    verify: "the page passes this check when scanned again in MetaInfo.",
  };
}

/** A site-audit finding: one problem across many pages. */
export function fromSiteFinding(f: SiteFinding): Fix {
  return { id: f.id, title: f.title, kind: "code", problem: f.detail, change: f.fix, where: f.pages.map((p) => p.url) };
}

/** A check that fails on most pages: almost always one shared layout. */
export function fromTemplateIssue(t: TemplateIssue): Fix {
  return {
    id: `template:${t.checkId}`,
    title: t.title,
    kind: "code",
    problem: `Fails on ${Math.round(t.share * 100)}% of pages (${t.count}), so it's likely in a shared layout or component.`,
    change: t.recommendation,
  };
}

const INSIGHT_KIND: Record<string, FixKind> = {
  "ai-uncited-pages": "content",
  "people-ai-landings": "content",
  "ai-bing": "offsite",
  "people-low-search": "offsite",
};

/** A Traffic "What to improve" item. */
export function fromInsight(i: Insight): Fix {
  return {
    id: i.id,
    title: i.title,
    kind: INSIGHT_KIND[i.id] ?? "code",
    problem: i.why,
    change: i.steps,
    where: i.paths?.map((p) => p.path),
  };
}

const OPP_KIND: Record<Opportunity["kind"], FixKind> = { create: "content", update: "content", technical: "code", outreach: "offsite", community: "offsite", reputation: "offsite" };

/** An AEO opportunity. */
export function fromOpportunity(o: Opportunity): Fix {
  const prompts = o.prompts.slice(0, 3).map((p) => `“${p}”`).join(", ");
  return {
    id: o.id,
    title: o.title,
    kind: OPP_KIND[o.kind],
    problem: o.why,
    change: o.steps,
    where: o.targets.map((t) => t.url ?? t.label),
    verify: prompts ? `AI assistants name the brand for ${prompts}.` : undefined,
  };
}

const GAP_KIND: Partial<Record<FactorId, FixKind>> = { access: "code", schema: "code", freshness: "code" };

/** A gap from "Simulate agents": a factor where your page trails the pages the engine cited. */
export function fromGap(g: { factor: FactorId; you: number; them: number; fix: string }): Fix {
  const f = FACTORS[g.factor];
  return {
    id: `gap:${g.factor}`,
    title: f.label,
    kind: GAP_KIND[g.factor] ?? "content",
    problem: g.them > 0 ? `Scores ${g.you}/100; the pages the engine cited score ${g.them}. ${f.tip}` : `Scores ${g.you}/100. ${f.tip}`,
    change: g.fix,
  };
}
