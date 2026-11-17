// Turns a site's traffic into things to do: what to change so AI answers read and cite it, so more people
// arrive, and so fewer requests fail. Pure: it only reads TrafficStats, so it runs in the browser.

import { AI_KINDS, DIRECT, INTERNAL, agentMeta, sourceMeta, type PageStat, type TrafficStats } from "@/lib/traffic";

export type InsightArea = "ai" | "people" | "errors";
export type InsightLevel = "high" | "medium" | "low" | "good";

export interface Insight {
  id: string;
  area: InsightArea;
  level: InsightLevel;
  title: string;
  /** What the numbers show, in one or two sentences. */
  why: string;
  /** What to do, in order. */
  steps: string[];
  /** The pages it's about, with a short note each. */
  paths?: { path: string; note: string }[];
  action?: { label: string; href: string; external?: boolean };
}

export const AREA_LABEL: Record<InsightArea, string> = { ai: "AI visibility", people: "People", errors: "Errors" };
const LEVEL_ORDER: Record<InsightLevel, number> = { high: 0, medium: 1, low: 2, good: 3 };

/** The crawlers AI answers depend on: without their visit, the page can't be quoted or linked. */
const ANSWER_CRAWLERS: { id: string; engine: string }[] = [
  { id: "oai-searchbot", engine: "ChatGPT search" },
  { id: "claude-searchbot", engine: "Claude's web search" },
  { id: "perplexitybot", engine: "Perplexity" },
];
const SEARCH_SOURCES = ["google", "bing", "duckduckgo", "yahoo", "yandex", "ecosia", "brave"];

const n = (v: number) => v.toLocaleString();
const pctOf = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const change = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 100) : 0);
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** A page on the site, for links to the audit. */
const pageUrl = (domain: string, path: string) => `https://${domain}${path === "/" ? "" : path}`;
const audit = (domain: string, path: string, tab: string) => `/audit?url=${encodeURIComponent(pageUrl(domain, path))}&tab=${tab}`;

export function trafficInsights(stats: TrafficStats, domain: string, statusKnown: boolean): Insight[] {
  const out: Insight[] = [];
  const t = stats.totals;
  const p = stats.previous.totals;
  const days = stats.days;
  const aiCrawls = AI_KINDS.reduce((s, k) => s + t[k], 0);
  const aiRefs = stats.daily.reduce((s, d) => s + d.aiReferrals, 0);
  const hitsOf = (id: string) => stats.agents.filter((a) => a.agent === id).reduce((s, a) => s + a.hits, 0);
  // Pages that mostly fail belong in Errors, not in "make this page more visible".
  const pages = stats.pages.filter((x) => x.errors * 2 < x.people + x.aiAnswerCrawls + x.aiTrainingCrawls + x.searchCrawls);
  // Below this, a missing visit says little.
  const enoughData = t.human + aiCrawls + t.search >= 50;

  // ------------------------------------------------------------- AI visibility

  if (enoughData) {
    const missing = ANSWER_CRAWLERS.filter((c) => hitsOf(c.id) === 0);
    if (missing.length) {
      out.push({
        id: "ai-missing-crawlers",
        area: "ai",
        level: missing.some((c) => c.id === "oai-searchbot") ? "high" : "medium",
        title: missing.length === 1 ? `${agentMeta(missing[0].id).name} hasn't visited in ${days} days` : `${plural(missing.length, "AI search crawler")} haven't visited in ${days} days`,
        why: `${missing.map((c) => c.engine).join(", ")} only ${missing.length === 1 ? "cites pages its" : "cite pages their"} crawler has read. No visit at all usually means robots.txt or a firewall turns it away.`,
        steps: [
          `Allow ${missing.map((c) => agentMeta(c.id).name).join(", ")} in robots.txt (they're separate from the training crawlers, so you can allow these and still block GPTBot or ClaudeBot).`,
          "On Cloudflare, check Security → Bots and AI Crawl Control: \"Block AI bots\" and Bot Fight Mode stop them too.",
          "Then check the crawler access matrix: it fetches your page as each crawler.",
        ],
        action: { label: "Check crawler access", href: audit(domain, "/", "crawlers") },
      });
    }

    const crawledFor = (x: PageStat) => x.aiAnswerCrawls + x.aiTrainingCrawls;
    const minPeople = Math.max(5, t.human * 0.01);
    const unread = pages.filter((x) => x.people >= minPeople && crawledFor(x) === 0).sort((a, b) => b.people - a.people).slice(0, 8);
    if (unread.length && aiCrawls > 0) {
      out.push({
        id: "ai-unread-pages",
        area: "ai",
        level: "medium",
        title: `AI crawlers skip ${plural(unread.length, "popular page")}`,
        why: "People visit these, but no AI crawler fetched them in this period, so AI answers can't quote them.",
        steps: [
          "Link to them from pages AI crawlers already read (see \"Pages AI crawlers read\" below).",
          "List them in sitemap.xml with an accurate lastmod, and in llms.txt if you have one.",
          "Make sure the content is in the HTML, not only rendered by JavaScript: AI crawlers don't run scripts.",
        ],
        paths: unread.map((x) => ({ path: x.path, note: `${n(x.people)} people` })),
        action: { label: "Check how the top one renders", href: audit(domain, unread[0].path, "rendering") },
      });
    }

    const uncited = pages.filter((x) => x.aiAnswerCrawls >= 5 && x.aiReferrals === 0).sort((a, b) => b.aiAnswerCrawls - a.aiAnswerCrawls).slice(0, 8);
    if (uncited.length) {
      out.push({
        id: "ai-uncited-pages",
        area: "ai",
        level: "medium",
        title: `AI answers read ${plural(uncited.length, "page")} but send no one`,
        why: "AI search and live-fetch crawlers fetched these, yet no visitor arrived from an AI answer. They're read, not cited, or cited without a link worth clicking.",
        steps: [
          "Answer the question the page targets in its first paragraph, in plain words.",
          "Add specifics an answer can quote: numbers, dates, named steps, a short comparison table.",
          "Use headings phrased as the questions people ask, and add FAQ or HowTo schema where it fits.",
          "Run the AI-citation check on the page for a scored list.",
        ],
        paths: uncited.map((x) => ({ path: x.path, note: `read ${n(x.aiAnswerCrawls)} times` })),
        action: { label: "Check citation readiness", href: audit(domain, uncited[0].path, "geo") },
      });
    }

    const bing = hitsOf("bingbot");
    const google = hitsOf("googlebot");
    if (google >= 20 && bing < google * 0.1) {
      out.push({
        id: "ai-bing",
        area: "ai",
        level: "medium",
        title: bing ? "Bing barely crawls your site" : "Bing hasn't crawled your site",
        why: `Bingbot: ${n(bing)} page loads, Googlebot: ${n(google)}. ChatGPT search and Microsoft Copilot draw on Bing's index, so pages Bing hasn't seen are less likely to show up in them.`,
        steps: [
          "Add the site to Bing Webmaster Tools (you can import it from Google Search Console) and submit your sitemap.",
          "Turn on IndexNow so new and changed pages reach Bing right away (on Cloudflare: Caching → Configuration → Crawler Hints).",
        ],
        action: { label: "Open Bing Webmaster Tools", href: "https://www.bing.com/webmasters", external: true },
      });
    }

    if (days <= 30) {
      const stale = stats.agents.filter((a) => AI_KINDS.includes(a.kind) && a.hits >= 5 && Date.now() / 3_600_000 - a.lastHour > 24 * 7);
      if (stale.length) {
        out.push({
          id: "ai-stopped",
          area: "ai",
          level: "medium",
          title: `${stale.map((a) => agentMeta(a.agent).name).join(", ")} stopped visiting`,
          why: "These crawlers came earlier in this period but not in the last week. A new robots.txt rule, firewall rule or a run of errors often causes it.",
          steps: ["Check what changed in robots.txt and your firewall around the time they stopped.", "Look for errors they got in the Errors tab."],
          action: { label: "Check crawler access", href: audit(domain, "/", "crawlers") },
        });
      }
    }

    const prevAnswerCrawls = p.ai_search + p.ai_user;
    const answerCrawls = t.ai_search + t.ai_user;
    if (prevAnswerCrawls >= 20 && change(answerCrawls, prevAnswerCrawls) <= -30) {
      out.push({
        id: "ai-crawls-down",
        area: "ai",
        level: "medium",
        title: `AI search crawls fell ${-change(answerCrawls, prevAnswerCrawls)}%`,
        why: `${n(answerCrawls)} in the last ${days} days against ${n(prevAnswerCrawls)} the ${days} days before.`,
        steps: ["Check robots.txt and firewall changes.", "Keep publishing and updating pages: answer engines revisit sites that change."],
        action: { label: "Check crawler access", href: audit(domain, "/", "crawlers") },
      });
    }
  }

  if (stats.previous.aiReferrals >= 10) {
    const c = change(aiRefs, stats.previous.aiReferrals);
    if (c <= -20) {
      out.push({
        id: "ai-referrals-down",
        area: "ai",
        level: "medium",
        title: `Visits from AI answers fell ${-c}%`,
        why: `${n(aiRefs)} people came from ChatGPT, Perplexity, Claude, Gemini or Copilot in the last ${days} days, ${n(stats.previous.aiReferrals)} the ${days} days before.`,
        steps: ["Track the prompts you care about in AI visibility to see where you dropped out.", "Refresh the pages that used to get these visits (see People)."],
        action: { label: "Open AI visibility", href: "/ai-visibility" },
      });
    } else if (c >= 20) {
      out.push({
        id: "ai-referrals-up",
        area: "ai",
        level: "good",
        title: `Visits from AI answers are up ${c}%`,
        why: `${n(aiRefs)} against ${n(stats.previous.aiReferrals)} the ${days} days before. Keep the pages they land on current.`,
        steps: [],
      });
    }
  }

  if (!out.some((i) => i.area === "ai") && aiCrawls > 0) {
    out.push({
      id: "ai-ok",
      area: "ai",
      level: "good",
      title: "AI crawlers can read your site",
      why: `${n(aiCrawls)} AI crawler page loads and ${n(aiRefs)} visits from AI answers, with no gaps found.`,
      steps: [],
    });
  }

  // ------------------------------------------------------------------ people

  const fromSearch = stats.sources.filter((s) => SEARCH_SOURCES.includes(s.source)).reduce((a, s) => a + s.hits, 0);
  const external = stats.sources.filter((s) => s.source !== INTERNAL).reduce((a, s) => a + s.hits, 0);

  const landings = new Map<string, { hits: number; sources: Set<string> }>();
  for (const l of stats.aiLandings) {
    const e = landings.get(l.path) ?? { hits: 0, sources: new Set<string>() };
    e.hits += l.hits;
    e.sources.add(sourceMeta(l.source).label);
    landings.set(l.path, e);
  }
  const front = [...landings].sort((a, b) => b[1].hits - a[1].hits).slice(0, 6);
  if (front.length) {
    out.push({
      id: "people-ai-landings",
      area: "people",
      level: "low",
      title: "Make your AI landing pages convert",
      why: `${plural(front.length, "page")} receive the people AI answers send. They arrive with a specific question, so the page has to answer it at once and show the next step.`,
      steps: [
        "Check the answer the AI quoted is near the top and still correct.",
        "Add one clear next step (try it, read the guide, pricing) above the fold.",
        "Keep these pages fast and current: answer engines re-check them.",
      ],
      paths: front.map(([path, e]) => ({ path, note: `${n(e.hits)} from ${[...e.sources].join(", ")}` })),
      action: { label: "Audit the top one", href: audit(domain, front[0][0], "overview") },
    });
  }

  if (external >= 100 && pctOf(fromSearch, external) < 15) {
    out.push({
      id: "people-low-search",
      area: "people",
      level: "medium",
      title: `Only ${pctOf(fromSearch, external)}% of visitors come from search engines`,
      why: `${n(fromSearch)} of ${n(external)} people who came from outside the site found it through Google, Bing or another search engine.`,
      steps: ["Find the queries you could rank for in Keywords and Keyword gap.", "Track them in Rank tracking and work on the pages that are close to page one."],
      action: { label: "Find keywords", href: "/keywords" },
    });
  }

  const unindexed = pages
    .filter((x) => x.people >= Math.max(5, t.human * 0.01) && x.searchCrawls === 0)
    .sort((a, b) => b.people - a.people)
    .slice(0, 8);
  if (unindexed.length && t.search > 0) {
    out.push({
      id: "people-uncrawled",
      area: "people",
      level: "medium",
      title: `Search engines skip ${plural(unindexed.length, "popular page")}`,
      why: "People visit these, but Googlebot and Bingbot didn't fetch them in this period, so they may be missing or stale in search results.",
      steps: ["Add them to sitemap.xml and link to them from other pages.", "Check they aren't noindex or canonicalised to another page.", "Request indexing in Google Search Console for the important ones."],
      paths: unindexed.map((x) => ({ path: x.path, note: `${n(x.people)} people` })),
      action: { label: "Audit the top one", href: audit(domain, unindexed[0].path, "issues") },
    });
  }

  if (p.human >= 50) {
    const c = change(t.human, p.human);
    if (c <= -20 || c >= 20) {
      out.push({
        id: c < 0 ? "people-down" : "people-up",
        area: "people",
        level: c < 0 ? "medium" : "good",
        title: `People ${c < 0 ? "down" : "up"} ${Math.abs(c)}% on the previous ${days} days`,
        why: `${n(t.human)} against ${n(p.human)}.${c < 0 ? " Compare \"Where people came from\" with the period before to find the source that dropped." : ""}`,
        steps: [],
      });
    }
  }

  const direct = stats.sources.find((s) => s.source === DIRECT)?.hits ?? 0;
  if (!out.some((i) => i.area === "people") && t.human > 0) {
    out.push({
      id: "people-ok",
      area: "people",
      level: "good",
      title: "Nothing stands out",
      why: `${n(t.human)} people: ${pctOf(fromSearch, external)}% from search, ${pctOf(direct, t.human)}% direct, ${pctOf(aiRefs, t.human)}% from AI answers.`,
      steps: [],
    });
  }

  // ------------------------------------------------------------------ errors

  if (!statusKnown) {
    out.push({
      id: "errors-unknown",
      area: "errors",
      level: "low",
      title: "Errors aren't reported",
      why: "This collector can't see response statuses (the Next.js proxy runs before your pages render), so blocked crawlers and broken pages don't show up.",
      steps: ["Use the Cloudflare Worker route in front of your site instead: it sees every status. Pick \"Reinstall or move\" above."],
    });
    return sort(out);
  }

  const blocked = new Map<string, { hits: number; statuses: Set<number> }>();
  for (const f of stats.failures) {
    if (f.status !== 403 && f.status !== 429) continue;
    const e = blocked.get(f.agent) ?? { hits: 0, statuses: new Set<number>() };
    e.hits += f.hits;
    e.statuses.add(f.status);
    blocked.set(f.agent, e);
  }
  if (blocked.size) {
    const list = [...blocked].sort((a, b) => b[1].hits - a[1].hits);
    out.push({
      id: "errors-blocked",
      area: "errors",
      level: "high",
      title: `${list.map(([a]) => agentMeta(a).name).slice(0, 3).join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""} ${list.length === 1 ? "is" : "are"} being blocked`,
      why: "A 403 or 429 for a crawler means a firewall, bot protection or rate limit turned it away. If robots.txt allows it, the block is almost certainly unintended.",
      steps: [
        "On Cloudflare: Security → Bots (Bot Fight Mode, \"Block AI bots\"), Security → WAF custom and rate limiting rules, and AI Crawl Control.",
        "Allow verified bots, or add a skip rule for the crawlers you want.",
        "Then re-check access as each crawler.",
      ],
      paths: list.map(([a, e]) => ({ path: agentMeta(a).name, note: `${[...e.statuses].join(", ")} × ${n(e.hits)}` })),
      action: { label: "Check crawler access", href: audit(domain, "/", "crawlers") },
    });
  }

  const all = [...stats.failures.map((f) => ({ ...f, who: agentMeta(f.agent).name })), ...stats.visitorFailures.map((f) => ({ ...f, who: f.kind === "human" ? "people" : agentMeta(f.agent).name }))];
  const byPath = (rows: typeof all) => {
    const m = new Map<string, { hits: number; who: Set<string>; statuses: Set<number> }>();
    for (const r of rows) {
      const e = m.get(r.path) ?? { hits: 0, who: new Set<string>(), statuses: new Set<number>() };
      e.hits += r.hits;
      e.who.add(r.who);
      e.statuses.add(r.status);
      m.set(r.path, e);
    }
    return [...m].sort((a, b) => b[1].hits - a[1].hits).slice(0, 8).map(([path, e]) => ({ path, note: `${[...e.statuses].join(", ")} × ${n(e.hits)} · ${[...e.who].slice(0, 3).join(", ")}` }));
  };

  const server = all.filter((r) => r.status >= 500);
  if (server.length) {
    const total = server.reduce((s, r) => s + r.hits, 0);
    out.push({
      id: "errors-5xx",
      area: "errors",
      level: "high",
      title: `${n(total)} server ${total === 1 ? "error" : "errors"}`,
      why: "A 5xx tells people the site is broken and tells crawlers to come back later; repeated, they crawl less and may drop the page.",
      steps: ["Look up these paths in your server or Workers logs for the failing request.", "Check for timeouts to your origin or an API the page depends on."],
      paths: byPath(server),
    });
  }

  const missing = all.filter((r) => r.status === 404 || r.status === 410);
  if (missing.length) {
    const total = missing.reduce((s, r) => s + r.hits, 0);
    out.push({
      id: "errors-404",
      area: "errors",
      level: missing.some((r) => r.kind === "human") ? "medium" : "low",
      title: `${n(total)} requests for pages that don't exist`,
      why: "People and crawlers still ask for these paths, from old links, a stale sitemap or a moved page.",
      steps: [
        "Add a 301 redirect from each path to the closest live page.",
        "Remove them from sitemap.xml and fix internal links that point at them (Site crawl lists broken links).",
      ],
      paths: byPath(missing),
      action: { label: "Find broken links", href: "/site-audit" },
    });
  }

  const previews = stats.visitorFailures.filter((f) => f.kind === "preview");
  if (previews.length) {
    out.push({
      id: "errors-previews",
      area: "errors",
      level: "medium",
      title: "Link previews fail",
      why: `${[...new Set(previews.map((f) => agentMeta(f.agent).name))].join(", ")} got errors fetching your pages, so links shared there show no title or image.`,
      steps: ["Allow these bots past bot protection.", "Check the Previews tab for the page's Open Graph tags."],
      paths: byPath(previews.map((f) => ({ ...f, who: agentMeta(f.agent).name }))),
      action: { label: "Check previews", href: audit(domain, previews[0].path, "previews") },
    });
  }

  if (!out.some((i) => i.area === "errors")) {
    out.push({ id: "errors-ok", area: "errors", level: "good", title: "No errors", why: "No crawler, preview bot or person got an error in this period.", steps: [] });
  }

  return sort(out);
}

const sort = (xs: Insight[]) => xs.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

/** Counts of things to fix (not counting good news) per area. */
export function openCount(xs: Insight[], area: InsightArea): number {
  return xs.filter((i) => i.area === area && i.level !== "good").length;
}

