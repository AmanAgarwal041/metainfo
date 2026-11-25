// One Search Console report: totals vs the previous period, a daily series,
// top queries and pages, countries, devices, search appearance and
// opportunities. Shared by /api/gsc/report and the MCP tool.

import {
  compareTotals,
  DAY_OPTIONS,
  GscError,
  joinPrevious,
  opportunities,
  periods,
  query,
  toTotals,
  validSite,
  type Change,
  type Dimension,
  type GscAuth,
  type GscOpportunity,
  type KeyRow,
  type Period,
  type QueryOptions,
  type Row,
  type SearchType,
  type Totals,
} from "./gsc";

export const SEARCH_TYPES: SearchType[] = ["web", "image", "video", "news", "discover"];
export const DEVICES = ["DESKTOP", "MOBILE", "TABLET"] as const;

export interface ReportParams {
  site: string;
  days: (typeof DAY_OPTIONS)[number];
  /** ISO 3166-1 alpha-3, lowercase (Search Console's format), e.g. "usa". */
  country?: string;
  device?: (typeof DEVICES)[number];
  searchType: SearchType;
}

export interface GscReport {
  site: string;
  days: number;
  searchType: SearchType;
  filters: { country: string | null; device: string | null };
  range: Period;
  previousRange: Period | null;
  totals: Totals;
  previous: Totals | null;
  change: Change | null;
  daily: { date: string; clicks: number; impressions: number; ctr: number; position: number }[];
  queries: KeyRow[];
  pages: KeyRow[];
  countries: (Totals & { key: string })[];
  devices: (Totals & { key: string })[];
  appearance: (Totals & { key: string })[];
  opportunities: GscOpportunity[];
  /** Breakdowns this search type doesn't support (e.g. queries for Discover). */
  unavailable: string[];
}

export class BadInput extends Error {}

/** Validate and normalise untrusted input (JSON body or MCP arguments). */
export function parseReportParams(input: Record<string, unknown>): ReportParams {
  const site = input.site;
  if (!validSite(site)) throw new BadInput('"site" must be a Search Console property: sc-domain:example.com or https://example.com/');
  const days = Number(input.days ?? 28);
  if (!(DAY_OPTIONS as readonly number[]).includes(days)) throw new BadInput(`"days" must be one of ${DAY_OPTIONS.join(", ")}`);
  const country = typeof input.country === "string" && input.country.trim() ? input.country.trim().toLowerCase() : undefined;
  if (country && !/^[a-z]{3}$/.test(country)) throw new BadInput('"country" must be an ISO 3166-1 alpha-3 code, e.g. "usa"');
  const device = typeof input.device === "string" && input.device.trim() ? input.device.trim().toUpperCase() : undefined;
  if (device && !(DEVICES as readonly string[]).includes(device)) throw new BadInput(`"device" must be one of ${DEVICES.join(", ")}`);
  const searchType = (typeof input.search_type === "string" && input.search_type ? input.search_type : "web") as SearchType;
  if (!SEARCH_TYPES.includes(searchType)) throw new BadInput(`"search_type" must be one of ${SEARCH_TYPES.join(", ")}`);
  return { site, days: days as ReportParams["days"], country, device: device as ReportParams["device"], searchType };
}

const keyed = (rows: Row[]) => rows.map((r) => ({ key: r.keys?.[0] ?? "", ...toTotals(r) }));

export async function buildReport(auth: GscAuth, p: ReportParams, now = new Date()): Promise<GscReport> {
  const { current, previous } = periods(p.days, now);
  const filters: NonNullable<QueryOptions["dimensionFilterGroups"]> = [];
  const f: { dimension: Dimension; operator: "equals"; expression: string }[] = [];
  if (p.country) f.push({ dimension: "country", operator: "equals", expression: p.country });
  if (p.device) f.push({ dimension: "device", operator: "equals", expression: p.device });
  if (f.length) filters.push({ groupType: "and", filters: f });

  const run = (period: Period, dimensions: Dimension[], rowLimit = 1000) =>
    query(auth, p.site, { ...period, dimensions, rowLimit, type: p.searchType, ...(filters.length ? { dimensionFilterGroups: filters } : {}) });
  const unavailable: string[] = [];
  // Breakdowns are best effort: some search types don't support every dimension (Discover has no queries).
  const optional = async (name: string, period: Period | null, dimensions: Dimension[], rowLimit?: number): Promise<Row[] | null> => {
    if (!period) return null;
    try {
      return await run(period, dimensions, rowLimit);
    } catch (e) {
      if (e instanceof GscError && e.code === "bad-request") {
        if (!unavailable.includes(name)) unavailable.push(name);
        return null;
      }
      throw e;
    }
  };

  const [cur, prev, daily, q, qPrev, pg, pgPrev, qp, countries, devices, appearance] = await Promise.all([
    run(current, []),
    previous ? run(previous, []) : Promise.resolve(null),
    optional("daily", current, ["date"], 500),
    optional("queries", current, ["query"], 1000),
    optional("queries", previous, ["query"], 1000),
    optional("pages", current, ["page"], 1000),
    optional("pages", previous, ["page"], 1000),
    optional("queries", current, ["query", "page"], 5000),
    optional("countries", current, ["country"], 50),
    optional("devices", current, ["device"], 5),
    optional("appearance", current, ["searchAppearance"], 50),
  ]);

  const totals = toTotals(cur[0]);
  const prevTotals = prev ? toTotals(prev[0]) : null;
  const queries = joinPrevious(q ?? [], previous ? (qPrev ?? []) : null);
  const pages = joinPrevious(pg ?? [], previous ? (pgPrev ?? []) : null);
  // Scale the noise floor with the window and the site's size.
  const minImpressions = Math.max(10, Math.round(p.days * 0.75), Math.round(totals.impressions * 0.0005));

  return {
    site: p.site,
    days: p.days,
    searchType: p.searchType,
    filters: { country: p.country ?? null, device: p.device ?? null },
    range: current,
    previousRange: previous,
    totals,
    previous: prevTotals,
    change: compareTotals(totals, prevTotals),
    daily: (daily ?? []).map((r) => ({ date: r.keys?.[0] ?? "", ...toTotals(r) })).sort((a, b) => a.date.localeCompare(b.date)),
    queries: queries.slice(0, 500),
    pages: pages.slice(0, 500),
    countries: keyed(countries ?? []),
    devices: keyed(devices ?? []),
    appearance: keyed(appearance ?? []),
    opportunities: opportunities({ queries, pages, queryPages: qp ?? [], minImpressions }),
    unavailable,
  };
}

export interface GscOpportunitiesResult {
  site: string;
  days: number;
  range: Period;
  previousRange: Period | null;
  totals: Totals;
  previous: Totals | null;
  change: Change | null;
  opportunities: GscOpportunity[];
}

/** Just the opportunities (and totals) for web search: the queries a report needs for them, nothing else. */
export async function buildOpportunities(auth: GscAuth, site: string, days: ReportParams["days"], now = new Date()): Promise<GscOpportunitiesResult> {
  const { current, previous } = periods(days, now);
  const run = (period: Period, dimensions: Dimension[], rowLimit: number) => query(auth, site, { ...period, dimensions, rowLimit, type: "web" });
  const none = Promise.resolve(null);
  const [cur, prev, q, qPrev, pg, pgPrev, qp] = await Promise.all([
    run(current, [], 1),
    previous ? run(previous, [], 1) : none,
    run(current, ["query"], 1000),
    previous ? run(previous, ["query"], 1000) : none,
    run(current, ["page"], 500),
    previous ? run(previous, ["page"], 500) : none,
    run(current, ["query", "page"], 5000),
  ]);
  const totals = toTotals(cur[0]);
  const prevTotals = prev ? toTotals(prev[0]) : null;
  const minImpressions = Math.max(10, Math.round(days * 0.75), Math.round(totals.impressions * 0.0005));
  return {
    site,
    days,
    range: current,
    previousRange: previous,
    totals,
    previous: prevTotals,
    change: compareTotals(totals, prevTotals),
    opportunities: opportunities({ queries: joinPrevious(q, previous ? (qPrev ?? []) : null), pages: joinPrevious(pg, previous ? (pgPrev ?? []) : null), queryPages: qp, minImpressions }),
  };
}
