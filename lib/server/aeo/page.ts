// Reads a page the way an answer engine's crawler does: no JavaScript, just the HTML. Splits it into sections
// and scores how well it answers one prompt. Regex-based on purpose: it runs on Workers, per page, in
// milliseconds, and only needs headings, text, lists, tables, dates and JSON-LD types.

import { FACTORS, type FactorId, type PageScore, type PromptType } from "@/lib/aeo";

export interface Section {
  heading: string;
  text: string;
  /** % of the way down the page. */
  position: number;
}

export interface ParsedPage {
  /** What the crawler was served: some sites send Markdown to AI agents. */
  format: "html" | "markdown";
  title: string;
  description: string;
  h1: string;
  headings: string[];
  sections: Section[];
  words: number;
  lists: number;
  tables: number;
  outLinks: number;
  updated: string | null;
  schemaTypes: string[];
  text: string;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const strip = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Markdown served to AI agents (content negotiation, or a site that detects their user agent). */
export function parseMarkdown(md: string, host: string): ParsedPage {
  let body = md;
  const fm: Record<string, string> = {};
  const front = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(md);
  if (front) {
    for (const line of front[1].split("\n")) {
      const m = /^([\w-]+)\s*:\s*"?(.*?)"?\s*$/.exec(line);
      if (m) fm[m[1].toLowerCase()] = m[2];
    }
    body = md.slice(front[0].length);
  }
  const lines = body.split("\n");
  const headings: string[] = [];
  const raw: { heading: string; text: string }[] = [];
  let heading = "";
  let buf: string[] = [];
  let lists = 0;
  let tables = 0;
  let inList = false;
  const flush = () => {
    const text = buf.join("\n").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`>#|]/g, " ").replace(/[ \t]+/g, " ").trim();
    if (text.split(/\s+/).length >= 8) raw.push({ heading, text });
    buf = [];
  };
  let h1 = "";
  for (const l of lines) {
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) {
      flush();
      heading = h[2].replace(/[*_`]/g, "").trim();
      headings.push(heading);
      if (h[1] === "#" && !h1) h1 = heading;
      continue;
    }
    const isItem = /^\s*([-*+]|\d+[.)])\s+/.test(l);
    if (isItem && !inList) lists++;
    inList = isItem;
    if (/^\s*\|?\s*:?-{3,}/.test(l)) tables++;
    buf.push(l);
  }
  flush();
  const total = raw.reduce((s, r) => s + r.text.length, 0);
  let at = 0;
  const sections: Section[] = raw.map((r) => {
    const s = { heading: r.heading, text: r.text.slice(0, 4000), position: total ? Math.round((at / total) * 100) : 0 };
    at += r.text.length;
    return s;
  });
  const outLinks = [...body.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].filter((m) => {
    try {
      const x = new URL(m[1]).hostname.replace(/^www\./, "");
      return x !== host && !x.endsWith(`.${host}`);
    } catch {
      return false;
    }
  }).length;
  const text = raw.map((r) => r.text).join("\n");
  return {
    format: "markdown",
    title: fm.title ?? h1,
    description: fm.description ?? "",
    h1,
    headings,
    sections,
    words: text.split(/\s+/).filter(Boolean).length,
    lists,
    tables,
    outLinks,
    updated: fm.updated || fm.lastmod || fm.date_modified || fm.datemodified || fm.date || bodyDate(body) || null,
    schemaTypes: [],
    text,
  };
}

/**
 * Markdown served to agents has no JSON-LD, so sites often state the date in the text instead, near the top:
 * "Last updated: 2026-11-26" or "Updated November 26, 2026". Read that when the front matter has no date.
 */
export function bodyDate(body: string): string | null {
  const m = /\b(?:last\s+updated|last\s+modified|updated(?:\s+on)?)\s*[:\-–]?\s*(\d{4}-\d{2}-\d{2}|[A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})/i.exec(body.slice(0, 3000));
  if (!m) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(m[1])) return m[1];
  const t = Date.parse(`${m[1].replace(/\./, "")} UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function parsePage(html: string, host: string, contentType = ""): ParsedPage {
  if (/markdown/i.test(contentType) || (!/<html|<body|<head|<div/i.test(html.slice(0, 5000)) && /^(---|#\s)/m.test(html.slice(0, 500)))) return parseMarkdown(html, host);
  const meta = (name: string) =>
    new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i").exec(html)?.[1] ??
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i").exec(html)?.[1] ??
    "";
  const title = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");

  const schemaTypes = new Set<string>();
  let updated: string | null = meta("article:modified_time") || meta("og:updated_time") || null;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const t of m[1].matchAll(/"@type"\s*:\s*(\[[^\]]*\]|"[^"]+")/g)) {
      for (const x of t[1].matchAll(/"([^"]+)"/g)) schemaTypes.add(x[1]);
    }
    const d = /"dateModified"\s*:\s*"([^"]+)"/.exec(m[1])?.[1] ?? /"datePublished"\s*:\s*"([^"]+)"/.exec(m[1])?.[1];
    if (d && !updated) updated = d;
  }
  if (!updated) updated = /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1] ?? null;

  // The readable part: drop scripts, styles, navigation and footers.
  let body = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
  body = body.replace(/<(script|style|noscript|svg|template|iframe|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, " ");

  const outLinks = [...body.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi)].filter((m) => {
    try {
      const h = new URL(m[1]).hostname.replace(/^www\./, "");
      return h !== host && !h.endsWith(`.${host}`);
    } catch {
      return false;
    }
  }).length;
  const lists = (body.match(/<(ol|ul)\b/gi) ?? []).length;
  const tables = (body.match(/<table\b/gi) ?? []).length;

  const parts = body.split(/(<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>)/i);
  const sections: Section[] = [];
  const headings: string[] = [];
  let heading = "";
  let total = 0;
  const raw: { heading: string; text: string }[] = [];
  for (const p of parts) {
    if (/^<h[1-3]\b/i.test(p)) {
      heading = strip(p);
      if (heading) headings.push(heading);
      continue;
    }
    const text = strip(p.replace(/<\/(p|li|div|tr|br)>/gi, "$&\n"));
    if (text.split(" ").length < 8) continue;
    raw.push({ heading, text });
    total += text.length;
  }
  let at = 0;
  for (const r of raw) {
    sections.push({ heading: r.heading, text: r.text.slice(0, 4000), position: total ? Math.round((at / total) * 100) : 0 });
    at += r.text.length;
  }
  const text = raw.map((r) => r.text).join("\n");
  return {
    format: "html",
    title,
    description: decodeEntities(meta("description") || meta("og:description")),
    h1: strip(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? ""),
    headings,
    sections,
    words: text.split(/\s+/).filter(Boolean).length,
    lists,
    tables,
    outLinks,
    updated,
    schemaTypes: [...schemaTypes].slice(0, 20),
    text,
  };
}

// ---------------------------------------------------------------- scoring

const STOP = new Set(
  "a an the and or of for to in on with is are was be by at as it its this that these those what which who how why when where do does can should i we you my our your best top vs versus compared about from into than more most get use using which better good worth any there some".split(" "),
);

export function terms(prompt: string): string[] {
  return [...new Set(prompt.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)))];
}

const coverage = (text: string, ts: string[]) => {
  if (!ts.length) return 0;
  const t = text.toLowerCase();
  return ts.filter((w) => t.includes(w)).length / ts.length;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const SCHEMA_FIT: Record<PromptType, string[]> = {
  definition: ["Article", "TechArticle", "FAQPage", "DefinedTerm"],
  how_to: ["HowTo", "TechArticle", "Article", "FAQPage"],
  problem: ["Article", "TechArticle", "FAQPage"],
  discovery: ["ItemList", "Article", "FAQPage", "Review"],
  comparison: ["Article", "ItemList", "FAQPage", "Product"],
  alternatives: ["ItemList", "Article", "FAQPage"],
  pricing: ["Product", "Offer", "SoftwareApplication", "FAQPage"],
  reviews: ["Review", "AggregateRating", "Product", "SoftwareApplication"],
  brand: ["Organization", "SoftwareApplication", "Product", "WebSite"],
};

/** How well a parsed page answers a prompt, factor by factor (0-100). */
export function scorePage(
  page: ParsedPage,
  meta: { url: string; status: number; blockedByRobots: boolean },
  prompt: string,
  type: PromptType,
  brandNames: string[],
): PageScore {
  const ts = terms(prompt);
  const best = page.sections
    .map((s) => ({ s, c: coverage(`${s.heading} ${s.text}`, ts) }))
    .sort((a, b) => b.c - a.c || a.s.position - b.s.position)[0];

  const access = meta.status >= 200 && meta.status < 300 && !meta.blockedByRobots ? (page.words >= 150 ? 100 : 50) : 0;
  const relevance = clamp(coverage(page.title, ts) * 30 + coverage(page.headings.join(" "), ts) * 30 + coverage(page.text, ts) * 40);

  let answerFirst = 0;
  if (best && best.c >= 0.5) {
    const words = best.s.text.split(/\s+/).length;
    answerFirst = clamp(best.c * 60 + (best.s.position <= 30 ? 25 : best.s.position <= 60 ? 10 : 0) + (words >= 40 && words <= 250 ? 15 : 5));
  }

  const qHeadings = page.headings.filter((h) => /\?$|^(what|how|why|which|when|is|can|does|should)\b/i.test(h)).length;
  const structure = clamp(Math.min(page.headings.length, 8) * 5 + Math.min(qHeadings, 4) * 8 + Math.min(page.lists, 4) * 6 + (page.tables ? 20 : 0) - (type === "comparison" && !page.tables ? 15 : 0));

  const numbers = (page.text.match(/\b\d+([.,]\d+)?\s?(%|x|ms|k|m|\$|usd|users|customers|hours|days)?\b/gi) ?? []).length;
  const years = (page.text.match(/\b20[12]\d\b/g) ?? []).length;
  const evidence = clamp(Math.min(numbers, 20) * 3 + Math.min(page.outLinks, 8) * 4 + Math.min(years, 4) * 2);

  let freshness = 30;
  if (page.updated) {
    const age = (Date.now() - Date.parse(page.updated)) / 86_400_000;
    freshness = !Number.isFinite(age) ? 30 : age <= 90 ? 100 : age <= 180 ? 80 : age <= 365 ? 60 : age <= 730 ? 35 : 15;
  }

  const fit = SCHEMA_FIT[type];
  const schema = clamp((page.schemaTypes.length ? 30 : 0) + (page.schemaTypes.some((t) => fit.includes(t)) ? 70 : 0));
  const depth = clamp((page.words / 900) * 100);

  let coverageScore = 100;
  if (type === "discovery" || type === "comparison" || type === "alternatives") {
    const lower = page.text.toLowerCase();
    const named = brandNames.filter((b) => b.length >= 2 && lower.includes(b.toLowerCase())).length;
    const listy = page.lists + page.tables;
    coverageScore = clamp(Math.min(named, 4) * 18 + Math.min(listy, 3) * 10);
  }

  const factors: Record<FactorId, number> = { access, relevance, answerFirst, structure, evidence, freshness, schema, depth, coverage: coverageScore };
  const weights: Record<FactorId, number> = { access: 15, relevance: 20, answerFirst: 20, structure: 10, evidence: 10, freshness: 8, schema: 5, depth: 7, coverage: 5 };
  const total = clamp((Object.keys(weights) as FactorId[]).reduce((s, k) => s + factors[k] * weights[k], 0) / 100);
  return {
    url: meta.url,
    format: page.format,
    title: page.title || page.h1,
    status: meta.status,
    blockedByRobots: meta.blockedByRobots,
    words: page.words,
    updated: page.updated,
    schemaTypes: page.schemaTypes,
    bestSection: best ? { heading: best.s.heading, text: best.s.text.slice(0, 600), position: best.s.position } : null,
    factors,
    total,
  };
}

/** What to change when the cited pages beat yours on a factor. */
export function fixFor(f: FactorId, type: PromptType, you: PageScore): string {
  switch (f) {
    case "access":
      return you.blockedByRobots
        ? "robots.txt blocks this engine's crawler from the page. Allow it."
        : you.status >= 400
          ? `The crawler got HTTP ${you.status}. Check firewall and bot-protection rules for this crawler.`
          : "Almost no text comes back without JavaScript. Render the content on the server.";
    case "relevance":
      return "Use the prompt's own words in the title, an H2 and the first paragraph.";
    case "answerFirst":
      return "Add a 40–120 word answer right under the first heading that answers the prompt on its own.";
    case "structure":
      return type === "comparison" ? "Add a comparison table and question-style headings." : "Break the page into question headings with lists the engine can lift.";
    case "evidence":
      return "Add specifics: numbers, dates, benchmarks, and link to sources.";
    case "freshness":
      return "Update the page and show the date (dateModified in schema and on the page).";
    case "schema":
      return `Add JSON-LD that fits: ${SCHEMA_FIT[type].slice(0, 3).join(", ")}.`;
    case "depth":
      return "Expand the page: the cited pages cover the topic in more depth.";
    case "coverage":
      return "Name and compare the options people weigh, yours included, ideally in a table.";
  }
}

export const FACTOR_IDS = Object.keys(FACTORS) as FactorId[];
