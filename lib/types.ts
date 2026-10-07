// Mirrors the JSON produced by the Rust engine (wasm/src/model.rs).

export type Platform = "google" | "bing" | "chatgpt" | "perplexity" | "claude" | "gemini" | "social";
export type Category = "indexability" | "meta" | "social" | "content" | "structured" | "ai" | "performance";
export type Status = "pass" | "warn" | "fail" | "info";
export type Severity = "critical" | "high" | "medium" | "low";
export type Effort = "low" | "medium" | "high";

export interface Resource {
  url: string;
  status?: number | null;
  contentType?: string | null;
  body?: string | null;
  error?: string | null;
}

export interface ScanInput {
  url: string;
  finalUrl?: string | null;
  status?: number | null;
  headers: Record<string, string>;
  html: string;
  redirects: { url: string; status: number }[];
  ttfbMs?: number | null;
  robots?: Resource | null;
  sitemaps: Resource[];
  llms?: Resource | null;
  botProbes: { bot: string; status?: number | null; error?: string | null }[];
  /** Added by the fetcher, ignored by the engine. */
  fetchMs?: number;
}

export interface Check {
  id: string;
  category: Category;
  title: string;
  status: Status;
  severity: Severity;
  effort: Effort;
  platforms: Platform[];
  finding: string;
  why: string;
  recommendation: string;
  snippet?: string;
  snippetLang?: string;
}

export interface PlatformScore {
  platform: Platform;
  label: string;
  score: number;
  passed: number;
  failed: number;
  warnings: number;
}

export interface CategoryScore {
  category: Category;
  label: string;
  score: number;
  passed: number;
  total: number;
}

export interface PlanTask {
  checkId: string;
  title: string;
  category: Category;
  severity: Severity;
  effort: Effort;
  platforms: Platform[];
  recommendation: string;
  gains: Partial<Record<Platform, number>>;
  totalGain: number;
}

export interface PlanPhase {
  id: string;
  title: string;
  description: string;
  tasks: PlanTask[];
}

export interface MetaEntry {
  key: string;
  attr: string;
  content: string;
  engines: string[];
}

export interface PageData {
  lang?: string | null;
  title?: string | null;
  titleCount: number;
  description?: string | null;
  descriptionCount: number;
  meta: MetaEntry[];
  canonicals: string[];
  metaRobots?: string | null;
  viewport?: string | null;
  charset?: string | null;
  hreflang: { lang: string; href: string }[];
  openGraph: { key: string; value: string }[];
  twitter: { key: string; value: string }[];
  icons: { rel: string; href: string; sizes?: string | null }[];
  manifest?: string | null;
  themeColor?: string | null;
  generator?: string | null;
  author?: string | null;
  published?: string | null;
  modified?: string | null;
  headings: { level: number; text: string }[];
  images: { src: string; alt?: string | null; width?: string | null; height?: string | null; loading?: string | null }[];
  imageCount: number;
  imagesMissingAlt: number;
  imagesMissingSize: number;
  imagesLazy: number;
  links: { href: string; text: string; rel?: string | null; internal: boolean }[];
  linkStats: { internal: number; external: number; nofollow: number; emptyAnchor: number; genericAnchor: number };
  jsonLd: { valid: boolean; error?: string | null; types: string[]; raw: string }[];
  microdataTypes: string[];
  scripts: { total: number; external: number; inline: number; headBlocking: number; isAsync: number; defer: number; module: number; inlineBytes: number };
  stylesheets: number;
  wordCount: number;
  htmlBytes: number;
  textRatio: number;
  paragraphs: number;
  lists: number;
  tables: number;
  questionHeadings: number;
  firstParagraph?: string | null;
  excerpt: string;
  spaShell: boolean;
  topics: Topic[];
}

export interface Topic {
  term: string;
  words: number;
  count: number;
  density: number;
  score: number;
  inTitle: boolean;
  inH1: boolean;
  inHeadings: boolean;
  inDescription: boolean;
  inUrl: boolean;
}

export interface CrawlerAccess {
  id: string;
  name: string;
  operator: string;
  purpose: "search" | "user" | "training";
  platform?: Platform | null;
  robotsAllowed?: boolean | null;
  robotsGroup?: string | null;
  robotsRule?: string | null;
  edgeStatus?: number | null;
  edgeError?: string | null;
  edgeInconclusive: boolean;
  allowed: boolean;
}

export interface RobotsReport {
  url: string;
  status?: number | null;
  found: boolean;
  agents: string[];
  sitemaps: string[];
  warnings: string[];
  bytes: number;
  body?: string | null;
  contentSignals: string[];
}

export interface SitemapReport {
  found: boolean;
  declaredInRobots: boolean;
  sources: { url: string; status?: number | null; kind: string; urlCount: number; error?: string | null }[];
  urlCount: number;
  lastmodCount: number;
  latestLastmod?: string | null;
  childSitemaps: string[];
  containsPage?: boolean | null;
  sampleUrls: string[];
  issues: string[];
}

export interface LlmsReport {
  url: string;
  status?: number | null;
  found: boolean;
  title?: string | null;
  summary?: string | null;
  sections: string[];
  linkCount: number;
  bytes: number;
  issues: string[];
  body?: string | null;
}

export interface Report {
  engineVersion: string;
  url: string;
  finalUrl: string;
  status?: number | null;
  redirects: { url: string; status: number }[];
  ttfbMs?: number | null;
  summary: { overall: number; critical: number; failed: number; warnings: number; passed: number; total: number };
  scores: PlatformScore[];
  categories: CategoryScore[];
  checks: Check[];
  plan: PlanPhase[];
  page: PageData;
  robots?: RobotsReport | null;
  sitemap?: SitemapReport | null;
  llms?: LlmsReport | null;
  crawlers: CrawlerAccess[];
  generated: { headHtml: string; jsonLd: string; robotsTxt: string; llmsTxt: string };
}

export const PLATFORM_META: Record<Platform, { label: string; short: string; color: string }> = {
  google: { label: "Google", short: "Google", color: "var(--series-1)" },
  bing: { label: "Bing", short: "Bing", color: "var(--series-2)" },
  chatgpt: { label: "ChatGPT", short: "ChatGPT", color: "var(--series-3)" },
  perplexity: { label: "Perplexity", short: "Perplexity", color: "var(--series-4)" },
  claude: { label: "Claude", short: "Claude", color: "var(--series-5)" },
  gemini: { label: "Gemini / AI Overviews", short: "Gemini", color: "var(--series-6)" },
  social: { label: "Social sharing", short: "Social", color: "var(--series-7)" },
};

export const PLATFORMS: Platform[] = ["google", "bing", "chatgpt", "perplexity", "claude", "gemini", "social"];
