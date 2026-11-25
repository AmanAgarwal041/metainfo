// Tools exposed to AI assistants over MCP (app/api/mcp). Each wraps the same
// server functions the UI's API routes use, and returns compact JSON text.

import { buildBundle } from "@/lib/server/fetch-bundle";
import { analyzeOnServer, validateSchemaOnServer } from "@/lib/server/engine";
import { validateUrl } from "@/lib/server/schema";
import { flattenIssues, itemLabel } from "@/lib/schema-utils";
import type { SchemaReport } from "@/lib/types";
import { askEngine } from "@/lib/server/research/ai";
import { backlinkResearch } from "@/lib/server/research/backlinks";
import { competitorResearch } from "@/lib/server/research/competitors";
import { keywordGap } from "@/lib/server/research/gap";
import { keywordResearch } from "@/lib/server/research/keywords";
import { serpCheck } from "@/lib/server/research/serp";
import { LOCATIONS, type AiEngine, type Location } from "@/lib/research-types";
import { analyzeAnswer } from "@/lib/aeo";
import { fixesPrompt, fromCheck } from "@/lib/fix-prompts";
import { aiVisibilityCheck, brandsFrom, simulateCitation, suggestPrompts } from "./mcp-aeo";
import { inspectUrl, listSites, matchSite, serviceAccountAuth, serviceAccountConfigured, validSite, OPPORTUNITY_LABELS, type GscAuth } from "./gsc";
import { buildReport, parseReportParams } from "./gsc-report";

type Args = Record<string, unknown>;

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** Whether it spends DataForSEO credit. */
  paid: boolean;
  /** Listed only when this returns true (e.g. needs server configuration). */
  available?: () => boolean;
  /** Hints for clients (MCP 2025-03-26+). Every tool here reads public data and changes nothing. */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: Args) => Promise<unknown>;
}

const locationProp = {
  type: "string",
  description: `Market: country name or 2-letter code (${LOCATIONS.map((l) => l.gl).join(", ")}). Default: United States.`,
};

function location(v: unknown): Location {
  const s = String(v ?? "").trim().toLowerCase();
  return LOCATIONS.find((l) => l.name.toLowerCase() === s || l.gl === s || String(l.code) === s) ?? LOCATIONS[0];
}

function str(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`"${key}" is required`);
  return v.trim();
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export const TOOLS: McpTool[] = [
  {
    name: "audit_page",
    title: "Audit a page for SEO and AI visibility",
    description:
      "Fetch a URL and run 55+ checks covering Google/Bing indexability, meta tags, Open Graph, structured data, content, performance, robots.txt, sitemap, llms.txt and AI-crawler access (GPTBot, ClaudeBot, PerplexityBot...). Returns per-platform scores (Google, Bing, ChatGPT, Perplexity, Claude, Gemini, social), failing checks with fixes, and optionally generated head tags, JSON-LD, robots.txt and llms.txt. Free.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Page URL, e.g. https://example.com/pricing" },
        include_generated: { type: "boolean", description: "Also return generated <head>, JSON-LD, robots.txt and llms.txt" },
        include_fix_prompt: { type: "boolean", description: "Also return fix_prompt: one short prompt a coding agent can apply to fix the failing checks, most important first" },
      },
      required: ["url"],
    },
    paid: false,
    run: async (a) => {
      const report = await analyzeOnServer(await buildBundle(str(a, "url")));
      const failing = report.checks.filter((c) => c.status === "fail" || c.status === "warn");
      const rankSev = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as Record<string, number>;
      return {
        url: report.finalUrl,
        status: report.status,
        overall: report.summary.overall,
        scores: Object.fromEntries(report.scores.map((s) => [s.platform, s.score])),
        summary: report.summary,
        issues: report.checks
          .filter((c) => c.status === "fail" || c.status === "warn")
          .map((c) => ({ id: c.id, status: c.status, severity: c.severity, title: c.title, finding: c.finding, fix: c.recommendation, snippet: c.snippet })),
        blocked_crawlers: report.crawlers.filter((c) => !c.allowed).map((c) => c.name),
        topics: report.page.topics.slice(0, 20).map((t) => t.term),
        ai_citation_readiness: report.geo && {
          geo_score: report.geo.score,
          citability: { grade: report.geo.citability.grade, score: report.geo.citability.score, rewrite_first: report.geo.citability.bottom.map((p) => ({ heading: p.heading, score: p.score })) },
          unanswered_questions: report.geo.answers.unanswered,
          unsourced_claims: report.geo.evidence.uncitedExamples,
          freshness: report.geo.freshness.tier,
        },
        ...(a.include_generated ? { generated: report.generated } : {}),
        ...(a.include_fix_prompt && failing.length
          ? { fix_prompt: fixesPrompt([...failing].sort((x, y) => (rankSev[x.severity] ?? 9) - (rankSev[y.severity] ?? 9)).map(fromCheck), { site: report.finalUrl, source: "page audit" }) }
          : {}),
      };
    },
  },
  {
    name: "validate_schema",
    title: "Validate structured data (schema.org)",
    description:
      "Validate a page's structured data like validator.schema.org: extracts JSON-LD, Microdata and RDFa, and reports unknown types and properties (with suggested fixes), properties used on the wrong type, malformed dates/URLs/numbers/enumeration values and superseded terms. Also checks Google rich-result requirements (Product, Article, Breadcrumb, Event, Recipe, JobPosting, LocalBusiness...) and whether names, prices and ratings in the markup are visible on the page. Pass a url, or html to validate a snippet. Free.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Page URL to fetch and validate" },
        html: { type: "string", description: "Alternatively, an HTML page or a <script type=\"application/ld+json\"> snippet" },
      },
    },
    paid: false,
    run: async (a) => {
      const compact = (r: SchemaReport) => ({
        schema_org_version: r.vocabVersion,
        items: r.items.map((i) => ({ type: itemLabel(i), format: i.format, errors: i.errors, warnings: i.warnings })),
        errors: r.errors,
        warnings: r.warnings,
        issues: flattenIssues(r).slice(0, 60).map(({ severity, path, message }) => ({ severity, at: path, message })),
        rich_results: r.richResults.map((x) => ({ feature: x.feature, status: x.status, missing_required: x.missingRequired, missing_recommended: x.missingRecommended, note: x.note ?? undefined })),
        not_visible_on_page: r.notVisible,
      });
      if (typeof a.html === "string" && a.html.trim()) return compact(validateSchemaOnServer(a.html));
      const res = await validateUrl(str(a, "url"));
      return {
        url: res.finalUrl,
        status: res.status,
        raw_html: compact(res.raw),
        ...(res.rendered ? { rendered_dom: compact(res.rendered) } : {}),
        ...(res.renderError ? { render_error: res.renderError } : {}),
        ...(res.warning ? { warning: res.warning } : {}),
      };
    },
  },
  {
    name: "keyword_ideas",
    title: "Keyword research",
    description:
      "Expand a seed keyword into long-tail ideas (Google Autocomplete, free). With DataForSEO configured, adds search volume, difficulty (0-100), CPC and intent.",
    inputSchema: {
      type: "object",
      properties: { seed: { type: "string" }, location: locationProp, limit: { type: "number", description: "Max keywords (default 100)" } },
      required: ["seed"],
    },
    paid: true,
    run: async (a) => {
      const r = await keywordResearch(str(a, "seed"), location(a.location));
      const limit = Math.min(Number(a.limit) || 100, 500);
      return {
        seed: r.seed,
        provider: r.provider,
        seed_metrics: r.seedMetrics,
        cost_usd: r.cost,
        keywords: r.keywords.slice(0, limit).map((k) => ({ keyword: k.keyword, volume: k.volume, difficulty: k.difficulty, cpc: k.cpc, intent: k.intent, group: k.group })),
      };
    },
  },
  {
    name: "serp_check",
    title: "Live Google results for a keyword",
    description:
      "Top 20 Google results, SERP features, AI Overview sources, featured snippet owner, People also ask and related searches. Requires DataForSEO.",
    inputSchema: {
      type: "object",
      properties: { keyword: { type: "string" }, location: locationProp, device: { type: "string", enum: ["desktop", "mobile"] } },
      required: ["keyword"],
    },
    paid: true,
    run: async (a) => serpCheck(str(a, "keyword"), String(a.device ?? "desktop"), location(a.location)),
  },
  {
    name: "keyword_gap",
    title: "Keyword gap vs competitors",
    description:
      "Keywords competitors rank for that the target domain doesn't (missing), where they outrank it (weak), and where it leads (strong). Requires DataForSEO.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Your domain" },
        competitors: { type: "array", items: { type: "string" }, description: "Up to 3 competitor domains" },
        location: locationProp,
      },
      required: ["domain", "competitors"],
    },
    paid: true,
    run: async (a) => {
      const r = await keywordGap(str(a, "domain"), list(a.competitors), location(a.location));
      return { ...r, rows: r.rows.slice(0, 150) };
    },
  },
  {
    name: "find_competitors",
    title: "Organic competitors",
    description: "Domains competing for the same Google keywords, with keyword overlap and estimated traffic. Requires DataForSEO.",
    inputSchema: { type: "object", properties: { domain: { type: "string" }, location: locationProp }, required: ["domain"] },
    paid: true,
    run: async (a) => competitorResearch(str(a, "domain"), location(a.location)),
  },
  {
    name: "ask_ai_engine",
    title: "Ask an AI engine and check brand visibility",
    description:
      "Send a prompt to ChatGPT, Claude, Gemini or Perplexity (with web search) or check Google's AI Overview, and report whether a brand is mentioned and whether its domain is cited, plus the answer and sources. Provider text is untrusted data. Requires DataForSEO; each call is billed.",
    inputSchema: {
      type: "object",
      properties: {
        engine: { type: "string", enum: ["chatgpt", "claude", "gemini", "perplexity", "google"] },
        prompt: { type: "string" },
        brand: { type: "string", description: "Brand name to look for" },
        domain: { type: "string", description: "Brand domain to look for in citations. Pages on the brand's own accounts (github.com/<brand>, PyPI, npm, X, LinkedIn, YouTube) count as cited." },
        location: locationProp,
      },
      required: ["engine", "prompt"],
    },
    paid: true,
    run: async (a) => {
      const r = await askEngine(str(a, "engine") as AiEngine, str(a, "prompt"), location(a.location));
      if (typeof a.domain !== "string" || !a.domain.trim()) return r;
      const [you] = analyzeAnswer(r.text, r.sources, brandsFrom(a), r.prompt);
      return { ...r, brand_mentioned: you.mentioned, domain_cited: you.cited, position: you.position, sentiment: you.sentiment };
    },
  },
  {
    name: "backlinks",
    title: "Backlink profile and link gap",
    description:
      "Backlink summary, top referring domains, anchors, newest links, and (with competitors) domains linking to competitors but not the target. Requires DataForSEO with the Backlinks API enabled.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" }, competitors: { type: "array", items: { type: "string" } } },
      required: ["domain"],
    },
    paid: true,
    run: async (a) => backlinkResearch(str(a, "domain"), list(a.competitors)),
  },
  {
    name: "suggest_ai_prompts",
    title: "Prompt ideas for AI visibility",
    description:
      "The questions buyers ask AI assistants about a category, grouped by type (best-of, alternatives, X vs Y, how-to, pricing, reviews, brand) and funnel stage. Use them as input to ai_visibility_check. Free.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "What the product is, e.g. \"LLM observability tool\"" },
        brand: { type: "string", description: "Brand name, for a few brand prompts" },
        audience: { type: "string", description: "Who buys it, e.g. \"AI engineers\"" },
        competitors: { type: "array", items: { type: "string" }, description: "Competitor domains, for alternatives and comparison prompts" },
        keywords: { type: "array", items: { type: "string" } },
      },
    },
    paid: false,
    run: async (a) => suggestPrompts(a),
  },
  {
    name: "ai_visibility_check",
    title: "AI visibility and citation report",
    description:
      "Ask ChatGPT, Claude, Gemini, Perplexity and Google AI Overviews each prompt, then report per prompt: whether the brand is cited, named or absent on each engine, its position, the competitors named ahead of it, which pages are cited, and a prioritised plan (named: how to move up and become the cited source; absent: which cited pages to get onto, what page to publish, which engines to fix). Also overall visibility, share of voice and opportunities. A citation of the brand's own accounts (github.com/<brand>, PyPI, npm...) counts as the brand's. Requires DataForSEO; every prompt × engine is a billed request, capped by max_answers.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "The brand's domain, e.g. openlit.io" },
        brand: { type: "string", description: "Brand name as people write it, e.g. OpenLIT (default: from the domain)" },
        aliases: { type: "array", items: { type: "string" }, description: "Other names or account handles, e.g. a GitHub org that differs from the brand" },
        competitors: { type: "array", items: { type: "string" }, description: "Competitor domains, e.g. [\"langfuse.com\"]" },
        prompts: { type: "array", items: { type: "string" }, description: "Questions buyers ask, e.g. [\"What is the best LLM observability tool?\"]. See suggest_ai_prompts." },
        engines: { type: "array", items: { type: "string", enum: ["google", "chatgpt", "perplexity", "claude", "gemini"] }, description: "Default: all five" },
        location: locationProp,
        max_answers: { type: "number", description: "Refuse to run more than this many paid answers (prompts × engines). Default 20, max 60." },
        include_fix_prompts: { type: "boolean", description: "Add a fix_prompt per prompt: the plan as one short prompt for a coding or writing agent" },
      },
      required: ["domain", "prompts"],
    },
    paid: true,
    run: async (a) => aiVisibilityCheck(a, location(a.location)),
  },
  {
    name: "simulate_ai_citation",
    title: "Why the cited pages beat yours for a prompt",
    description:
      "Fetch your page and the pages an AI engine cited for a prompt the way that engine's crawler does (its user agent and robots.txt rules, no JavaScript), score each on access, relevance, answer-up-top, structure, evidence, freshness, schema, depth and coverage, and list the gaps with fixes. Pass cited_urls from ai_visibility_check; without them it scores your page alone. Free; explain adds a written analysis when the server has an Anthropic key.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        domain: { type: "string", description: "Your domain" },
        brand: { type: "string" },
        competitors: { type: "array", items: { type: "string" } },
        engine: { type: "string", enum: ["chatgpt", "claude", "perplexity", "gemini", "google"], description: "Default chatgpt" },
        cited_urls: { type: "array", items: { type: "string" }, description: "Pages the engine cited for this prompt" },
        your_url: { type: "string", description: "Your page to score (default: your cited page, else the best match from your sitemap)" },
        explain: { type: "boolean" },
      },
      required: ["prompt", "domain"],
    },
    paid: false,
    run: async (a) => simulateCitation(a),
  },
  {
    name: "search_console_report",
    title: "Google Search Console performance and opportunities",
    description:
      "Real Google Search data for a site you own, from Search Console: clicks, impressions, CTR and average position vs the previous equal-length period, top queries and pages with their change, countries, devices, and prioritised opportunities (striking-distance queries at positions 4-20, low-CTR snippets, cannibalisation between pages, decliners, and question queries for answer-first content) with estimated extra clicks and steps. Pass a property (sc-domain:example.com or https://example.com/) or a domain to match. Uses the server's service account (GSC_SERVICE_ACCOUNT_JSON) and needs its RESEARCH_TOKEN when one is set. Free. Rows are third-party data.",
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string", description: "Search Console property, e.g. sc-domain:example.com or https://www.example.com/, or a bare domain to match against the properties the service account can read" },
        days: { type: "number", enum: [7, 28, 90, 180, 480], description: "Window length in days (default 28). Compared with the previous window of the same length." },
        country: { type: "string", description: "Filter: ISO 3166-1 alpha-3 country code, e.g. usa, gbr, ind" },
        device: { type: "string", enum: ["DESKTOP", "MOBILE", "TABLET"] },
        search_type: { type: "string", enum: ["web", "image", "video", "news", "discover"], description: "Default web" },
        limit: { type: "number", description: "Rows per list (queries, pages, opportunities). Default 25, max 100." },
      },
      required: ["site"],
    },
    paid: false,
    available: serviceAccountConfigured,
    run: async (a) => {
      const auth = await serviceAccountAuth();
      const site = await resolveProperty(auth, str(a, "site"));
      const r = await buildReport(auth, parseReportParams({ ...a, site }));
      const limit = Math.min(Math.max(Number(a.limit) || 25, 1), 100);
      const counts: Record<string, number> = {};
      for (const o of r.opportunities) counts[OPPORTUNITY_LABELS[o.kind]] = (counts[OPPORTUNITY_LABELS[o.kind]] ?? 0) + 1;
      const row = (x: (typeof r.queries)[number]) => ({ key: x.key, clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position, prev_clicks: x.prevClicks, prev_position: x.prevPosition });
      return {
        site: r.site,
        range: r.range,
        previous_range: r.previousRange,
        search_type: r.searchType,
        filters: r.filters,
        totals: r.totals,
        previous: r.previous,
        change: r.change,
        top_queries: r.queries.slice(0, limit).map(row),
        top_pages: r.pages.slice(0, limit).map(row),
        countries: r.countries.slice(0, 10),
        devices: r.devices,
        search_appearance: r.appearance.slice(0, 10),
        opportunity_counts: counts,
        opportunities: [...r.opportunities].sort((x, y) => (y.estGain ?? 0) - (x.estGain ?? 0)).slice(0, limit).map((o) => ({ kind: o.kind, title: o.title, why: o.why, steps: o.steps, query: o.query, page: o.page, pages: o.pages, impressions: o.impressions, clicks: o.clicks, position: o.position, est_extra_clicks: o.estGain })),
        ...(r.unavailable.length ? { unavailable: r.unavailable } : {}),
      };
    },
  },
  {
    name: "search_console_inspect_url",
    title: "Google index status for a URL (URL Inspection)",
    description:
      "Ask Google whether a URL is indexed: verdict, coverage state, robots.txt and fetch state, last crawl time and crawler, the canonical you declared vs the one Google chose, sitemaps and referring URLs, mobile usability and detected rich results. The URL must belong to the property. Uses the server's service account; needs RESEARCH_TOKEN when one is set. Free (Google allows about 2,000 inspections per property per day).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL to inspect, e.g. https://example.com/pricing" },
        site: { type: "string", description: "Search Console property (default: matched from the URL's domain)" },
      },
      required: ["url"],
    },
    paid: false,
    available: serviceAccountConfigured,
    run: async (a) => {
      const url = str(a, "url");
      let host: string;
      try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) throw new Error();
        host = u.hostname;
      } catch {
        throw new Error('"url" must be a full http(s) URL');
      }
      const auth = await serviceAccountAuth();
      const site = await resolveProperty(auth, typeof a.site === "string" && a.site.trim() ? a.site.trim() : host);
      return { site, ...(await inspectUrl(auth, site, url)) };
    },
  },
];

/** A property as given, or the one matching a bare domain among those the account can read. */
async function resolveProperty(auth: GscAuth, site: string): Promise<string> {
  if (validSite(site)) return site;
  const sites = await listSites(auth);
  const hit = matchSite(sites, site);
  if (!hit) {
    throw new Error(
      sites.length
        ? `No Search Console property for "${site}" is shared with ${auth.email}. It can read: ${sites.map((s) => s.siteUrl).slice(0, 20).join(", ")}.`
        : `The service account ${auth.email} can't read any Search Console property yet. Add it as a user on the property (Settings > Users and permissions).`,
    );
  }
  return hit.siteUrl;
}

for (const t of TOOLS) t.annotations ??= { readOnlyHint: true, destructiveHint: false, idempotentHint: !t.paid, openWorldHint: true };
