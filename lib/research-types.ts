// Shapes returned by /api/research/* (normalised from DataForSEO and free sources).

export type Intent = "informational" | "navigational" | "commercial" | "transactional";

export interface KeywordMetrics {
  keyword: string;
  volume: number | null;
  /** 0–100 */
  difficulty: number | null;
  cpc: number | null;
  /** 0–1 */
  competition: number | null;
  intent: Intent | null;
  /** Oldest → newest monthly search volumes. */
  trend: number[];
}

export interface KeywordRow extends KeywordMetrics {
  source: "dataforseo" | "autocomplete";
  group: "questions" | "comparisons" | "commercial" | "prepositions" | "other";
}

export interface Paid {
  /** USD spent on DataForSEO for this response (0 when served from cache). */
  cost: number;
  cached: boolean;
}

export interface KeywordResearch extends Paid {
  seed: string;
  provider: "dataforseo" | "free";
  keywords: KeywordRow[];
  /** Seed metrics, when the provider supplies them. */
  seedMetrics: KeywordMetrics | null;
  warnings: string[];
}

export interface GapRow extends KeywordMetrics {
  /** Domain → ranking position (absent = not ranking). */
  positions: Record<string, number>;
  /** Domain → ranking URL. */
  urls: Record<string, string>;
  status: "missing" | "weak" | "strong";
}

export interface KeywordGap extends Paid {
  you: string;
  competitors: string[];
  rows: GapRow[];
  warnings: string[];
}

export interface OrganicMetrics {
  keywords: number;
  /** Estimated monthly organic traffic. */
  traffic: number;
  pos1: number;
  pos2_3: number;
  pos4_10: number;
  pos11_20: number;
}

export interface CompetitorRow {
  domain: string;
  commonKeywords: number;
  avgPosition: number | null;
  organic: OrganicMetrics;
}

export interface CompetitorResearch extends Paid {
  domain: string;
  overview: OrganicMetrics | null;
  competitors: CompetitorRow[];
}

export interface SerpOrganic {
  position: number;
  absolute: number;
  domain: string;
  url: string;
  title: string;
  description: string;
}

export interface SerpResult extends Paid {
  keyword: string;
  location: number;
  device: "desktop" | "mobile";
  checkedAt: string;
  resultsCount: number | null;
  features: string[];
  organic: SerpOrganic[];
  featuredSnippet: { domain: string; url: string; title: string; text: string } | null;
  aiOverview: { present: boolean; references: { domain: string; url: string; title: string }[] } | null;
  peopleAlsoAsk: string[];
  relatedSearches: string[];
}

export interface BacklinkSummary {
  target: string;
  rank: number;
  backlinks: number;
  referringDomains: number;
  referringMainDomains: number;
  referringIps: number;
  nofollowBacklinks: number;
  brokenBacklinks: number;
  spamScore: number | null;
  firstSeen: string | null;
  tlds: Record<string, number>;
}

export interface Backlink {
  domainFrom: string;
  urlFrom: string;
  urlTo: string;
  anchor: string;
  dofollow: boolean;
  domainRank: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  isNew: boolean;
  isLost: boolean;
}

export interface ReferringDomain {
  domain: string;
  rank: number | null;
  backlinks: number;
  firstSeen: string | null;
}

export interface Anchor {
  anchor: string;
  backlinks: number;
  referringDomains: number;
}

export interface LinkGapRow {
  domain: string;
  rank: number | null;
  /** Competitor domain → backlinks from this domain. */
  linksTo: Record<string, number>;
}

export interface BacklinkResearch extends Paid {
  target: string;
  summary: BacklinkSummary;
  competitors: BacklinkSummary[];
  referringDomains: ReferringDomain[];
  anchors: Anchor[];
  recent: Backlink[];
  linkGap: LinkGapRow[];
  warnings: string[];
}

export interface ResearchStatus {
  dataforseo: boolean;
  tokenRequired: boolean;
}

export const LOCATIONS = [
  { code: 2840, name: "United States", gl: "us", lang: "en" },
  { code: 2826, name: "United Kingdom", gl: "uk", lang: "en" },
  { code: 2356, name: "India", gl: "in", lang: "en" },
  { code: 2124, name: "Canada", gl: "ca", lang: "en" },
  { code: 2036, name: "Australia", gl: "au", lang: "en" },
  { code: 2702, name: "Singapore", gl: "sg", lang: "en" },
  { code: 2784, name: "United Arab Emirates", gl: "ae", lang: "en" },
  { code: 2276, name: "Germany", gl: "de", lang: "de" },
  { code: 2250, name: "France", gl: "fr", lang: "fr" },
  { code: 2724, name: "Spain", gl: "es", lang: "es" },
  { code: 2380, name: "Italy", gl: "it", lang: "it" },
  { code: 2528, name: "Netherlands", gl: "nl", lang: "nl" },
  { code: 2076, name: "Brazil", gl: "br", lang: "pt" },
  { code: 2484, name: "Mexico", gl: "mx", lang: "es" },
  { code: 2392, name: "Japan", gl: "jp", lang: "ja" },
] as const;

export function locationByCode(code: number) {
  return LOCATIONS.find((l) => l.code === code) ?? LOCATIONS[0];
}

/** "https://www.Example.com/path" → "example.com" */
export function bareDomain(input: string): string {
  const s = input.trim().toLowerCase();
  if (!s) return "";
  try {
    return new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, "");
  } catch {
    return s.replace(/^www\./, "").split("/")[0];
  }
}
