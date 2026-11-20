// Answer-engine optimisation (AEO): what AI answers say about a brand, prompt by prompt, and what to do about it.
// Pure functions shared by the browser and the server. Every number is re-derivable from the stored answers:
// mentions, positions and citation types are matched in code; sentiment is a lexicon score unless an LLM judged it.

import type { AiEngine } from "@/lib/research-types";

// ------------------------------------------------------------- prompt types

export type PromptType = "definition" | "how_to" | "problem" | "discovery" | "comparison" | "alternatives" | "pricing" | "reviews" | "brand";
export type Stage = "awareness" | "consideration" | "decision";

export const PROMPT_TYPES: Record<PromptType, { label: string; stage: Stage; hint: string }> = {
  definition: { label: "What is", stage: "awareness", hint: "Explains a concept. Wins with a crisp definition up top, then depth." },
  how_to: { label: "How to", stage: "awareness", hint: "A task. Wins with numbered steps, code or screenshots, and prerequisites." },
  problem: { label: "Problem", stage: "awareness", hint: "A pain point. Wins by naming the problem, its causes and the fix." },
  discovery: { label: "Best / top", stage: "consideration", hint: "\"Best X for Y\". Wins on list articles and review sites that name you, plus your own comparison pages." },
  comparison: { label: "X vs Y", stage: "consideration", hint: "Head to head. Wins with an honest comparison table and when to pick which." },
  alternatives: { label: "Alternatives", stage: "consideration", hint: "\"Alternatives to Y\". Wins with an alternatives page and listings on third-party roundups." },
  pricing: { label: "Pricing", stage: "decision", hint: "Cost questions. Wins with a public, current pricing page in plain numbers." },
  reviews: { label: "Reviews", stage: "decision", hint: "\"Is X good?\". Wins with reviews on G2, Capterra, Reddit and case studies." },
  brand: { label: "Brand", stage: "decision", hint: "About you by name. Wins with an accurate About page, docs and consistent facts across the web." },
};

export const STAGES: Record<Stage, string> = { awareness: "Awareness", consideration: "Consideration", decision: "Decision" };

const has = (s: string, re: RegExp) => re.test(s);

/** The type of a prompt, from its wording. `brand` is the project's brand name. */
export function classifyPrompt(prompt: string, brand = ""): PromptType {
  const p = prompt.toLowerCase();
  if (has(p, /\b(vs\.?|versus)(?=\s)|\bcompar(e|ed|ing|ison)\b|\bdifference between\b/)) return "comparison";
  if (has(p, /\balternatives?\b|\binstead of\b|\breplace(ment)? for\b|\blike\b.*\bbut\b/)) return "alternatives";
  if (has(p, /\b(price|pricing|cost|costs|cheap|cheapest|free plan|how much)\b/)) return "pricing";
  if (has(p, /\b(review|reviews|worth it|any good|legit|reliable|pros and cons)\b/)) return "reviews";
  if (has(p, /\b(best|top|leading|recommend|which .* should|what .* should i use|tools? for|options for)\b/)) return "discovery";
  if (has(p, /^(how (do|can|to|should)|steps to|guide to)\b/)) return "how_to";
  if (has(p, /\b(why (is|does|do)|fix|error|problem|issue|struggl|can't|cannot|slow)\b/)) return "problem";
  if (brand && new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(prompt)) return "brand";
  if (has(p, /^(what (is|are)|define|explain|meaning of)\b/)) return "definition";
  return "discovery";
}

export interface PromptIdea {
  text: string;
  type: PromptType;
}

/**
 * Prompts people would type, by type and stage. Neutral prompts (no brand) measure real visibility; a few
 * brand prompts check what engines say about you.
 */
export function generatePrompts(input: { brand: string; category: string; audience: string; competitors: string[]; keywords: string[] }): PromptIdea[] {
  const cat = input.category.trim() || input.keywords[0] || "";
  const aud = input.audience.trim();
  const forAud = aud ? ` for ${aud}` : "";
  const names = input.competitors.map(nameOf).filter(Boolean);
  const out: PromptIdea[] = [];
  const add = (type: PromptType, text: string) => text && out.push({ type, text });
  if (cat) {
    add("discovery", `What is the best ${cat}${forAud}?`);
    add("discovery", `Top ${cat} options in ${new Date().getFullYear()}`);
    add("discovery", `Which ${cat} should I use${forAud}?`);
    add("definition", `What is ${cat}?`);
    add("how_to", `How do I choose ${/^[aeiou]/i.test(cat) ? "an" : "a"} ${cat}?`);
    add("how_to", `How to get started with ${cat}${forAud}`);
    add("problem", `Why do teams struggle without ${cat}?`);
    add("pricing", `How much does ${cat} cost?`);
    add("discovery", `Open-source ${cat} options`);
  }
  for (const k of input.keywords.slice(0, 4)) {
    if (k === cat) continue;
    add("discovery", `Best ${k}${forAud}`);
    add("how_to", `How to ${k.startsWith("how") ? k.replace(/^how to\s*/, "") : `get started with ${k}`}`);
  }
  for (const n of names.slice(0, 3)) {
    add("alternatives", `What are the best alternatives to ${n}?`);
    if (input.brand) add("comparison", `${input.brand} vs ${n}: which is better?`);
    add("reviews", `Is ${n} worth it?`);
  }
  if (input.brand) {
    add("brand", `What is ${input.brand}?`);
    add("reviews", `Is ${input.brand} any good?`);
    add("pricing", `How much does ${input.brand} cost?`);
  }
  const seen = new Set<string>();
  return out.filter((p) => !seen.has(p.text.toLowerCase()) && seen.add(p.text.toLowerCase()));
}

// --------------------------------------------------------- answer analysis

export type Sentiment = "positive" | "neutral" | "mixed" | "negative";
export const SENTIMENT_SCORE: Record<Sentiment, number> = { positive: 100, neutral: 50, mixed: 50, negative: 0 };

export interface Brand {
  /** Domain identifies the brand; the first entry is the project's own. */
  domain: string;
  name: string;
  aliases?: string[];
}

export interface BrandResult {
  domain: string;
  mentioned: boolean;
  cited: boolean;
  /** 1 = the first brand the answer names; null when not mentioned. */
  position: number | null;
  sentiment: Sentiment | null;
  /** The sentence the judgment rests on. */
  quote: string;
  /** "llm" when an LLM judged mention and sentiment. */
  judgedBy?: "code" | "llm";
  /** Named in the prompt itself ("alternatives to X", "X vs Y"): a mention there isn't a win, so no position. */
  subject?: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRe = (t: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, "iu");

export const nameOf = (domain: string) => {
  const label = domain.split(".")[0] ?? "";
  return label ? label[0].toUpperCase() + label.slice(1) : "";
};

const POS = /\b(best|leading|excellent|great|strong|powerful|popular|recommended|top|robust|easy|intuitive|reliable|fast|trusted|loved|standout|ideal|well[- ]suited|comprehensive|affordable|free|open[- ]source|flexible|mature)\b/gi;
const NEG = /\b(expensive|limited|lacks?|lacking|complex|complicated|difficult|steep|slow|buggy|outdated|poor|weak|costly|clunky|confusing|drawbacks?|downsides?|cons|issues|missing|not ideal|less mature|immature|deprecated|discontinued)\b/gi;

function sentences(text: string): string[] {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function lexicon(sents: string[]): Sentiment {
  let pos = 0;
  let neg = 0;
  for (const s of sents) {
    pos += (s.match(POS) ?? []).length;
    neg += (s.match(NEG) ?? []).length;
  }
  if (!pos && !neg) return "neutral";
  if (pos && neg && Math.min(pos, neg) / Math.max(pos, neg) >= 0.5) return "mixed";
  return pos > neg ? "positive" : "negative";
}

function clauseFor(sentence: string, mine: string[], all: string[]): string {
  const at = (t: string, from = 0) => {
    const m = termRe(t).exec(sentence.slice(from));
    return m ? m.index + from : -1;
  };
  const start = Math.min(...mine.map((t) => at(t)).filter((i) => i >= 0));
  if (!Number.isFinite(start)) return sentence;
  const others = all.filter((t) => !mine.includes(t)).map((t) => at(t, start + 1)).filter((i) => i > start);
  return sentence.slice(start, others.length ? Math.min(...others) : undefined);
}

/** Which brands an answer names, in what order, how it describes them, and whether it cites them. */
export function analyzeAnswer(text: string, sources: { domain: string }[], brands: Brand[], prompt = ""): BrandResult[] {
  const masked = text.replace(/https?:\/\/\S+/g, " ").replace(/\S+@\S+\.\S+/g, " ");
  const sents = sentences(text);
  const firstAt = brands.map((b) => {
    const terms = [b.name, b.domain, ...(b.aliases ?? [])].map((t) => t.trim()).filter((t) => t.length >= 2);
    let at = -1;
    for (const t of terms) {
      const m = termRe(t).exec(masked);
      if (m && (at < 0 || m.index < at)) at = m.index;
    }
    return { b, at, terms };
  });
  const inPrompt = (terms: string[]) => !!prompt && terms.some((t) => termRe(t).test(prompt));
  const order = firstAt.filter((x) => x.at >= 0 && !inPrompt(x.terms)).sort((a, b) => a.at - b.at);
  const allTerms = firstAt.flatMap((x) => x.terms);
  return firstAt.map(({ b, at, terms }) => {
    const d = b.domain.toLowerCase();
    const cited = !!d && sources.some((s) => s.domain === d || s.domain.endsWith(`.${d}`));
    const about = sents.filter((s) => terms.some((t) => termRe(t).test(s)));
    // In a sentence naming several brands, only the words from this brand up to the next one describe it.
    const clauses = about.map((s) => clauseFor(s, terms, allTerms));
    const mentioned = at >= 0 || (cited && !text);
    return {
      domain: b.domain,
      mentioned,
      cited,
      position: at >= 0 && !inPrompt(terms) ? order.findIndex((x) => x.b.domain === b.domain) + 1 : null,
      subject: inPrompt(terms) || undefined,
      sentiment: at >= 0 ? lexicon(clauses) : null,
      quote: (about[0] ?? "").slice(0, 280),
      judgedBy: "code",
    };
  });
}

// ------------------------------------------------------------- citations

export type SourceType = "you" | "competitor" | "forum" | "review" | "video" | "social" | "reference" | "news" | "blog" | "other";

export const SOURCE_TYPES: Record<SourceType, { label: string; play: string }> = {
  you: { label: "Your site", play: "Keep these pages current: they already earn citations." },
  competitor: { label: "Competitors", play: "Out-answer these pages: match their structure, add what they miss." },
  forum: { label: "Forums & communities", play: "Join the threads honestly: answer questions, share experience, disclose who you are." },
  review: { label: "Review sites", play: "Get listed and collect reviews there." },
  video: { label: "Video", play: "Publish short walkthroughs; engines cite YouTube for how-to prompts." },
  social: { label: "Social", play: "Post the substance (data, how-tos) on LinkedIn and X, not just links." },
  reference: { label: "Reference & docs", play: "Make sure your facts there are right (Wikipedia, docs, standards)." },
  news: { label: "News & media", play: "Pitch data, launches and expert comment to these outlets." },
  blog: { label: "Blogs & roundups", play: "Pitch the authors of list articles to include you." },
  other: { label: "Other", play: "" },
};

const FORUM = /(^|\.)(reddit\.com|quora\.com|stackoverflow\.com|stackexchange\.com|news\.ycombinator\.com|discord\.com|community\.|forum\.|discourse\.)/;
const REVIEW = /(^|\.)(g2\.com|capterra\.com|trustradius\.com|gartner\.com|getapp\.com|softwareadvice\.com|trustpilot\.com|producthunt\.com|alternativeto\.net|saasworthy\.com|peerspot\.com|sourceforge\.net|slashdot\.org)$/;
const VIDEO = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|loom\.com|tiktok\.com)$/;
const SOCIAL = /(^|\.)(linkedin\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|threads\.net|bsky\.app|mastodon\.social)$/;
const REFERENCE = /(^|\.)(wikipedia\.org|wikimedia\.org|github\.com|gitlab\.com|npmjs\.com|pypi\.org|readthedocs\.io|developer\.mozilla\.org|w3\.org|ietf\.org|arxiv\.org|opentelemetry\.io)$|\.(gov|edu)(\.[a-z]{2})?$|^docs\./;
const NEWS = /(^|\.)(techcrunch\.com|forbes\.com|venturebeat\.com|theverge\.com|wired\.com|zdnet\.com|businessinsider\.com|reuters\.com|bloomberg\.com|nytimes\.com|theregister\.com|infoworld\.com|thenewstack\.io|siliconangle\.com)$/;
const BLOG = /(^|\.)(medium\.com|dev\.to|substack\.com|hashnode\.dev|hackernoon\.com|towardsdatascience\.com|blogspot\.com|wordpress\.com)$|^blog\./;

const onDomain = (host: string, d: string) => host === d || host.endsWith(`.${d}`);

export function classifySource(host: string, you: string, competitors: string[]): SourceType {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (you && onDomain(h, you)) return "you";
  if (competitors.some((c) => onDomain(h, c))) return "competitor";
  if (FORUM.test(h)) return "forum";
  if (REVIEW.test(h)) return "review";
  if (VIDEO.test(h)) return "video";
  if (SOCIAL.test(h)) return "social";
  if (NEWS.test(h)) return "news";
  if (REFERENCE.test(h)) return "reference";
  if (BLOG.test(h)) return "blog";
  return "other";
}

// --------------------------------------------------------------- metrics

/** What a stored observation needs for the metrics (lib/ai-visibility.ts's Observation fits). */
export interface Answer {
  prompt: string;
  engine: AiEngine;
  answered: boolean;
  error?: string;
  sources: { url: string; domain: string; title: string }[];
  brands?: BrandResult[];
}

export interface Metrics {
  answered: number;
  /** % of answers that mention the brand. */
  visibility: number;
  /** % of answers that cite the brand's site. */
  citationRate: number;
  /** The brand's share of all brand mentions (you + competitors), %. */
  shareOfVoice: number;
  /** Mean position when mentioned; null if never. */
  avgPosition: number | null;
  /** 0-100 (positive 100, neutral/mixed 50, negative 0); null if never mentioned. */
  sentiment: number | null;
  sentiments: Record<Sentiment, number>;
}

const ok = (a: Answer) => a.answered && !a.error;

export function metricsFor(answers: Answer[], domain: string): Metrics {
  const done = answers.filter(ok);
  const mine = done.map((a) => a.brands?.find((b) => b.domain === domain)).filter((b): b is BrandResult => !!b);
  const mentioned = mine.filter((b) => b.mentioned);
  const allMentions = done.reduce((s, a) => s + (a.brands?.filter((b) => b.mentioned && !b.subject).length ?? 0), 0);
  const positions = mentioned.map((b) => b.position).filter((p): p is number => p != null);
  const sents = mentioned.map((b) => b.sentiment).filter((s): s is Sentiment => !!s);
  const sentiments = { positive: 0, neutral: 0, mixed: 0, negative: 0 } as Record<Sentiment, number>;
  for (const s of sents) sentiments[s]++;
  return {
    answered: done.length,
    visibility: pct(mentioned.length, done.length),
    citationRate: pct(mine.filter((b) => b.cited).length, done.length),
    shareOfVoice: pct(mentioned.filter((b) => !b.subject).length, allMentions),
    avgPosition: positions.length ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10 : null,
    sentiment: sents.length ? Math.round(sents.reduce((s, x) => s + SENTIMENT_SCORE[x], 0) / sents.length) : null,
    sentiments,
  };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export interface SourceRow {
  domain: string;
  type: SourceType;
  answers: number;
  prompts: number;
  /** Brands mentioned in the answers that cite this domain. */
  withBrands: Record<string, number>;
  urls: { url: string; title: string; count: number }[];
}

export function citationTable(answers: Answer[], you: string, competitors: string[]): SourceRow[] {
  type Acc = { answers: Set<string>; prompts: Set<string>; withBrands: Record<string, number>; urls: Map<string, { title: string; count: number }> };
  const by = new Map<string, Acc>();
  for (const a of answers.filter(ok)) {
    const key = `${a.engine}|${a.prompt}`;
    const named = (a.brands ?? []).filter((b) => b.mentioned && !b.subject).map((b) => b.domain);
    for (const s of a.sources) {
      const e: Acc = by.get(s.domain) ?? { answers: new Set<string>(), prompts: new Set<string>(), withBrands: {}, urls: new Map() };
      if (!e.answers.has(key)) for (const d of named) e.withBrands[d] = (e.withBrands[d] ?? 0) + 1;
      e.answers.add(key);
      e.prompts.add(a.prompt);
      const u = e.urls.get(s.url) ?? { title: s.title, count: 0 };
      u.count++;
      e.urls.set(s.url, u);
      by.set(s.domain, e);
    }
  }
  return [...by]
    .map(([domain, e]) => ({
      domain,
      type: classifySource(domain, you, competitors),
      answers: e.answers.size,
      prompts: e.prompts.size,
      withBrands: e.withBrands,
      urls: [...e.urls].map(([url, u]) => ({ url, ...u })).sort((a, b) => b.count - a.count).slice(0, 5),
    }))
    .sort((a, b) => b.answers - a.answers);
}

// ---------------------------------------------------------- opportunities

export type OpportunityKind = "create" | "update" | "outreach" | "community" | "technical" | "reputation";

export interface Opportunity {
  id: string;
  kind: OpportunityKind;
  priority: "high" | "medium" | "low";
  title: string;
  why: string;
  steps: string[];
  prompts: string[];
  /** Pages or domains to act on. */
  targets: { label: string; url?: string }[];
}

export const OPPORTUNITY_KINDS: Record<OpportunityKind, string> = {
  create: "Create a page",
  update: "Update a page",
  outreach: "Get mentioned",
  community: "Join the conversation",
  technical: "Fix access",
  reputation: "Fix perception",
};

const PAGE_FOR: Partial<Record<PromptType, (p: string, comp: string[]) => { title: string; steps: string[] }>> = {
  comparison: (_p, comp) => ({
    title: `Publish a comparison page${comp[0] ? ` against ${nameOf(comp[0])}` : ""}`,
    steps: ["Lead with a one-paragraph verdict: who should pick which.", "Add a feature and pricing table with current numbers.", "Be fair: say where the other product is stronger. Engines quote balanced pages."],
  }),
  alternatives: (_p, comp) => ({
    title: `Publish an "alternatives to ${comp[0] ? nameOf(comp[0]) : "…"}" page`,
    steps: ["List 5–8 real options including yours, each with best-for, pricing and a one-line verdict.", "Put a summary table at the top.", "Update it every quarter and show the date."],
  }),
  discovery: () => ({
    title: "Publish a best-of / buyer's guide page for this category",
    steps: ["Answer the question in the first paragraph with a short ranked list.", "Explain the selection criteria and who each option suits.", "Add schema (ItemList, FAQPage) and a visible updated date."],
  }),
  how_to: () => ({ title: "Publish a step-by-step guide", steps: ["Numbered steps with the exact commands or clicks.", "Prerequisites and expected result up top.", "HowTo schema, and a short video if you can."] }),
  definition: () => ({ title: "Publish a definitive explainer", steps: ["Define the term in the first two sentences.", "Then: why it matters, how it works, examples, related terms.", "Cite sources for every number."] }),
  problem: () => ({ title: "Publish a problem/solution article", steps: ["Name the problem in the words people use.", "Causes, then fixes, each as its own short section.", "Show how your product solves it, with proof."] }),
  pricing: () => ({ title: "Make pricing public and explicit", steps: ["A pricing page with plan names, numbers and limits in HTML (not images).", "A pricing FAQ: free tier, overages, discounts.", "Keep it in sitemap.xml and llms.txt."] }),
  reviews: () => ({ title: "Collect and surface reviews", steps: ["Ask happy customers to review you on G2 / Capterra.", "Publish case studies with numbers.", "Answer the \"is it good?\" question on your own site with evidence."] }),
  brand: () => ({ title: "Fix what engines know about you", steps: ["An About page with a one-sentence description, founding facts and Organization schema (sameAs links).", "Consistent descriptions on GitHub, LinkedIn, Crunchbase, Wikipedia (if eligible).", "llms.txt that summarises who you are and links key pages."] }),
};

/**
 * What to do next, from where competitors appear and you don't, what gets cited, and how you're described.
 * `brands[0]` is you.
 */
export function opportunities(answers: Answer[], brands: Brand[], brand: string): Opportunity[] {
  const you = brands[0]?.domain ?? "";
  const competitors = brands.slice(1).map((b) => b.domain);
  const done = answers.filter(ok);
  const out: Opportunity[] = [];
  const mine = (a: Answer) => a.brands?.find((b) => b.domain === you);

  // 1. Prompts where a competitor is named and you aren't: create or update a page for that prompt type.
  const lost = new Map<string, { type: PromptType; engines: Set<string>; winners: Set<string>; youCited: boolean }>();
  for (const a of done) {
    const m = mine(a);
    const winners = (a.brands ?? []).filter((b) => b.domain !== you && b.mentioned && !b.subject).map((b) => b.domain);
    if (m?.mentioned || !winners.length) continue;
    const e = lost.get(a.prompt) ?? { type: classifyPrompt(a.prompt, brand), engines: new Set(), winners: new Set(), youCited: false };
    e.engines.add(a.engine);
    winners.forEach((w) => e.winners.add(w));
    lost.set(a.prompt, e);
  }
  const byType = new Map<PromptType, { prompts: string[]; winners: Set<string>; engines: Set<string> }>();
  for (const [p, e] of lost) {
    const t = byType.get(e.type) ?? { prompts: [], winners: new Set(), engines: new Set() };
    t.prompts.push(p);
    e.winners.forEach((w) => t.winners.add(w));
    e.engines.forEach((x) => t.engines.add(x));
    byType.set(e.type, t);
  }
  for (const [type, t] of byType) {
    const subjects = brands.slice(1).filter((b) => t.prompts.some((p) => termRe(b.name).test(p))).map((b) => b.domain);
    const page = PAGE_FOR[type]?.(t.prompts[0], subjects.length ? subjects : [...t.winners]);
    if (!page) continue;
    out.push({
      id: `create-${type}`,
      kind: type === "brand" || type === "pricing" ? "update" : "create",
      priority: t.prompts.length >= 2 || t.engines.size >= 3 ? "high" : "medium",
      title: page.title,
      why: `${[...t.winners].map(nameOf).join(", ")} ${t.winners.size === 1 ? "is" : "are"} named in ${t.prompts.length} ${PROMPT_TYPES[type].label.toLowerCase()} ${t.prompts.length === 1 ? "prompt" : "prompts"} where you aren't (${t.engines.size} ${t.engines.size === 1 ? "engine" : "engines"}). ${PROMPT_TYPES[type].hint}`,
      steps: [...page.steps, "Then use \"Simulate agents\" on one of these prompts to see what the cited pages do that yours doesn't."],
      prompts: t.prompts,
      targets: [],
    });
  }

  // 2. Mentioned but not cited: your page isn't the source the engine trusts.
  const uncited = done.filter((a) => mine(a)?.mentioned && !mine(a)?.cited && a.sources.length);
  if (uncited.length >= 2) {
    out.push({
      id: "update-uncited",
      kind: "update",
      priority: "medium",
      title: "Turn mentions into citations",
      why: `You're named in ${uncited.length} answers that link to other sites, not yours. The engine knows you, but another page is the source it trusts for the facts.`,
      steps: ["Open the answers and see which pages are cited instead.", "Give your matching page the specifics they have: numbers, a comparison table, a dated update.", "Make the answer quotable: a self-contained paragraph of 40–80 words under a heading that matches the question."],
      prompts: [...new Set(uncited.map((a) => a.prompt))].slice(0, 6),
      targets: [],
    });
  }

  // 3. Third-party domains cited where competitors appear but you don't.
  const table = citationTable(done, you, competitors);
  const thirdParty = table.filter((s) => !["you", "competitor", "other"].includes(s.type) || (s.type === "other" && s.answers >= 2));
  for (const s of thirdParty.slice(0, 12)) {
    const compHits = competitors.reduce((n, c) => n + (s.withBrands[c] ?? 0), 0);
    const youHits = s.withBrands[you] ?? 0;
    if (compHits === 0 || youHits >= compHits) continue;
    const forum = s.type === "forum" || s.type === "social" || s.type === "video";
    out.push({
      id: `outreach-${s.domain}`,
      kind: forum ? "community" : "outreach",
      priority: s.answers >= 3 ? "high" : s.answers >= 2 ? "medium" : "low",
      title: forum ? `Show up on ${s.domain}` : s.type === "reference" ? `Keep your facts right on ${s.domain}` : `Get included on ${s.domain}`,
      why: `Cited in ${s.answers} ${s.answers === 1 ? "answer" : "answers"} that name a competitor ${compHits} ${compHits === 1 ? "time" : "times"} and you ${youHits}. ${SOURCE_TYPES[s.type].play}`,
      steps: forum
        ? ["Read the cited threads below and what they ask.", "Answer with real experience and specifics; disclose that you work on the product.", "Don't spam: one useful answer beats ten links."]
        : ["Read the cited pages below.", "Contact the author or the site with what's new and why readers would care (data, a free tier, a unique feature).", "Offer accurate facts: pricing, screenshots, a quote."],
      prompts: [],
      targets: s.urls.map((u) => ({ label: u.title || u.url, url: u.url })),
    });
  }

  // 4. Negative or mixed descriptions.
  const neg = done.filter((a) => {
    const s = mine(a)?.sentiment;
    return s === "negative" || s === "mixed";
  });
  if (neg.length) {
    out.push({
      id: "reputation",
      kind: "reputation",
      priority: neg.some((a) => mine(a)?.sentiment === "negative") ? "high" : "medium",
      title: "Address how answers describe you",
      why: `${neg.length} ${neg.length === 1 ? "answer describes" : "answers describe"} you negatively or with caveats. Engines repeat what the web says, so fix the source, not the answer.`,
      steps: ["Read the quoted sentences below: are they true and current?", "If outdated, publish the current facts (changelog, pricing, docs) and update third-party listings.", "If fair, address the weakness in a page engines can cite (roadmap, comparison, FAQ)."],
      prompts: [...new Set(neg.map((a) => a.prompt))].slice(0, 6),
      targets: [...new Set(neg.map((a) => mine(a)?.quote).filter(Boolean))].slice(0, 5).map((q) => ({ label: `“${q}”` })),
    });
  }

  // 5. Low position: named, but after competitors.
  const late = done.filter((a) => (mine(a)?.position ?? 0) >= 3);
  if (late.length >= 2) {
    out.push({
      id: "position",
      kind: "update",
      priority: "medium",
      title: "Move up in list answers",
      why: `In ${late.length} answers you're named third or later. Lists follow how often and how prominently sources rank you.`,
      steps: ["Get into the list articles the engines cite (see Citations).", "State your best-for clearly on your site (\"best X for Y\"), so engines can place you.", "Collect reviews and comparisons that rank you first for your niche."],
      prompts: [...new Set(late.map((a) => a.prompt))].slice(0, 6),
      targets: [],
    });
  }

  // 6. Engine gaps: visible on some engines and absent on another.
  const engines = [...new Set(done.map((a) => a.engine))];
  for (const e of engines) {
    const here = done.filter((a) => a.engine === e);
    const elsewhere = done.filter((a) => a.engine !== e);
    const v = pct(here.filter((a) => mine(a)?.mentioned).length, here.length);
    const w = pct(elsewhere.filter((a) => mine(a)?.mentioned).length, elsewhere.length);
    if (here.length >= 3 && w - v >= 30) {
      out.push({
        id: `engine-${e}`,
        kind: "technical",
        priority: "medium",
        title: `Weak on ${ENGINE_LABEL[e]}`,
        why: `Mentioned in ${v}% of ${ENGINE_LABEL[e]} answers against ${w}% elsewhere. ${ENGINE_NOTES[e]}`,
        steps: ENGINE_STEPS[e],
        prompts: [],
        targets: [],
      });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

export const ENGINE_LABEL: Record<AiEngine, string> = { google: "Google AI Overviews", chatgpt: "ChatGPT", perplexity: "Perplexity", claude: "Claude", gemini: "Gemini" };

/** How each engine finds pages, as far as its operator has said publicly. */
export const ENGINE_NOTES: Record<AiEngine, string> = {
  google: "AI Overviews draw on pages that rank in Google Search.",
  gemini: "Gemini grounds answers with Google Search.",
  chatgpt: "ChatGPT search fetches pages with OAI-SearchBot and ChatGPT-User and also draws on partner search indexes, including Bing's.",
  perplexity: "Perplexity runs its own index (PerplexityBot) and favours fresh, well-structured pages and community sources.",
  claude: "Claude's web search fetches pages with Claude-SearchBot and Claude-User from a third-party search index.",
};

const ENGINE_STEPS: Record<AiEngine, string[]> = {
  google: ["Improve the Google ranking of the pages for these prompts (Rankings, Keywords).", "Add FAQ and HowTo sections that answer the question directly."],
  gemini: ["Improve the Google ranking of the pages for these prompts.", "Keep Organization and Product schema accurate."],
  chatgpt: ["Allow OAI-SearchBot and ChatGPT-User in robots.txt and your firewall.", "Submit your sitemap to Bing Webmaster Tools and enable IndexNow."],
  perplexity: ["Allow PerplexityBot and Perplexity-User.", "Update pages often and show the date; earn mentions on Reddit and YouTube."],
  claude: ["Allow Claude-SearchBot and Claude-User in robots.txt and your firewall.", "Make sure the page answers without JavaScript."],
};

// ---------------------------------------------------------- simulation types

export type FactorId = "access" | "relevance" | "answerFirst" | "structure" | "evidence" | "freshness" | "schema" | "depth" | "coverage";

export const FACTORS: Record<FactorId, { label: string; tip: string }> = {
  access: { label: "Crawler access", tip: "The engine's crawler gets the page (200, not blocked by robots.txt), with the text in the HTML." },
  relevance: { label: "Matches the prompt", tip: "The prompt's words in the title, headings and body." },
  answerFirst: { label: "Answer up top", tip: "A section near the top answers the prompt in a quotable 40–120 words." },
  structure: { label: "Structure", tip: "Question headings, lists and tables engines can lift." },
  evidence: { label: "Evidence", tip: "Numbers, dates and links to sources." },
  freshness: { label: "Freshness", tip: "A recent, visible update date." },
  schema: { label: "Schema", tip: "JSON-LD that fits the prompt (FAQPage, HowTo, Product, Article, ItemList)." },
  depth: { label: "Depth", tip: "Enough substance (roughly 600+ words) to be a full answer." },
  coverage: { label: "Covers the options", tip: "For best-of, vs and alternatives prompts: names and compares the options." },
};

export interface PageScore {
  url: string;
  /** What the engine's crawler was served: some sites send Markdown to AI agents. */
  format: "html" | "markdown";
  title: string;
  status: number;
  blockedByRobots: boolean;
  words: number;
  updated: string | null;
  schemaTypes: string[];
  bestSection: { heading: string; text: string; position: number } | null;
  factors: Record<FactorId, number>;
  total: number;
}

export interface Simulation {
  prompt: string;
  type: PromptType;
  engine: AiEngine;
  agent: { crawler: string; fetcher: string; note: string };
  you: PageScore | null;
  /** Your pages that were considered, best first. */
  candidates: { url: string; score: number }[];
  cited: PageScore[];
  gaps: { factor: FactorId; you: number; them: number; fix: string }[];
  /** Things worth knowing that aren't a score gap (e.g. Markdown served to agents drops schema). */
  notes: string[];
  llm?: { verdict: string; whyTheyWon: string[]; changes: { what: string; why: string }[]; suggestedAnswer: string } | { error: string };
}
