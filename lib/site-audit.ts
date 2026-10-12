"use client";

// Site crawl + site-wide audit. The crawl comes from the Scrapling service
// (POST /api/crawl) when one is configured, otherwise from a built-in
// page-by-page crawler in the browser. Every HTML page is audited by the same
// WASM engine as single-page audits; this module adds what only a crawl can
// see: duplicates across pages, broken and redirecting internal links, depth,
// inbound links, sitemap coverage, and issues that repeat on most pages (a
// template problem, fixed once).

import { robotsAllows, runEngine } from "@/lib/engine";
import type { Report, Severity } from "@/lib/types";

export interface CrawlPage {
  url: string;
  finalUrl: string;
  status: number;
  depth: number;
  from: string | null;
  /** Fetch time; null when the crawler can't measure it (Scrapling). */
  ms: number | null;
  contentType: string;
  headers: Record<string, string>;
  html: string;
  truncated?: boolean;
  links: string[];
}

export interface CrawlResult {
  start: string;
  pages: CrawlPage[];
  errors: { url: string; error: string; from: string | null }[];
  robotsSkipped: string[];
  sitemapUrls: string[];
  crawlMs: number;
  engine: "scrapling" | "built-in";
}

export interface PageAudit {
  page: CrawlPage;
  report: Report | null;
}

export interface SiteFinding {
  id: string;
  title: string;
  severity: Severity;
  detail: string;
  fix: string;
  /** Share of audited pages affected (0-1), for ranking. */
  share: number;
  pages: { url: string; note?: string }[];
}

export interface TemplateIssue {
  checkId: string;
  title: string;
  severity: Severity;
  count: number;
  share: number;
  recommendation: string;
}

export interface SiteSummary {
  start: string;
  crawledAt: string;
  engine: CrawlResult["engine"];
  crawlMs: number;
  analyzeMs: number;
  pagesCrawled: number;
  htmlPages: number;
  avgScore: number | null;
  broken: number;
  findings: SiteFinding[];
  templateIssues: TemplateIssue[];
  sitemap: { listed: number; crawledListed: number; crawledNotListed: number } | null;
  scoreBuckets: { good: number; ok: number; poor: number };
}

export const norm = (u: string) => {
  try {
    const x = new URL(u);
    x.hash = "";
    x.hostname = x.hostname.toLowerCase().replace(/^www\./, "");
    return x.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
};

// ------------------------------------------------------------------ crawling

async function getPage(url: string): Promise<(CrawlPage & { error?: undefined }) | { error: string }> {
  const res = await fetch(`/api/page?url=${encodeURIComponent(url)}`);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || body.error) return { error: body.error ?? `HTTP ${res.status}` };
  return { ...body, depth: 0, from: null, links: [] };
}

function linksIn(html: string, base: string, host: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = new Set<string>();
  for (const a of doc.querySelectorAll("a[href], area[href]")) {
    const href = a.getAttribute("href")?.trim() ?? "";
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      u.hash = "";
      if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname === host) out.add(u.toString());
    } catch {
      /* ignore malformed hrefs */
    }
  }
  return [...out].slice(0, 300);
}

/** Built-in crawler: breadth-first, same host, robots.txt obeyed, a few pages at a time. */
async function builtInCrawl(start: string, maxPages: number, maxDepth: number, onProgress: (n: number) => void): Promise<CrawlResult> {
  const t0 = performance.now();
  const origin = new URL(start).origin;
  const host = new URL(start).hostname;
  const robots = await getPage(`${origin}/robots.txt`);
  const robotsTxt = !("error" in robots && robots.error) && (robots as CrawlPage).status === 200 ? (robots as CrawlPage).html : "";

  const sitemapUrls: string[] = [];
  const declared = [...robotsTxt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  for (const sm of (declared.length ? declared : [`${origin}/sitemap.xml`]).slice(0, 2)) {
    const r = await getPage(sm);
    if ("error" in r && r.error) continue;
    const text = (r as CrawlPage).html;
    const locs = [...text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (text.includes("<sitemapindex")) {
      for (const child of locs.slice(0, 2)) {
        const c = await getPage(child);
        if (!("error" in c && c.error)) sitemapUrls.push(...[...(c as CrawlPage).html.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&")));
      }
    } else sitemapUrls.push(...locs);
  }

  const pages: CrawlPage[] = [];
  const errors: CrawlResult["errors"] = [];
  const robotsSkipped: string[] = [];
  const queued = new Set([norm(start)]);
  const queue: { url: string; depth: number; from: string | null }[] = [{ url: start, depth: 0, from: null }];
  const visit = async (item: { url: string; depth: number; from: string | null }) => {
    const u = new URL(item.url);
    if (robotsTxt && !(await robotsAllows(robotsTxt, u.pathname + u.search))) {
      robotsSkipped.push(item.url);
      return;
    }
    const r = await getPage(item.url);
    if ("error" in r && r.error) {
      errors.push({ url: item.url, error: r.error, from: item.from });
      return;
    }
    const page = r as CrawlPage;
    const links = /html/i.test(page.contentType || "text/html") ? linksIn(page.html, page.finalUrl, host) : [];
    pages.push({ ...page, depth: item.depth, from: item.from, links });
    onProgress(pages.length);
    if (item.depth >= maxDepth) return;
    for (const l of links) {
      if (queued.size >= maxPages || queued.has(norm(l))) continue;
      queued.add(norm(l));
      queue.push({ url: l, depth: item.depth + 1, from: page.finalUrl });
    }
  };
  // Up to 4 fetches in flight; newly found links join the queue as pages finish.
  const active = new Set<Promise<void>>();
  while (queue.length || active.size) {
    while (queue.length && active.size < 4) {
      const p: Promise<void> = visit(queue.shift()!).finally(() => active.delete(p));
      active.add(p);
    }
    if (active.size) await Promise.race(active);
  }
  return { start, pages, errors, robotsSkipped, sitemapUrls, crawlMs: Math.round(performance.now() - t0), engine: "built-in" };
}

export async function crawlSite(start: string, maxPages: number, maxDepth: number, onProgress: (msg: string) => void): Promise<CrawlResult> {
  const res = await fetch("/api/crawl", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: start, maxPages, maxDepth }) });
  if (res.status === 501) {
    onProgress("Crawling with the built-in crawler");
    return builtInCrawl(start, maxPages, maxDepth, (n) => onProgress(`Crawled ${n} pages`));
  }
  const body = await res.json().catch(() => ({ detail: `Crawl failed (HTTP ${res.status})` }));
  if (!res.ok || body.detail || body.error) throw new Error(body.detail ?? body.error ?? `Crawl failed (HTTP ${res.status})`);
  return { ...(body as Omit<CrawlResult, "engine">), engine: "scrapling" };
}

// ------------------------------------------------------------------ auditing

/** True when a page redirected off the crawled site (e.g. /discord -> discord.com): not part of the site. */
export function offsite(result: CrawlResult, p: CrawlPage): boolean {
  try {
    return new URL(p.finalUrl).hostname.replace(/^www\./, "") !== new URL(result.start).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

export async function auditPages(result: CrawlResult, onProgress: (done: number, total: number) => void): Promise<PageAudit[]> {
  const out: PageAudit[] = [];
  const html = result.pages.filter((p) => p.status >= 200 && p.status < 300 && /html/i.test(p.contentType || "text/html") && p.html && !offsite(result, p));
  let done = 0;
  for (const page of result.pages) {
    if (!html.includes(page)) {
      out.push({ page, report: null });
      continue;
    }
    const { report } = await runEngine({
      url: page.url,
      finalUrl: page.finalUrl,
      status: page.status,
      headers: page.headers ?? {},
      html: page.html,
      redirects: norm(page.url) !== norm(page.finalUrl) ? [{ url: page.url, status: 301 }] : [],
      sitemaps: [],
      botProbes: [],
    });
    out.push({ page, report });
    onProgress(++done, html.length);
    // Yield to the UI between pages.
    if (done % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/**
 * The app-shell heuristic misreads image-only or very short pages as
 * JavaScript-dependent. When a rendering service is available, render the
 * suspects (a handful at most) and re-audit them with the measured comparison.
 */
export async function verifyJsPages(result: CrawlResult, audits: PageAudit[], onProgress: (msg: string) => void, limit = 6): Promise<number> {
  const suspects = audits.filter((a) => a.report?.page.spaShell).slice(0, limit);
  let verified = 0;
  for (const [i, a] of suspects.entries()) {
    onProgress(`Rendering ${i + 1}/${suspects.length} suspected JavaScript pages to verify`);
    const res = await fetch(`/api/render?url=${encodeURIComponent(a.page.finalUrl)}`);
    if (res.status === 501) return verified;
    const r = await res.json().catch(() => null);
    if (!res.ok || !r?.html) continue;
    const { report } = await runEngine({
      url: a.page.url,
      finalUrl: a.page.finalUrl,
      status: a.page.status,
      headers: a.page.headers ?? {},
      html: a.page.html,
      redirects: [],
      sitemaps: [],
      botProbes: [],
      renderedHtml: r.html,
      renderMs: r.renderMs,
      renderedUrl: r.finalUrl,
    });
    a.report = report;
    verified++;
  }
  return verified;
}

// ------------------------------------------------------------------ aggregation

const SEV_WEIGHT: Record<Severity, number> = { critical: 10, high: 6, medium: 3, low: 1 };

function groupBy<T>(xs: T[], key: (x: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x)?.trim().toLowerCase();
    if (!k) continue;
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

export function summarize(result: CrawlResult, audits: PageAudit[], analyzeMs: number): SiteSummary {
  const audited = audits.filter((a) => a.report) as (PageAudit & { report: Report })[];
  const n = Math.max(audited.length, 1);
  const findings: SiteFinding[] = [];
  const add = (f: Omit<SiteFinding, "share">, affected = f.pages.length) => {
    if (f.pages.length) findings.push({ ...f, share: Math.min(1, affected / n) });
  };
  const status = (a: PageAudit & { report: Report }, id: string) => a.report.checks.find((c) => c.id === id)?.status;

  // Broken pages and fetch errors, with where they were linked from.
  const broken = [
    ...result.pages.filter((p) => p.status >= 400).map((p) => ({ url: p.url, note: `HTTP ${p.status}${p.from ? `, linked from ${p.from}` : ""}` })),
    ...result.errors.map((e) => ({ url: e.url, note: `${e.error}${e.from ? `, linked from ${e.from}` : ""}` })),
  ];
  add({ id: "broken", title: "Broken internal links", severity: "critical", pages: broken, detail: `${broken.length} internal URLs return an error.`, fix: "Fix or remove the links, or 301-redirect the URLs to a live page. Broken links waste crawl budget and lose link equity." });

  const redirects = result.pages.filter((p) => p.status < 400 && norm(p.url) !== norm(p.finalUrl) && !offsite(result, p)).map((p) => ({ url: p.url, note: `redirects to ${p.finalUrl}` }));
  add({ id: "redirect-links", title: "Internal links that redirect", severity: "medium", pages: redirects, detail: `${redirects.length} internal links point at URLs that redirect.`, fix: "Update the links to the final URL so crawlers and users skip the extra hop." });

  const away = result.pages.filter((p) => offsite(result, p)).map((p) => ({ url: p.url, note: `redirects to ${p.finalUrl}` }));
  add({ id: "offsite-redirects", title: "Internal URLs that redirect to another site", severity: "low", pages: away, detail: `${away.length} URLs on this site forward visitors elsewhere.`, fix: "Fine for vanity links (/discord, /twitter). Link to the destination directly in content, and avoid these in the sitemap." });

  const dupTitles = [...groupBy(audited, (a) => a.report.page.title).values()].filter((g) => g.length > 1);
  add({ id: "dup-titles", title: "Duplicate titles", severity: "high", pages: dupTitles.flatMap((g) => g.map((a) => ({ url: a.page.url, note: `“${a.report.page.title}” (${g.length} pages)` }))), detail: `${dupTitles.length} titles are shared by more than one page.`, fix: "Give every page a unique title that names its specific topic. Duplicates make pages compete with each other and confuse which one to cite." });

  const dupDesc = [...groupBy(audited, (a) => a.report.page.description).values()].filter((g) => g.length > 1);
  add({ id: "dup-descriptions", title: "Duplicate meta descriptions", severity: "medium", pages: dupDesc.flatMap((g) => g.map((a) => ({ url: a.page.url, note: `${g.length} pages share it` }))), detail: `${dupDesc.length} descriptions are reused across pages.`, fix: "Write a specific description per page, or leave it out on low-value pages so Google generates one." });

  const missingTitle = audited.filter((a) => status(a, "title") === "fail");
  add({ id: "missing-title", title: "Pages without a title", severity: "critical", pages: missingTitle.map((a) => ({ url: a.page.url })), detail: `${missingTitle.length} pages have no <title>.`, fix: "Add a unique, descriptive title to each page (usually in the page template)." });

  const missingDesc = audited.filter((a) => status(a, "description") === "fail");
  add({ id: "missing-description", title: "Pages without a meta description", severity: "high", pages: missingDesc.map((a) => ({ url: a.page.url })), detail: `${missingDesc.length} pages have no meta description.`, fix: "Add a 70-160 character summary per page; it's the snippet in search results and AI citations." });

  const h1 = audited.filter((a) => status(a, "h1") === "fail" || status(a, "h1") === "warn");
  add({ id: "h1", title: "Missing or multiple H1s", severity: "medium", pages: h1.map((a) => ({ url: a.page.url, note: a.report.checks.find((c) => c.id === "h1")?.finding })), detail: `${h1.length} pages lack a single clear H1.`, fix: "Use exactly one H1 per page that states its main topic." });

  const noindex = audited.filter((a) => status(a, "noindex") === "fail");
  add({ id: "noindex", title: "Pages excluded from search (noindex)", severity: "high", pages: noindex.map((a) => ({ url: a.page.url })), detail: `${noindex.length} crawled pages carry noindex.`, fix: "Confirm these should be hidden. If not, remove noindex; if so, stop linking to them prominently." });

  const canon = audited.filter((a) => status(a, "canonical") === "fail" || status(a, "canonical") === "warn");
  add({ id: "canonical", title: "Canonical problems", severity: "high", pages: canon.map((a) => ({ url: a.page.url, note: a.report.checks.find((c) => c.id === "canonical")?.finding })), detail: `${canon.length} pages have a missing, relative, conflicting or off-page canonical.`, fix: "Each indexable page should have one absolute, self-referencing canonical." });

  const thin = audited.filter((a) => a.report.page.wordCount < 300 && status(a, "noindex") !== "fail");
  add({ id: "thin", title: "Thin pages (under 300 words)", severity: "medium", pages: thin.map((a) => ({ url: a.page.url, note: `${a.report.page.wordCount} words` })), detail: `${thin.length} indexable pages have little server-rendered text.`, fix: "Expand them with substantive content, merge them into stronger pages, or noindex low-value ones." });

  // Measured (rendered) verdicts win over the heuristic.
  const shell = audited.filter((a) => (a.report.render ? a.report.render.hiddenPct >= 50 : a.report.page.spaShell));
  add({
    id: "js-shell",
    title: "Pages that need JavaScript to show content",
    severity: "critical",
    pages: shell.map((a) => ({ url: a.page.url, note: a.report.render ? `${a.report.render.hiddenPct}% of words only after JavaScript (measured)` : `${a.report.page.wordCount} words in the raw HTML (heuristic)` })),
    detail: `${shell.length} pages show little or no content without JavaScript.`,
    fix: "AI crawlers don't run JavaScript. Server-render or pre-render these routes.",
  });

  const slow = result.pages.filter((p) => p.status < 400 && p.ms != null && p.ms > 1500);
  add({ id: "slow", title: "Slow pages (over 1.5 s)", severity: "medium", pages: slow.map((p) => ({ url: p.url, note: `${p.ms} ms` })), detail: `${slow.length} pages took over 1.5 s to download.`, fix: "Cache these responses at the edge or optimise the server work behind them." });

  const deep = result.pages.filter((p) => p.status < 400 && p.depth >= 3 && !offsite(result, p));
  add({ id: "deep", title: "Pages three or more clicks from the start", severity: "low", pages: deep.map((p) => ({ url: p.url, note: `depth ${p.depth}` })), detail: `${deep.length} pages are buried deep in the link structure.`, fix: "Link important pages from the homepage, navigation or hub pages so crawlers reach them sooner." });

  // Inbound links within the crawl.
  const inbound = new Map<string, number>();
  for (const p of result.pages) for (const l of new Set(p.links.map(norm))) if (l !== norm(p.finalUrl)) inbound.set(l, (inbound.get(l) ?? 0) + 1);
  const weak = audited.filter((a) => norm(a.page.url) !== norm(result.start) && (inbound.get(norm(a.page.finalUrl)) ?? inbound.get(norm(a.page.url)) ?? 0) <= 1);
  add({ id: "weak-links", title: "Pages with only one internal link pointing to them", severity: "low", pages: weak.map((a) => ({ url: a.page.url })), detail: `${weak.length} pages are linked from at most one crawled page.`, fix: "Add contextual links from related pages; internal links tell search engines which pages matter." });

  let sitemap: SiteSummary["sitemap"] = null;
  if (result.sitemapUrls.length) {
    const listed = new Set(result.sitemapUrls.map(norm));
    const indexable = audited.filter((a) => status(a, "noindex") !== "fail" && status(a, "canonical") !== "warn");
    const notListed = indexable.filter((a) => !listed.has(norm(a.page.finalUrl)) && !listed.has(norm(a.page.url)));
    sitemap = { listed: listed.size, crawledListed: indexable.length - notListed.length, crawledNotListed: notListed.length };
    add({ id: "not-in-sitemap", title: "Indexable pages missing from the sitemap", severity: "medium", pages: notListed.map((a) => ({ url: a.page.url })), detail: `${notListed.length} crawled, indexable pages aren't in the sitemap.`, fix: "Add every canonical, indexable URL to the sitemap so search and AI crawlers find and refresh them." });
    const listedBroken = result.pages.filter((p) => p.status >= 400 && listed.has(norm(p.url)));
    add({ id: "sitemap-broken", title: "Sitemap lists broken URLs", severity: "high", pages: listedBroken.map((p) => ({ url: p.url, note: `HTTP ${p.status}` })), detail: `${listedBroken.length} sitemap URLs return errors.`, fix: "Remove or fix them; a sitemap should only list live, canonical pages." });
  } else {
    findings.push({ id: "no-sitemap", title: "No sitemap found", severity: "high", share: 1, pages: [{ url: result.start }], detail: "Neither robots.txt nor /sitemap.xml led to a sitemap.", fix: "Publish an XML sitemap and declare it in robots.txt." });
  }

  // Template issues: per-page checks failing on most pages are fixed once, in the shared layout.
  const counts = new Map<string, { title: string; severity: Severity; rec: string; count: number }>();
  for (const a of audited) {
    for (const c of a.report.checks) {
      if (c.status !== "fail" && c.status !== "warn") continue;
      const e = counts.get(c.id) ?? { title: c.title, severity: c.severity, rec: c.recommendation, count: 0 };
      e.count++;
      counts.set(c.id, e);
    }
  }
  const templateIssues: TemplateIssue[] = [...counts.entries()]
    .map(([checkId, e]) => ({ checkId, title: e.title, severity: e.severity, count: e.count, share: e.count / n, recommendation: e.rec }))
    .filter((t) => audited.length >= 3 && t.share >= 0.6)
    .sort((a, b) => SEV_WEIGHT[b.severity] * b.share - SEV_WEIGHT[a.severity] * a.share);

  findings.sort((a, b) => SEV_WEIGHT[b.severity] * (0.5 + b.share) - SEV_WEIGHT[a.severity] * (0.5 + a.share));
  const scores = audited.map((a) => a.report.summary.overall);
  return {
    start: result.start,
    crawledAt: new Date().toISOString(),
    engine: result.engine,
    crawlMs: result.crawlMs,
    analyzeMs: Math.round(analyzeMs),
    pagesCrawled: result.pages.length + result.errors.length,
    htmlPages: audited.length,
    avgScore: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null,
    broken: broken.length,
    findings,
    templateIssues,
    sitemap,
    scoreBuckets: { good: scores.filter((s) => s >= 80).length, ok: scores.filter((s) => s >= 55 && s < 80).length, poor: scores.filter((s) => s < 55).length },
  };
}

// ------------------------------------------------------------------ history

const KEY = (projectId: string) => `metainfo:crawls:${projectId}`;

export interface CrawlSnapshot {
  at: string;
  start: string;
  pages: number;
  avgScore: number | null;
  broken: number;
  findings: number;
}

export function loadCrawlHistory(projectId: string): CrawlSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(KEY(projectId)) ?? "[]");
  } catch {
    return [];
  }
}

export function saveCrawl(projectId: string, s: SiteSummary): CrawlSnapshot[] {
  const list = [...loadCrawlHistory(projectId), { at: s.crawledAt, start: s.start, pages: s.htmlPages, avgScore: s.avgScore, broken: s.broken, findings: s.findings.length }].slice(-30);
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify(list));
  } catch {
    /* storage full */
  }
  return list;
}
