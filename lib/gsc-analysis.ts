// Search Console analysis: pure functions shared by the server (reports, MCP)
// and the browser (property matching). No I/O, so they're unit-testable.

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface Row {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

const bare = (d: string) =>
  d
    .trim()
    .toLowerCase()
    .replace(/^sc-domain:/, "")
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];

/** The property that covers `domain`: the domain property first, then https/http with and without www, then a parent domain property. */
export function matchSite(sites: GscSite[], domain: string): GscSite | null {
  const d = bare(domain);
  if (!d) return null;
  const want = [`sc-domain:${d}`, `https://${d}/`, `https://www.${d}/`, `http://${d}/`, `http://www.${d}/`];
  for (const w of want) {
    const hit = sites.find((s) => s.siteUrl.toLowerCase() === w);
    if (hit) return hit;
  }
  return sites.find((s) => s.siteUrl.startsWith("sc-domain:") && d.endsWith(`.${bare(s.siteUrl)}`)) ?? null;
}

export function validSite(site: unknown): site is string {
  return typeof site === "string" && site.length <= 300 && /^(sc-domain:[a-z0-9][a-z0-9.-]*[a-z0-9]|https?:\/\/[^\s]+\/)$/i.test(site);
}


export interface Totals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Period {
  startDate: string;
  endDate: string;
}

export const DAY_OPTIONS = [7, 28, 90, 180, 480] as const;
/** Search Console keeps 16 months of data. */
const RETENTION_DAYS = 486;
/** Final data lags by about two days; end three days back so both periods are complete. */
const LAG_DAYS = 3;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** The current window and the equal-length window before it (null when it would fall outside retention). */
export function periods(days: number, now = new Date()): { current: Period; previous: Period | null } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = addDays(today, -LAG_DAYS);
  const start = addDays(end, -(days - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  const oldest = addDays(today, -RETENTION_DAYS);
  return {
    current: { startDate: isoDay(start), endDate: isoDay(end) },
    previous: prevStart >= oldest ? { startDate: isoDay(prevStart), endDate: isoDay(prevEnd) } : null,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function toTotals(row: Row | undefined): Totals {
  return row ? { clicks: row.clicks, impressions: row.impressions, ctr: r4(row.ctr), position: r1(row.position) } : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
}

export interface Change {
  /** Percent change, or null when the previous value was 0. */
  clicksPct: number | null;
  impressionsPct: number | null;
  /** Percentage points. */
  ctrPts: number;
  /** Previous minus current: positive = moved up. */
  position: number;
}

/** Current vs previous period. */
export function compareTotals(cur: Totals, prev: Totals | null): Change | null {
  if (!prev) return null;
  const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
  return {
    clicksPct: pct(cur.clicks, prev.clicks),
    impressionsPct: pct(cur.impressions, prev.impressions),
    ctrPts: r1((cur.ctr - prev.ctr) * 100),
    position: cur.position && prev.position ? r1(prev.position - cur.position) : 0,
  };
}

export interface KeyRow extends Totals {
  key: string;
  prevClicks: number | null;
  prevImpressions: number | null;
  prevPosition: number | null;
}

/** Rows keyed by their first dimension, joined to the previous period's. */
export function joinPrevious(cur: Row[], prev: Row[] | null): KeyRow[] {
  const before = new Map((prev ?? []).map((r) => [r.keys?.[0] ?? "", r]));
  return cur.map((r) => {
    const key = r.keys?.[0] ?? "";
    const p = prev ? before.get(key) : undefined;
    return {
      key,
      ...toTotals(r),
      prevClicks: prev ? (p?.clicks ?? 0) : null,
      prevImpressions: prev ? (p?.impressions ?? 0) : null,
      prevPosition: p ? r1(p.position) : null,
    };
  });
}

/**
 * Expected organic CTR by position (blended desktop/mobile industry curves,
 * rounded). Only a yardstick: SERP features and brand terms move it a lot.
 */
export const CTR_CURVE = [0.28, 0.155, 0.1, 0.072, 0.054, 0.041, 0.032, 0.026, 0.021, 0.018, 0.014, 0.012, 0.011, 0.01, 0.009, 0.008, 0.0075, 0.007, 0.0065, 0.006];

export function expectedCtr(position: number): number {
  if (!(position > 0)) return 0;
  if (position <= 1) return CTR_CURVE[0];
  if (position >= CTR_CURVE.length) return CTR_CURVE.at(-1)! * (CTR_CURVE.length / position);
  const i = Math.floor(position) - 1;
  const t = position - Math.floor(position);
  return CTR_CURVE[i] + (CTR_CURVE[i + 1] - CTR_CURVE[i]) * t;
}

export type OpportunityKind = "striking-distance" | "low-ctr" | "cannibalisation" | "declining" | "answer-first";

export interface GscOpportunity {
  id: string;
  kind: OpportunityKind;
  title: string;
  why: string;
  steps: string[];
  query?: string;
  page?: string;
  /** Competing pages, for cannibalisation. */
  pages?: { page: string; clicks: number; impressions: number; position: number; share: number }[];
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  /** Estimated extra clicks over the same period; null when there's no fair estimate. */
  estGain: number | null;
}

export const OPPORTUNITY_LABELS: Record<OpportunityKind, string> = {
  "striking-distance": "Striking distance",
  "low-ctr": "Low click-through",
  cannibalisation: "Cannibalisation",
  declining: "Declining",
  "answer-first": "Answer-first content",
};

const QUESTION = /^(who|what|whats|what's|when|where|why|how|which|is|are|can|does|do|should|will|best|top)\b|\b(vs\.?|versus|best|alternatives?|compare|comparison|difference between|review|reviews|examples?|meaning|definition)\b|\?$/i;

export const isQuestionQuery = (q: string) => QUESTION.test(q.trim());

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};

export interface OpportunityInput {
  queries: KeyRow[];
  pages: KeyRow[];
  /** Rows with dimensions [query, page]. */
  queryPages: Row[];
  /** Ignore rows with fewer impressions than this. */
  minImpressions: number;
  /** Per kind. */
  limit?: number;
}

export function opportunities({ queries, pages, queryPages, minImpressions, limit = 25 }: OpportunityInput): GscOpportunity[] {
  const out: GscOpportunity[] = [];
  const top = (list: GscOpportunity[]) => list.sort((a, b) => (b.estGain ?? -1) - (a.estGain ?? -1) || b.impressions - a.impressions).slice(0, limit);
  const base = (r: KeyRow) => ({ impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, position: r.position });

  // (a) Striking distance: positions 4-20 with real demand.
  out.push(
    ...top(
      queries
        .filter((q) => q.position >= 3.5 && q.position <= 20.5 && q.impressions >= minImpressions)
        .map((q) => {
          const gain = Math.max(0, Math.round(q.impressions * expectedCtr(3) - q.clicks));
          const page2 = q.position > 10.5;
          return {
            id: `striking-distance:${q.key}`,
            kind: "striking-distance" as const,
            title: `Move “${q.key}” from #${q.position} into the top 3`,
            why: `${q.impressions.toLocaleString("en-US")} impressions at an average position of ${q.position}${page2 ? " (page two, where few people look)" : ""}. In the top 3 this query would earn about ${gain.toLocaleString("en-US")} more clicks over the same period.`,
            steps: [
              `Find the page that ranks for “${q.key}” (Top pages, or URL inspection) and make the query its main topic: in the title, the H1 and the first paragraph.`,
              "Answer the searcher's question directly near the top, then add the depth the current top 3 results cover and you don't.",
              `Add internal links to that page from related pages, with anchor text close to “${q.key}”.`,
              "Refresh the content (date, examples, data) and request re-indexing with URL inspection.",
            ],
            query: q.key,
            ...base(q),
            estGain: gain,
          };
        })
        .filter((o) => o.estGain > 0),
    ),
  );

  // (b) Low CTR: already on top, but clicked far less than the position suggests.
  out.push(
    ...top(
      queries
        .filter((q) => q.position > 0 && q.position <= 5.5 && q.impressions >= minImpressions * 2 && q.ctr < expectedCtr(q.position) * 0.5)
        .map((q) => {
          const exp = expectedCtr(q.position);
          const gain = Math.max(0, Math.round(q.impressions * exp * 0.8 - q.clicks));
          return {
            id: `low-ctr:${q.key}`,
            kind: "low-ctr" as const,
            title: `Rewrite the snippet for “${q.key}”`,
            why: `Position ${q.position} but only ${(q.ctr * 100).toFixed(1)}% click-through, against roughly ${(exp * 100).toFixed(0)}% expected there. A better title and description could bring about ${gain.toLocaleString("en-US")} more clicks.`,
            steps: [
              `Search “${q.key}” and look at what Google shows: AI Overview, featured snippet, ads, or a rewritten title for your page.`,
              "Rewrite the <title> to lead with the query's intent and a concrete benefit (keep it under ~60 characters), and make the meta description answer the query.",
              "Add structured data that earns rich results where it fits (FAQ, HowTo, Product, Review, Breadcrumb).",
              "Check the result in two to four weeks: CTR should rise at a similar position.",
            ],
            query: q.key,
            ...base(q),
            estGain: gain,
          };
        })
        .filter((o) => o.estGain > 0),
    ),
  );

  // (c) Cannibalisation: two or more of your pages split one query's impressions.
  const byQuery = new Map<string, Row[]>();
  for (const r of queryPages) {
    const q = r.keys?.[0];
    if (!q || !r.keys?.[1]) continue;
    const list = byQuery.get(q);
    if (list) list.push(r);
    else byQuery.set(q, [r]);
  }
  const cannibal: GscOpportunity[] = [];
  for (const [q, rows] of byQuery) {
    if (rows.length < 2) continue;
    const impressions = rows.reduce((n, r) => n + r.impressions, 0);
    if (impressions < minImpressions) continue;
    const split = rows.filter((r) => r.impressions / impressions >= 0.1).sort((a, b) => b.impressions - a.impressions);
    if (split.length < 2) continue;
    const clicks = rows.reduce((n, r) => n + r.clicks, 0);
    const best = Math.min(...split.map((r) => r.position));
    const position = r1(rows.reduce((n, r) => n + r.position * r.impressions, 0) / impressions);
    const gain = Math.max(0, Math.round(impressions * expectedCtr(best) - clicks));
    cannibal.push({
      id: `cannibalisation:${q}`,
      kind: "cannibalisation",
      title: `${split.length} pages compete for “${q}”`,
      why: `Google alternates between ${split.map((r) => pathOf(r.keys![1])).join(", ")} for this query, so neither builds a strong position. One consolidated page ranking at #${r1(best)} would earn about ${gain.toLocaleString("en-US")} more clicks.`,
      steps: [
        "Pick the page that best matches the query's intent (usually the one with the best position or most links).",
        "Merge the useful content from the others into it, then 301-redirect them, or point their canonical at it if they must stay.",
        "Re-target the pages you keep at distinct queries, and update internal links so the query's anchor text points only at the chosen page.",
      ],
      query: q,
      pages: split.slice(0, 5).map((r) => ({ page: r.keys![1], clicks: r.clicks, impressions: r.impressions, position: r1(r.position), share: Math.round((r.impressions / impressions) * 100) })),
      impressions,
      clicks,
      ctr: r4(impressions ? clicks / impressions : 0),
      position,
      estGain: gain,
    });
  }
  out.push(...top(cannibal));

  // (d) Decliners: the biggest click losses vs the previous period.
  const declining = (rows: KeyRow[], isPage: boolean): GscOpportunity[] =>
    rows
      .filter((r) => r.prevClicks != null && r.prevClicks >= 5 && r.prevClicks - r.clicks >= Math.max(3, r.prevClicks * 0.2))
      .map((r) => {
        const lost = r.prevClicks! - r.clicks;
        const posDrop = r.prevPosition != null ? r1(r.position - r.prevPosition) : null;
        const label = isPage ? pathOf(r.key) : `“${r.key}”`;
        return {
          id: `declining:${isPage ? "page" : "query"}:${r.key}`,
          kind: "declining" as const,
          title: `${label} lost ${lost.toLocaleString("en-US")} clicks`,
          why: `${r.prevClicks!.toLocaleString("en-US")} clicks in the previous period, ${r.clicks.toLocaleString("en-US")} now${posDrop != null && posDrop > 0.4 ? `; average position fell by ${posDrop}` : posDrop != null && Math.abs(posDrop) <= 0.4 ? " at a similar position, so demand or the SERP layout (AI Overview, new features) changed" : ""}.`,
          steps: isPage
            ? [
                "Inspect the URL: confirm it's still indexed, with the canonical you expect, and fetched without errors.",
                "Compare its queries now vs before (filter Top queries by this page in Search Console) to see which ones dropped.",
                "Check what changed on the page (content, title, internal links, speed) and what now outranks it; update it to match the intent better.",
              ]
            : [
                `Search “${r.key}” and note what now ranks above you or what new SERP features (AI Overview, videos, forums) took the clicks.`,
                "Refresh the ranking page: answer the query first, update facts and dates, and cover what the new winners cover.",
                "If an AI Overview appeared, make the answer quotable: a direct one-to-two sentence answer, a list or table, and a cited source.",
              ],
          ...(isPage ? { page: r.key } : { query: r.key }),
          ...base(r),
          estGain: lost,
        };
      });
  out.push(...top([...declining(queries, false), ...declining(pages, true)]));

  // (e) Question / comparison queries: the kind AI Overviews answer, so answer-first content wins citations.
  out.push(
    ...top(
      queries
        .filter((q) => q.impressions >= minImpressions && isQuestionQuery(q.key))
        .map((q) => ({
          id: `answer-first:${q.key}`,
          kind: "answer-first" as const,
          title: `Answer “${q.key}” in the first lines`,
          why: `A question or comparison search with ${q.impressions.toLocaleString("en-US")} impressions at position ${q.position}. Google often shows an AI Overview for these; pages that answer directly and clearly are the ones it cites.`,
          steps: [
            `Put a direct one-to-two sentence answer to “${q.key}” right under the matching heading (phrase the heading as the question).`,
            "Follow it with a short list, steps or a comparison table, then the detail; cite sources for claims and numbers.",
            "Add FAQ or HowTo structured data where it fits, and keep the page crawlable without JavaScript.",
            "Track AI Overview citations for this query on the AI visibility page.",
          ],
          query: q.key,
          ...base(q),
          estGain: null,
        })),
    ),
  );

  return out;
}
