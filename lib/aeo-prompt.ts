// One prompt, every engine: does the answer name you, where, which sources it cites, who it puts ahead of you,
// and what to do about it. Named → how to rank higher and become the cited source. Not named → how to get into
// the answer. Pure functions over stored answers, so the browser and tests can both run them.

import {
  classifyPrompt,
  classifySource,
  ownerOf,
  ENGINE_LABEL,
  ENGINE_NOTES,
  ENGINE_STEPS,
  nameOf,
  PAGE_FOR,
  PROMPT_TYPES,
  SOURCE_TYPES,
  type Answer,
  type Brand,
  type BrandResult,
  type Opportunity,
  type PromptType,
  type Sentiment,
  type SourceType,
} from "./aeo";
import type { AiEngine } from "./research-types";

/** leading: named first (or as the subject) in every answer, and cited. behind: named in some answers, or not first. */
export type PromptStatus = "leading" | "behind" | "absent" | "no-data";

export const PROMPT_STATUS: Record<PromptStatus, { label: string; cls: string }> = {
  leading: { label: "Leading", cls: "gain" },
  behind: { label: "Named, not leading", cls: "accent" },
  absent: { label: "Not named", cls: "sev-critical" },
  "no-data": { label: "No answers", cls: "" },
};

export type EngineState = "cited" | "named" | "absent" | "no-answer";

export interface EngineRow {
  engine: AiEngine;
  state: EngineState;
  /** Your place among the brands the answer names; null when absent or when the prompt names you. */
  position: number | null;
  sentiment: Sentiment | null;
  quote: string;
  /** Tracked competitors named before you (all of those named, when you're absent). */
  ahead: string[];
  sources: number;
  /** The same engine in the previous run, when there is one. */
  before?: { state: EngineState; position: number | null };
}

export interface PromptSource {
  url: string;
  title: string;
  domain: string;
  type: SourceType;
  engines: AiEngine[];
  /** Tracked brands the citing answers name; "you" is brands[0]'s domain. */
  names: string[];
}

export interface Rival {
  domain: string;
  /** Answers that name it. */
  named: number;
  /** Answers where it's named before you, or named while you're absent. */
  ahead: number;
  bestPosition: number | null;
  cited: number;
}

export interface PromptReport {
  prompt: string;
  type: PromptType;
  status: PromptStatus;
  summary: string;
  answered: number;
  named: number;
  cited: number;
  avgPosition: number | null;
  engines: EngineRow[];
  rivals: Rival[];
  sources: PromptSource[];
  /** What to do, most impactful first. Same shape as the run's opportunities, so fix prompts work on it. */
  plan: Opportunity[];
}

const ok = (a: Answer) => a.answered && !a.error;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const engineNames = (es: AiEngine[]) => list(es.map((e) => ENGINE_LABEL[e]));

function stateOf(a: Answer | undefined, you: string): { state: EngineState; me?: BrandResult } {
  if (!a || !ok(a)) return { state: "no-answer" };
  const me = a.brands?.find((b) => b.domain === you);
  if (me?.cited) return { state: "cited", me };
  if (me?.mentioned) return { state: "named", me };
  return { state: "absent", me };
}

/** Everything about one prompt across engines. `previous` is the prior run's answers, for what changed. */
export function promptReport(prompt: string, answers: Answer[], brands: Brand[], brand: string, previous: Answer[] = []): PromptReport {
  const you = brands[0]?.domain ?? "";
  const comps = brands.slice(1).map((b) => b.domain);
  const type = classifyPrompt(prompt, brand);
  const mine = answers.filter((a) => a.prompt === prompt);
  const done = mine.filter(ok);

  const engines: EngineRow[] = mine.map((a) => {
    const { state, me } = stateOf(a, you);
    const named = (a.brands ?? []).filter((b) => b.domain !== you && b.mentioned && !b.subject);
    const ahead = named.filter((b) => state === "absent" || (me?.position != null && b.position != null && b.position < me.position)).sort((x, y) => (x.position ?? 99) - (y.position ?? 99)).map((b) => b.domain);
    const prev = previous.find((p) => p.prompt === prompt && p.engine === a.engine);
    const was = prev ? stateOf(prev, you) : null;
    return {
      engine: a.engine,
      state,
      position: me?.position ?? null,
      sentiment: me?.sentiment ?? null,
      quote: me?.quote ?? "",
      ahead,
      sources: a.sources.length,
      before: was ? { state: was.state, position: was.me?.position ?? null } : undefined,
    };
  });

  const answeredRows = engines.filter((e) => e.state !== "no-answer");
  const namedRows = answeredRows.filter((e) => e.state !== "absent");
  const citedRows = answeredRows.filter((e) => e.state === "cited");
  const positions = namedRows.map((e) => e.position).filter((p): p is number => p != null);
  const avgPosition = positions.length ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10 : null;

  // Competitors in this prompt's answers.
  const rivals: Rival[] = comps
    .map((d) => {
      let named = 0, ahead = 0, cited = 0, best: number | null = null;
      for (const a of done) {
        const r = a.brands?.find((b) => b.domain === d);
        if (r?.cited) cited++;
        if (!r?.mentioned || r.subject) continue;
        named++;
        if (r.position != null && (best == null || r.position < best)) best = r.position;
        if (engines.find((e) => e.engine === a.engine)?.ahead.includes(d)) ahead++;
      }
      return { domain: d, named, ahead, bestPosition: best, cited };
    })
    .filter((r) => r.named || r.cited)
    .sort((a, b) => b.ahead - a.ahead || b.named - a.named);

  // Every cited page, with the engines that cite it and the brands those answers name.
  const byUrl = new Map<string, PromptSource>();
  for (const a of done) {
    const names = (a.brands ?? []).filter((b) => b.mentioned && !b.subject).map((b) => b.domain);
    for (const s of a.sources) {
      const e = byUrl.get(s.url) ?? { url: s.url, title: s.title, domain: s.domain, type: classifySource(s.domain, you, comps, ownerOf(s.url, s.domain, brands)), engines: [], names: [] };
      if (!e.engines.includes(a.engine)) e.engines.push(a.engine);
      for (const n of names) if (!e.names.includes(n)) e.names.push(n);
      byUrl.set(s.url, e);
    }
  }
  const sources = [...byUrl.values()].sort((a, b) => b.engines.length - a.engines.length || Number(b.names.some((n) => n !== you)) - Number(a.names.some((n) => n !== you)));

  const status: PromptStatus = !answeredRows.length
    ? "no-data"
    : !namedRows.length
      ? "absent"
      : namedRows.length === answeredRows.length && namedRows.every((e) => e.position == null || e.position === 1) && citedRows.length > 0
        ? "leading"
        : "behind";

  const topRivals = rivals.filter((r) => r.ahead).slice(0, 3).map((r) => nameOf(r.domain));
  const summary =
    status === "no-data"
      ? "No engine answered this prompt in the last run."
      : status === "absent"
        ? `Not named by ${answeredRows.length === 1 ? ENGINE_LABEL[answeredRows[0].engine] : `any of ${answeredRows.length} engines`}.${topRivals.length ? ` They recommend ${list(topRivals)} instead.` : rivals.length ? "" : " None of your tracked competitors are named either."}`
        : `Named by ${namedRows.length} of ${plural(answeredRows.length, "engine")}${avgPosition != null ? `, average position #${avgPosition}` : ""}; your site is cited by ${citedRows.length}.${topRivals.length ? ` ${list(topRivals)} ${topRivals.length === 1 ? "is" : "are"} ahead of you in some answers.` : ""}`;

  return {
    prompt,
    type,
    status,
    summary,
    answered: answeredRows.length,
    named: namedRows.length,
    cited: citedRows.length,
    avgPosition,
    engines,
    rivals,
    sources,
    plan: planFor({ prompt, type, status, engines, rivals, sources, you, comps }),
  };
}

function planFor(r: { prompt: string; type: PromptType; status: PromptStatus; engines: EngineRow[]; rivals: Rival[]; sources: PromptSource[]; you: string; comps: string[] }): Opportunity[] {
  const { prompt, type, status, engines, rivals, sources, you } = r;
  if (status === "no-data") return [];
  const out: Opportunity[] = [];
  const prompts = [prompt];
  const answered = engines.filter((e) => e.state !== "no-answer");
  const absentOn = answered.filter((e) => e.state === "absent").map((e) => e.engine);
  const namedOn = answered.filter((e) => e.state !== "absent").map((e) => e.engine);
  const yourPages = sources.filter((s) => s.type === "you");
  const rivalNames = rivals.slice(0, 3).map((x) => nameOf(x.domain));

  // Third-party pages cited in answers that name a competitor and not you: get onto them.
  const thirdParty = sources.filter((s) => !["you", "competitor"].includes(s.type) && !s.names.includes(you));
  const withRivals = thirdParty.filter((s) => s.names.length > 0);
  const targets = (withRivals.length ? withRivals : thirdParty).slice(0, 6);
  if (targets.length) {
    const types = [...new Set(targets.map((s) => s.type))].filter((t) => SOURCE_TYPES[t].play);
    const community = targets.every((s) => s.type === "forum" || s.type === "social" || s.type === "video");
    out.push({
      id: "prompt-sources",
      kind: community ? "community" : "outreach",
      priority: status === "absent" ? "high" : "medium",
      title: status === "absent" ? "Get onto the pages engines cite for this prompt" : "Get onto the cited pages that leave you out",
      why: `${plural(targets.length, "page")} ${targets.length === 1 ? "is" : "are"} cited in answers that ${withRivals.length ? `name ${list([...new Set(withRivals.flatMap((s) => s.names))].map(nameOf).slice(0, 4))} but not you` : "leave you out"}. Engines build the answer from their sources, so getting onto these pages is the most direct way in.`,
      steps: [
        ...types.slice(0, 2).map((t) => `${SOURCE_TYPES[t].label}: ${SOURCE_TYPES[t].play}`),
        community ? "Answer the question the thread asks, with specifics; say you work on the product." : "Contact each author with what's new and why their readers would care: a feature, a free tier, data.",
        "Give them accurate facts to quote: a one-line description, pricing, a screenshot.",
      ],
      prompts,
      targets: targets.map((s) => ({ label: `${s.domain}: ${s.title || s.url}`, url: s.url })),
    });
  }

  // No page of yours is cited: publish or fix the page for this prompt.
  if (!yourPages.length) {
    const page = PAGE_FOR[type]?.(prompt, rivals.map((x) => x.domain));
    if (page) {
      const compPages = sources.filter((s) => s.type === "competitor").slice(0, 4);
      out.push({
        id: "prompt-page",
        kind: type === "brand" || type === "pricing" ? "update" : "create",
        priority: status === "absent" ? "high" : "medium",
        title: page.title,
        why: `No engine cites your site for “${prompt}”${compPages.length ? `, while it cites ${plural(compPages.length, "competitor page")}` : ""}. ${PROMPT_TYPES[type].hint}`,
        steps: [`Use the prompt's own words in the title and first heading, and answer it in the first 40–80 words.`, ...page.steps.slice(0, 2), "Run Simulate agents on this prompt to see what the cited pages have that yours doesn't."],
        prompts,
        targets: compPages.map((s) => ({ label: `${s.domain}: ${s.title || s.url}`, url: s.url })),
      });
    }
  }

  // Named on some engines, not on others.
  if (namedOn.length && absentOn.length) {
    out.push({
      id: "prompt-engines",
      kind: "technical",
      priority: "medium",
      title: `Show up on ${engineNames(absentOn)} too`,
      why: `${engineNames(namedOn)} ${namedOn.length === 1 ? "names" : "name"} you for this prompt; ${engineNames(absentOn)} ${absentOn.length === 1 ? "doesn't" : "don't"}. ${absentOn.map((e) => ENGINE_NOTES[e]).slice(0, 2).join(" ")}`,
      steps: [...new Set(absentOn.flatMap((e) => ENGINE_STEPS[e]))].slice(0, 4),
      prompts,
      targets: [],
    });
  }

  // Named, but after competitors.
  const behind = answered.filter((e) => e.state !== "absent" && e.position != null && e.position > 1);
  if (behind.length) {
    const ahead = [...new Set(behind.flatMap((e) => e.ahead))];
    const aheadSources = sources.filter((s) => s.type !== "you" && s.type !== "competitor" && s.names.some((n) => ahead.includes(n)) && !s.names.includes(you)).slice(0, 5);
    const worst = Math.max(...behind.map((e) => e.position ?? 0));
    out.push({
      id: "prompt-rank",
      kind: "update",
      priority: worst >= 3 ? "high" : "medium",
      title: "Move up in the answer",
      why: `You're #${behind.map((e) => e.position).join(", #")} on ${engineNames(behind.map((e) => e.engine))}, after ${list(ahead.map(nameOf))}. Engines order brands by how often, and how high, the sources they trust list them.`,
      steps: [
        `Say plainly who you're best for, in your title and first paragraph (“the best ${type === "discovery" ? "option" : "choice"} for …”), so engines can place you for this prompt.`,
        aheadSources.length ? `Ask the pages that list ${nameOf(ahead[0])} to rank you too (listed below).` : `Get into the list articles and roundups that rank ${nameOf(ahead[0] ?? "")} above you.`,
        type === "comparison" || type === "alternatives" || type === "discovery" ? `Publish an honest comparison with ${nameOf(ahead[0] ?? "")}: a verdict up top, a feature table, and when to pick which.` : "Collect reviews and case studies that back your claim with numbers.",
        "Re-run the check after changes are indexed (a few weeks) to see if you moved.",
      ],
      prompts,
      targets: aheadSources.map((s) => ({ label: `${s.domain}: ${s.title || s.url}`, url: s.url })),
    });
  }

  // Named, but the engine links someone else.
  const uncited = answered.filter((e) => e.state === "named" && e.sources > 0);
  if (uncited.length) {
    const instead = sources.filter((s) => s.type !== "you" && s.engines.some((e) => uncited.some((u) => u.engine === e))).slice(0, 5);
    out.push({
      id: "prompt-cite",
      kind: "update",
      priority: "medium",
      title: "Become the source the answer links",
      why: `${engineNames(uncited.map((e) => e.engine))} ${uncited.length === 1 ? "names" : "name"} you but ${uncited.length === 1 ? "cites" : "cite"} other pages for the facts. Citations send the clicks, and engines treat cited pages as the authority.`,
      steps: [
        "Open the cited pages below: what facts do they state that your page doesn't?",
        "Give your page those specifics: current numbers, a comparison table, a dated update.",
        "Make the answer quotable: a self-contained 40–80 word paragraph under a heading that matches the prompt.",
      ],
      prompts,
      targets: instead.map((s) => ({ label: `${s.domain}: ${s.title || s.url}`, url: s.url })),
    });
  }

  // Described with caveats.
  const neg = answered.filter((e) => e.sentiment === "negative" || e.sentiment === "mixed");
  if (neg.length) {
    out.push({
      id: "prompt-tone",
      kind: "reputation",
      priority: neg.some((e) => e.sentiment === "negative") ? "high" : "medium",
      title: "Fix how the answer describes you",
      why: `${engineNames(neg.map((e) => e.engine))} ${neg.length === 1 ? "describes" : "describe"} you with caveats. Engines repeat what their sources say, so change the sources.`,
      steps: ["Check the quotes below: are they true and current?", "If outdated, publish the current facts (changelog, pricing, docs) and update third-party listings.", "If fair, address it on a page engines can cite: roadmap, comparison or FAQ."],
      prompts,
      targets: [...new Set(neg.map((e) => e.quote).filter(Boolean))].slice(0, 4).map((q) => ({ label: `“${q}”` })),
    });
  }

  if (status === "leading") {
    out.push({
      id: "prompt-hold",
      kind: "update",
      priority: "low",
      title: "Keep the lead",
      why: `Every engine that answered names you first and at least one cites you.${rivalNames.length ? ` ${list(rivalNames)} ${rivalNames.length === 1 ? "is" : "are"} also named, so it can change.` : ""}`,
      steps: ["Keep the cited pages current and show the update date.", "Re-run this prompt monthly; answers drift as sources change.", "Cover follow-up prompts (pricing, comparisons, how-to) the same way."],
      prompts,
      targets: yourPages.slice(0, 4).map((s) => ({ label: s.title || s.url, url: s.url })),
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

/** A row per prompt in a run, for picking one. */
export function promptReports(answers: Answer[], brands: Brand[], brand: string, previous: Answer[] = []): PromptReport[] {
  return [...new Set(answers.map((a) => a.prompt))].map((p) => promptReport(p, answers, brands, brand, previous));
}

/** "was absent" → "#2 cited": a one-word change between runs, or null when nothing moved. */
export function engineChange(e: EngineRow): { dir: "up" | "down"; label: string } | null {
  if (!e.before || e.before.state === "no-answer" || e.state === "no-answer") return null;
  const score = (s: EngineState, p: number | null) => (s === "absent" ? 0 : (s === "cited" ? 2 : 1) * 10 - Math.min(p ?? 1, 9));
  const a = score(e.before.state, e.before.position);
  const b = score(e.state, e.position);
  if (a === b) return null;
  const was = e.before.state === "absent" ? "not named" : `${e.before.position ? `#${e.before.position} ` : ""}${e.before.state}`;
  return { dir: b > a ? "up" : "down", label: `was ${was}` };
}
