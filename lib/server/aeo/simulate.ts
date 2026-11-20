// "Simulate agents": for one prompt and one engine, do what that engine's crawler does. Find your page that
// should answer the prompt, fetch it (and the pages the engine actually cited) with the engine's user agent and
// robots.txt rules, read them without JavaScript, score each against the prompt, and say where yours falls short.

import { classifyPrompt, ENGINE_NOTES, nameOf, type FactorId, type PageScore, type Simulation } from "@/lib/aeo";
import type { AiEngine } from "@/lib/research-types";
import { fetchAs } from "@/lib/server/fetch-bundle";
import { explainWin, llmConfigured } from "./llm";
import { FACTOR_IDS, fixFor, parsePage, scorePage, terms, type ParsedPage } from "./page";
import { allowed, parseRobots, type RobotsRules } from "./robots";

/** The crawler that indexes for an engine, and the one that fetches a page while answering. */
const AGENTS: Record<AiEngine, { crawlerId: string; crawler: string; fetcherId: string; fetcher: string; token: string; extraToken?: string }> = {
  chatgpt: { crawlerId: "oai-searchbot", crawler: "OAI-SearchBot", fetcherId: "chatgpt-user", fetcher: "ChatGPT-User", token: "OAI-SearchBot" },
  claude: { crawlerId: "claude-searchbot", crawler: "Claude-SearchBot", fetcherId: "claude-user", fetcher: "Claude-User", token: "Claude-SearchBot" },
  perplexity: { crawlerId: "perplexitybot", crawler: "PerplexityBot", fetcherId: "perplexity-user", fetcher: "Perplexity-User", token: "PerplexityBot" },
  gemini: { crawlerId: "googlebot", crawler: "Googlebot", fetcherId: "googlebot", fetcher: "Googlebot", token: "Googlebot", extraToken: "Google-Extended" },
  google: { crawlerId: "googlebot", crawler: "Googlebot", fetcherId: "googlebot", fetcher: "Googlebot", token: "Googlebot" },
};

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const robotsCache = new Map<string, Promise<RobotsRules>>();
function robotsFor(origin: string): Promise<RobotsRules> {
  let p = robotsCache.get(origin);
  if (!p) {
    p = fetchAs(`${origin}/robots.txt`, "browser", 300_000)
      .then((r) => (r.status === 200 ? parseRobots(r.html) : { groups: [] }))
      .catch(() => ({ groups: [] }));
    robotsCache.set(origin, p);
    if (robotsCache.size > 200) robotsCache.delete(robotsCache.keys().next().value!);
  }
  return p;
}

interface Fetched {
  url: string;
  status: number;
  blocked: boolean;
  page: ParsedPage;
}

async function fetchForEngine(url: string, engine: AiEngine): Promise<Fetched | null> {
  const a = AGENTS[engine];
  try {
    const u = new URL(url);
    const rules = await robotsFor(u.origin);
    const blocked = !allowed(rules, a.token, u.pathname + u.search) || (!!a.extraToken && !allowed(rules, a.extraToken, u.pathname));
    const r = await fetchAs(url, a.fetcherId);
    return { url: r.finalUrl || url, status: r.status, blocked, page: parsePage(r.html, host(r.finalUrl || url), r.contentType) };
  } catch {
    return null;
  }
}

/** Your URLs from the sitemap whose path looks like the prompt; the home page always included. */
async function candidateUrls(domain: string, prompt: string): Promise<string[]> {
  const origin = `https://${domain}`;
  const urls = new Set<string>();
  const readSitemap = async (u: string, depth: number) => {
    if (urls.size > 2000) return;
    const r = await fetchAs(u, "browser", 1_000_000).catch(() => null);
    if (!r || r.status !== 200) return;
    const locs = [...r.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (/<sitemapindex/i.test(r.html) && depth < 1) {
      await Promise.all(locs.slice(0, 6).map((l) => readSitemap(l, depth + 1)));
    } else {
      locs.forEach((l) => host(l).endsWith(domain) && urls.add(l));
    }
  };
  const robots = await fetchAs(`${origin}/robots.txt`, "browser", 300_000).catch(() => null);
  const listed = robots?.status === 200 ? [...robots.html.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]).slice(0, 3) : [];
  await Promise.all((listed.length ? listed : [`${origin}/sitemap.xml`]).map((s) => readSitemap(s, 0)));
  const ts = terms(prompt);
  const scored = [...urls]
    .map((u) => {
      const path = decodeURIComponent(new URL(u).pathname).toLowerCase().replace(/[-_/]+/g, " ");
      return { u, s: ts.filter((t) => path.includes(t)).length };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.u.length - b.u.length)
    .slice(0, 4)
    .map((x) => x.u);
  return [...new Set([...scored, `${origin}/`])];
}

export interface SimulateInput {
  prompt: string;
  engine: AiEngine;
  domain: string;
  brand: string;
  competitors: string[];
  /** URLs the engine cited in its answer. */
  cited: string[];
  /** Force your page (else: the cited one on your domain, else the best match from the sitemap). */
  yourUrl?: string;
  explain?: boolean;
}

export async function simulate(input: SimulateInput): Promise<Simulation> {
  const type = classifyPrompt(input.prompt, input.brand);
  const a = AGENTS[input.engine];
  if (!a) throw new Error(`Unknown engine: ${input.engine}`);
  const brandNames = [input.brand, ...input.competitors.map(nameOf)].filter(Boolean);
  const mine = (u: string) => host(u) === input.domain || host(u).endsWith(`.${input.domain}`);

  const citedYours = input.cited.find(mine);
  const candidates = input.yourUrl ? [input.yourUrl] : citedYours ? [citedYours] : await candidateUrls(input.domain, input.prompt);
  const theirs = [...new Set(input.cited.filter((u) => !mine(u)))].slice(0, 3);

  const [yourPages, citedPages] = await Promise.all([
    Promise.all(candidates.map((u) => fetchForEngine(u, input.engine))),
    Promise.all(theirs.map((u) => fetchForEngine(u, input.engine))),
  ]);

  const score = (f: Fetched) => scorePage(f.page, { url: f.url, status: f.status, blockedByRobots: f.blocked }, input.prompt, type, brandNames);
  // The page meant to answer this prompt: the URL and the content match it, not just the best page overall.
  const ts = terms(input.prompt);
  const fit = (x: { f: Fetched; s: PageScore }) => {
    const path = decodeURIComponent(new URL(x.f.url).pathname).toLowerCase();
    return ts.filter((t) => path.includes(t)).length * 15 + x.s.factors.relevance * 0.5 + x.s.factors.answerFirst * 0.3 + x.s.factors.coverage * 0.2;
  };
  const yours = yourPages
    .filter((x): x is Fetched => !!x)
    .map((f) => ({ f, s: score(f) }))
    .sort((x, y) => fit(y) - fit(x));
  const cited = citedPages.filter((x): x is Fetched => !!x).map((f) => ({ f, s: score(f) }));
  const you = yours[0] ?? null;

  // Pages we couldn't read (Reddit, G2 and others refuse unverified crawlers) say nothing about why they won:
  // the engines may have their own access or licensing deals. Compare only with pages we could read.
  const readable = cited.filter((c) => c.s.status >= 200 && c.s.status < 300 && c.s.words >= 150);
  const gaps: Simulation["gaps"] = [];
  if (you && readable.length) {
    for (const k of FACTOR_IDS as FactorId[]) {
      const them = Math.round(readable.reduce((s, c) => s + c.s.factors[k], 0) / readable.length);
      if (them - you.s.factors[k] >= 15 || (k === "access" && you.s.factors.access < 100)) gaps.push({ factor: k, you: you.s.factors[k], them, fix: fixFor(k, type, you.s) });
    }
    gaps.sort((x, y) => y.them - y.you - (x.them - x.you));
  } else if (you) {
    for (const k of FACTOR_IDS as FactorId[]) if (you.s.factors[k] < 50) gaps.push({ factor: k, you: you.s.factors[k], them: 0, fix: fixFor(k, type, you.s) });
  }

  const notes: string[] = [];
  // What a browser gets for the same page: sites that serve agents Markdown or a lighter page can drop content.
  if (you && you.s.status === 200) {
    const browser = await fetchAs(you.f.url, "browser").catch(() => null);
    if (browser?.status === 200) {
      const b = parsePage(browser.html, host(you.f.url), browser.contentType);
      if (b.words >= 200 && you.s.words < b.words * 0.6) {
        notes.push(
          `${a.fetcher} gets ${you.s.words} words from this page; a browser gets ${b.words}${b.tables > you.f.page.tables ? ` and ${b.tables} ${b.tables === 1 ? "table" : "tables"}` : ""}. The version AI agents read is missing content, so it scores lower than the page people see. Make the agent version complete.`,
        );
      }
    }
  }
  if (you?.s.format === "markdown") {
    notes.push(
      `Your site serves Markdown to ${a.fetcher}, not HTML. That's good for reading, but JSON-LD schema and on-page dates don't come with it${you.s.updated ? "" : ": add an updated date to the Markdown front matter"} and keep the facts (pricing, versions) in the text.`,
    );
  }
  if (you && you.s.factors.access < 100 && you.s.status === 200 && !you.s.blockedByRobots && you.s.words < 150) {
    notes.push(`${a.fetcher} got only ${you.s.words} words: most of the page is rendered by JavaScript, which AI crawlers don't run.`);
  }
  const gone = cited.filter((c) => c.s.status === 404 || c.s.status === 410);
  if (gone.length) notes.push(`${gone.map((c) => c.s.url).join(", ")} no longer ${gone.length === 1 ? "exists" : "exist"} (HTTP ${gone[0].s.status}): the engine cited a stale page. A current page on the same topic can take its place.`);
  const unreadable = cited.filter((c) => (c.s.status < 200 || c.s.status >= 300) && c.s.status !== 404 && c.s.status !== 410);
  if (unreadable.length) {
    notes.push(
      `Couldn't read ${unreadable.map((c) => `${host(c.s.url)} (HTTP ${c.s.status}${c.s.blockedByRobots ? ", robots.txt blocks this crawler" : ""})`).join(", ")}. Many forums and review sites refuse unverified crawlers, so these are left out of the comparison: the engine may reach them through its own access or partnerships.`,
    );
  }
  for (const c of cited) if (c.s.words < 150 && c.s.status === 200) notes.push(`${host(c.s.url)} also renders mostly with JavaScript (${c.s.words} words without it), so it's probably cited from other signals (its brand, links, or a search index), not its text.`);

  const out: Simulation = {
    prompt: input.prompt,
    type,
    engine: input.engine,
    agent: { crawler: a.crawler, fetcher: a.fetcher, note: ENGINE_NOTES[input.engine] },
    you: you?.s ?? null,
    candidates: yours.map((y) => ({ url: y.s.url, score: y.s.total })),
    cited: cited.map((c) => c.s),
    gaps,
    notes,
  };

  if (input.explain && llmConfigured()) {
    try {
      out.llm = await explainWin({
        prompt: input.prompt,
        engine: input.engine,
        brand: input.brand,
        you: you ? { score: you.s, text: bestText(you.f.page, input.prompt) } : null,
        cited: cited.map((c) => ({ score: c.s, text: bestText(c.f.page, input.prompt) })),
      });
    } catch (e) {
      out.llm = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

/** The page's text with the sections that match the prompt first, so a truncated copy keeps what matters. */
function bestText(p: ParsedPage, prompt: string): string {
  const ts = terms(prompt);
  const ranked = [...p.sections].sort((a, b) => {
    const c = (s: typeof a) => ts.filter((t) => `${s.heading} ${s.text}`.toLowerCase().includes(t)).length;
    return c(b) - c(a) || a.position - b.position;
  });
  return [`Headings: ${p.headings.slice(0, 25).join(" | ")}`, ...ranked.map((s) => `### ${s.heading}\n${s.text}`)].join("\n\n");
}

export type { PageScore };
