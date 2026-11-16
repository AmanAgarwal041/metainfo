// Real traffic, as reported by a collector running at the site's edge (see
// collector/). Shared by the ingest endpoint (classification) and the Traffic
// page (labels). Collectors only forward raw request facts; who a client is
// gets decided here, so the list improves without anyone redeploying.

/** What a collector sends: one JSON object per line (NDJSON), protocol v1. Mirrors collector/src/core.ts. */
export interface TrafficEvent {
  v: 1;
  /** Epoch milliseconds. */
  ts: number;
  method: string;
  host: string;
  path: string;
  /** HTTP status the visitor got; 0 when the collector can't see it (Next.js proxy). */
  status: number;
  ua: string;
  /** Referer as origin + path. */
  referer?: string;
  /** `utm_source`, the only query parameter kept. */
  utm?: string;
  /** `Sec-Fetch-Mode`: present for browsers, absent for most scripts and crawlers. */
  fetchMode?: string;
  /** `Signature-Agent` (Web Bot Auth): the domain a signed agent claims. */
  signatureAgent?: string;
}

export type Kind = "ai_search" | "ai_user" | "ai_training" | "search" | "preview" | "bot" | "human";

export const KIND_META: Record<Kind, { label: string; short: string; color: string }> = {
  human: { label: "People", short: "People", color: "var(--series-1)" },
  ai_search: { label: "AI search crawlers", short: "AI search", color: "var(--series-2)" },
  ai_user: { label: "AI fetching for a user", short: "AI live fetch", color: "var(--series-3)" },
  ai_training: { label: "AI training crawlers", short: "AI training", color: "var(--series-4)" },
  search: { label: "Search engines", short: "Search", color: "var(--series-5)" },
  preview: { label: "Link previews", short: "Previews", color: "var(--series-6)" },
  bot: { label: "Other bots and scripts", short: "Other bots", color: "var(--series-7)" },
};

export const AI_KINDS: Kind[] = ["ai_search", "ai_user", "ai_training"];

export interface Agent {
  /** Same ids as wasm/src/crawlers.rs where the crawler is in the access matrix. */
  id: string;
  name: string;
  operator: string;
  kind: Exclude<Kind, "human">;
  /** Lowercase substrings of the user agent. */
  needles: string[];
}

export const AGENTS: Agent[] = [
  // AI search indexes
  { id: "oai-searchbot", name: "OAI-SearchBot", operator: "OpenAI", kind: "ai_search", needles: ["oai-searchbot"] },
  { id: "claude-searchbot", name: "Claude-SearchBot", operator: "Anthropic", kind: "ai_search", needles: ["claude-searchbot"] },
  { id: "perplexitybot", name: "PerplexityBot", operator: "Perplexity", kind: "ai_search", needles: ["perplexitybot"] },
  { id: "duckassistbot", name: "DuckAssistBot", operator: "DuckDuckGo", kind: "ai_search", needles: ["duckassistbot"] },
  { id: "youbot", name: "YouBot", operator: "You.com", kind: "ai_search", needles: ["youbot"] },
  // AI fetching a page live because someone asked
  { id: "chatgpt-user", name: "ChatGPT-User", operator: "OpenAI", kind: "ai_user", needles: ["chatgpt-user"] },
  { id: "claude-user", name: "Claude-User", operator: "Anthropic", kind: "ai_user", needles: ["claude-user"] },
  { id: "perplexity-user", name: "Perplexity-User", operator: "Perplexity", kind: "ai_user", needles: ["perplexity-user"] },
  { id: "mistralai-user", name: "MistralAI-User", operator: "Mistral", kind: "ai_user", needles: ["mistralai-user"] },
  { id: "meta-externalfetcher", name: "Meta-ExternalFetcher", operator: "Meta", kind: "ai_user", needles: ["meta-externalfetcher"] },
  { id: "google-agent", name: "Google-Agent", operator: "Google", kind: "ai_user", needles: ["google-agent"] },
  // AI training
  { id: "gptbot", name: "GPTBot", operator: "OpenAI", kind: "ai_training", needles: ["gptbot"] },
  { id: "claudebot", name: "ClaudeBot", operator: "Anthropic", kind: "ai_training", needles: ["claudebot", "anthropic-ai", "claude-web"] },
  { id: "ccbot", name: "CCBot", operator: "Common Crawl", kind: "ai_training", needles: ["ccbot"] },
  { id: "meta-externalagent", name: "Meta-ExternalAgent", operator: "Meta", kind: "ai_training", needles: ["meta-externalagent"] },
  { id: "bytespider", name: "Bytespider", operator: "ByteDance", kind: "ai_training", needles: ["bytespider"] },
  { id: "amazonbot", name: "Amazonbot", operator: "Amazon", kind: "ai_training", needles: ["amazonbot"] },
  { id: "cohere-ai", name: "cohere-ai", operator: "Cohere", kind: "ai_training", needles: ["cohere-ai", "cohere-training-data-crawler"] },
  { id: "ai2bot", name: "AI2Bot", operator: "Allen Institute", kind: "ai_training", needles: ["ai2bot"] },
  { id: "diffbot", name: "Diffbot", operator: "Diffbot", kind: "ai_training", needles: ["diffbot"] },
  { id: "timpibot", name: "Timpibot", operator: "Timpi", kind: "ai_training", needles: ["timpibot"] },
  // Search engines
  { id: "googlebot", name: "Googlebot", operator: "Google", kind: "search", needles: ["googlebot", "google-inspectiontool", "storebot-google"] },
  { id: "bingbot", name: "Bingbot", operator: "Microsoft", kind: "search", needles: ["bingbot", "msnbot", "bingpreview"] },
  { id: "applebot", name: "Applebot", operator: "Apple", kind: "search", needles: ["applebot"] },
  { id: "duckduckbot", name: "DuckDuckBot", operator: "DuckDuckGo", kind: "search", needles: ["duckduckbot"] },
  { id: "yandexbot", name: "YandexBot", operator: "Yandex", kind: "search", needles: ["yandexbot", "yandex.com/bots"] },
  { id: "baiduspider", name: "Baiduspider", operator: "Baidu", kind: "search", needles: ["baiduspider"] },
  { id: "petalbot", name: "PetalBot", operator: "Huawei", kind: "search", needles: ["petalbot"] },
  // Link previews
  { id: "facebookexternalhit", name: "Facebook", operator: "Meta", kind: "preview", needles: ["facebookexternalhit", "facebookcatalog"] },
  { id: "twitterbot", name: "X (Twitter)", operator: "X", kind: "preview", needles: ["twitterbot"] },
  { id: "linkedinbot", name: "LinkedIn", operator: "LinkedIn", kind: "preview", needles: ["linkedinbot"] },
  { id: "slackbot", name: "Slack", operator: "Slack", kind: "preview", needles: ["slackbot", "slack-imgproxy"] },
  { id: "discordbot", name: "Discord", operator: "Discord", kind: "preview", needles: ["discordbot"] },
  { id: "whatsapp", name: "WhatsApp", operator: "Meta", kind: "preview", needles: ["whatsapp"] },
  { id: "telegrambot", name: "Telegram", operator: "Telegram", kind: "preview", needles: ["telegrambot"] },
  { id: "pinterestbot", name: "Pinterest", operator: "Pinterest", kind: "preview", needles: ["pinterestbot", "pinterest/"] },
];

/** A client that signs its requests (Web Bot Auth) but isn't in the list above. */
export const SIGNED_AGENT = "signed-agent";
/** Anything else that looks automated. */
export const OTHER_BOT = "other";

const AGENT_BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

export function agentMeta(id: string): { name: string; operator: string } {
  const a = AGENT_BY_ID.get(id);
  if (a) return a;
  if (id === SIGNED_AGENT) return { name: "Signed agent", operator: "Web Bot Auth" };
  return { name: "Other bots", operator: "Scripts, monitors, unknown crawlers" };
}

/** Every needle, longest first, so the most specific wins. */
const NEEDLES = AGENTS.flatMap((a) => a.needles.map((n) => ({ n, a }))).sort((x, y) => y.n.length - x.n.length);

const BOT_LIKE = /bot\b|bot\/|crawl|spider|slurp|scrapy|headless|phantomjs|puppeteer|playwright|python-|curl\/|wget\/|go-http-client|okhttp|java\/|axios\/|node-fetch|undici|httpclient|libwww|aiohttp|httpx|monitor|uptime|pingdom|lighthouse|preview/i;

export interface Client {
  kind: Kind;
  /** Agent id, or "" for people. */
  agent: string;
}

/** Who sent a request, from its user agent, signature and fetch metadata. */
export function classify(ua: string, fetchMode?: string, signatureAgent?: string): Client {
  const l = ua.slice(0, 512).toLowerCase();
  if (l) {
    const hit = NEEDLES.find((x) => l.includes(x.n));
    if (hit) return { kind: hit.a.kind, agent: hit.a.id };
  }
  if (signatureAgent) return { kind: "ai_user", agent: SIGNED_AGENT };
  if (!l || BOT_LIKE.test(l) || !/mozilla\/|opera\//.test(l)) return { kind: "bot", agent: OTHER_BOT };
  // A browser user agent sent without any fetch metadata is very likely a script (every current browser sends it).
  if (!fetchMode && /chrome\/|firefox\/|edg\//.test(l)) return { kind: "bot", agent: OTHER_BOT };
  return { kind: "human", agent: "" };
}

// ------------------------------------------------------------- referrals

export interface Source {
  id: string;
  label: string;
  /** Answer engines: a visit from one of these is a click from an AI answer. */
  ai: boolean;
}

const SOURCES: (Source & { hosts: RegExp })[] = [
  { id: "chatgpt", label: "ChatGPT", ai: true, hosts: /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com)$/ },
  { id: "perplexity", label: "Perplexity", ai: true, hosts: /(^|\.)perplexity\.ai$/ },
  { id: "claude", label: "Claude", ai: true, hosts: /(^|\.)claude\.ai$/ },
  { id: "gemini", label: "Gemini", ai: true, hosts: /^(gemini|bard)\.google\.com$/ },
  { id: "copilot", label: "Copilot", ai: true, hosts: /^copilot\.(microsoft|cloud\.microsoft)\.com$|^copilot\.microsoft\.com$/ },
  { id: "deepseek", label: "DeepSeek", ai: true, hosts: /(^|\.)deepseek\.com$/ },
  { id: "grok", label: "Grok", ai: true, hosts: /(^|\.)grok\.com$/ },
  { id: "meta-ai", label: "Meta AI", ai: true, hosts: /(^|\.)meta\.ai$/ },
  { id: "mistral", label: "Le Chat", ai: true, hosts: /^chat\.mistral\.ai$/ },
  { id: "you", label: "You.com", ai: true, hosts: /(^|\.)you\.com$/ },
  { id: "google", label: "Google", ai: false, hosts: /(^|\.)google\.[a-z.]{2,6}$/ },
  { id: "bing", label: "Bing", ai: false, hosts: /(^|\.)bing\.com$/ },
  { id: "duckduckgo", label: "DuckDuckGo", ai: false, hosts: /(^|\.)duckduckgo\.com$/ },
  { id: "yahoo", label: "Yahoo", ai: false, hosts: /(^|\.)yahoo\.[a-z.]{2,6}$/ },
  { id: "yandex", label: "Yandex", ai: false, hosts: /(^|\.)yandex\.[a-z.]{2,6}$/ },
  { id: "ecosia", label: "Ecosia", ai: false, hosts: /(^|\.)ecosia\.org$/ },
  { id: "brave", label: "Brave Search", ai: false, hosts: /^search\.brave\.com$/ },
];

const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));
/** Ids of the answer engines. */
export const AI_SOURCES = SOURCES.filter((s) => s.ai).map((s) => s.id);
/** `utm_source` values answer engines add to the links they show. */
const UTM_SOURCES: Record<string, string> = { "chatgpt.com": "chatgpt", chatgpt: "chatgpt", "perplexity.ai": "perplexity", perplexity: "perplexity", "claude.ai": "claude", "copilot.com": "copilot", copilot: "copilot", gemini: "gemini" };

export const DIRECT = "direct";
export const INTERNAL = "internal";

export function sourceMeta(id: string): Source {
  const s = SOURCE_BY_ID.get(id);
  if (s) return { id: s.id, label: s.label, ai: s.ai };
  if (id === DIRECT) return { id, label: "Direct / unknown", ai: false };
  if (id === INTERNAL) return { id, label: "Your own pages", ai: false };
  return { id, label: id, ai: false };
}

const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** Where a person came from: a known engine id, another site's host, "internal" or "direct". */
export function referralSource(referer: string | undefined, utm: string | undefined, host: string): string {
  const fromUtm = utm ? UTM_SOURCES[utm.toLowerCase()] : undefined;
  if (fromUtm) return fromUtm;
  if (!referer) return DIRECT;
  let refHost: string;
  try {
    refHost = bare(new URL(referer).hostname);
  } catch {
    return DIRECT;
  }
  const own = bare(host);
  if (refHost === own || refHost.endsWith(`.${own}`) || own.endsWith(`.${refHost}`)) return INTERNAL;
  return SOURCES.find((s) => s.hosts.test(refHost))?.id ?? refHost.slice(0, 100);
}

/** One path per page: no query, no trailing slash, capped. */
export function normalisePath(path: string): string {
  let p = (path || "/").split(/[?#]/)[0].slice(0, 300);
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "") || "/";
  return p;
}

/** A reported host belongs to the site: the domain itself or a subdomain (www, docs, ...). */
export function hostMatches(host: string, domain: string): boolean {
  const h = bare(host.split(":")[0]);
  const d = bare(domain);
  return !!d && (h === d || h.endsWith(`.${d}`));
}

// ------------------------------------------------------------- API shapes

export interface TrafficStats {
  days: number;
  /** First day shown, as an epoch day (UTC). */
  fromDay: number;
  totals: Record<Kind, number>;
  /** Per epoch day: hits per kind, plus people who came from an AI answer. */
  daily: { day: number; counts: Partial<Record<Kind, number>>; aiReferrals: number }[];
  agents: { agent: string; kind: Kind; hits: number; lastHour: number; errors: number; unknownStatus: number }[];
  /** Crawlers (AI and search) that got an error, by path. */
  failures: { agent: string; kind: Kind; status: number; path: string; hits: number }[];
  /** Pages AI crawlers read most, and which crawlers read them. */
  aiPaths: { path: string; hits: number; agents: string[] }[];
  sources: { source: string; hits: number }[];
  /** Pages people from AI answers landed on. */
  aiLandings: { path: string; source: string; hits: number }[];
  topPages: { path: string; hits: number }[];
}

/** A project's collector, as the API shows it (never the token). */
export interface CollectorSite {
  projectId: string;
  domain: string;
  /** METAINFO_ORG: the workspace the site belongs to (Clerk organisation id, or user id for a personal workspace). */
  workspaceId: string;
  /** METAINFO_SITE: the site's URL. */
  siteUrl: string;
  /** Last 4 characters of the token. */
  tokenHint: string;
  createdAt: number;
  lastEventAt: number | null;
  /** Which adapter reported last: cloudflare-worker, cloudflare-pages, cloudflare-worker-wrap, next. */
  lastVia: string | null;
}
