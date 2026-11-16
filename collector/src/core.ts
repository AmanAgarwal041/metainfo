/**
 * MetaInfo traffic collector, core (protocol v1). No dependencies: standard Web APIs only (Request, fetch,
 * URL, AbortSignal), so the same file runs on Cloudflare Workers and Pages, Vercel, Netlify, Deno and Node 18+.
 *
 * It reports page loads (people, AI crawlers, search engines and other bots alike) to MetaInfo, which works
 * out who each visitor was. It never changes or delays a response, and never throws:
 *   - static files, a page's sub-requests (images, scripts, fetch/XHR), prefetches, API calls and MetaInfo's
 *     own audit probes aren't reported;
 *   - an event holds the time, method, host, path, status, user agent, the referer's origin and path, the
 *     `utm_source` parameter, and the `Sec-Fetch-Mode` and `Signature-Agent` headers. Never an IP address,
 *     a cookie, the rest of the query string or any other header;
 *   - events are sent in the background (`waitUntil`), batched when the runtime keeps instances warm.
 *
 * Keep this file in sync with `TrafficEvent` in lib/traffic.ts (the server side).
 */

export const PROTOCOL = 1;
export const DEFAULT_ENDPOINT = "https://metainfo.agarwal-aman041.workers.dev/api/traffic/events";

export interface CollectorEvent {
  v: 1;
  ts: number;
  method: string;
  host: string;
  path: string;
  /** 0 when the adapter can't see the response (Next.js proxy runs before the page renders). */
  status: number;
  ua: string;
  referer?: string;
  utm?: string;
  fetchMode?: string;
  signatureAgent?: string;
}

export interface CollectorOptions {
  /**
   * The three values from MetaInfo's Traffic page. MetaInfo only accepts a batch when all three match, so
   * events always land in the right workspace and site. Missing any of them, nothing is reported.
   */
  /** Secret: the site's collector token (`mtr_...`). */
  token: string | undefined;
  /** The workspace (organisation) id the site belongs to (`org_...`, or `user_...` for a personal workspace). */
  org: string | undefined;
  /** The site's URL, e.g. `https://example.com`. Requests to other hosts (previews, staging) aren't reported. */
  site: string | undefined;
  /** MetaInfo's ingest URL. Defaults to the hosted MetaInfo. */
  endpoint?: string;
  /** Which adapter is reporting (shown on the Traffic page). */
  via: string;
  /**
   * Batch events across requests: for runtimes that keep an instance alive between requests (Cloudflare
   * Workers and Pages). Off: each page load is sent on its own (serverless functions, Next.js proxy).
   */
  batch?: boolean;
  /** For tests. */
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type WaitUntil = (promise: Promise<unknown>) => void;

export interface Collector {
  /** Reports the request if it's a page load. Call it once the response status is known. Never throws. */
  observe(request: Request, status: number, waitUntil: WaitUntil): void;
  /** Sends what's waiting now (tests, shutdown). */
  flush(): Promise<void>;
  readonly pending: number;
}

export const MAX_BATCH = 500;
export const MAX_AGE_MS = 5000;
/** Unsent events kept while MetaInfo can't take them. */
export const MAX_BUFFERED = MAX_BATCH * 4;
const SEND_TIMEOUT_MS = 5000;

const ASSET = /\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|ogg|m4a|zip|gz|wasm)$/i;
const SKIP_PREFIXES = ["/_next/", "/cdn-cgi/", "/__nextjs", "/@vite/", "/node_modules/"];
const PAGE_DESTS = new Set(["document", "iframe", "frame"]);
/** Set by MetaInfo's own audits, so testing your site with MetaInfo doesn't count as crawler traffic. */
export const PROBE_HEADER = "x-metainfo-probe";

/** Whether a request is a page load worth reporting. */
export function isPageLoad(request: Request, url: URL = new URL(request.url)): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const h = request.headers;
  if (h.has(PROBE_HEADER) || h.has("x-requested-with")) return false;
  if (ASSET.test(url.pathname) || SKIP_PREFIXES.some((p) => url.pathname.startsWith(p))) return false;
  const dest = h.get("sec-fetch-dest");
  if (dest && !PAGE_DESTS.has(dest)) return false;
  if (`${h.get("sec-purpose") ?? ""} ${h.get("purpose") ?? ""}`.includes("prefetch")) return false;
  // Next.js client navigations and prefetches (React Server Component payloads).
  if (h.has("rsc") || h.has("next-router-prefetch")) return false;
  const accept = (h.get("accept") ?? "").toLowerCase();
  if (accept.includes("json") && !accept.includes("html") && !accept.includes("markdown")) return false;
  return true;
}

function refererOf(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`.slice(0, 2048);
  } catch {
    return undefined;
  }
}

const cap = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : undefined);

export function toEvent(request: Request, status: number, now: number, url: URL = new URL(request.url)): CollectorEvent {
  const h = request.headers;
  return {
    v: PROTOCOL,
    ts: now,
    method: request.method,
    host: url.host,
    path: url.pathname.slice(0, 2048),
    status: Number.isInteger(status) && status > 0 ? status : 0,
    ua: (h.get("user-agent") ?? "").slice(0, 512),
    referer: refererOf(h.get("referer")),
    utm: cap(url.searchParams.get("utm_source"), 128),
    fetchMode: cap(h.get("sec-fetch-mode"), 32),
    signatureAgent: cap(h.get("signature-agent"), 255),
  };
}

/** The site's domain, without `www.`, from a URL or a bare domain; "" when it isn't one. */
export function siteDomain(site: string | undefined): string {
  const s = site?.trim().toLowerCase() ?? "";
  if (!s) return "";
  try {
    return new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A request host belongs to the site: the domain itself or a subdomain (www, docs, ...). */
export function onSite(host: string, domain: string): boolean {
  const h = host.toLowerCase().split(":")[0].replace(/^www\./, "");
  return !!domain && (h === domain || h.endsWith(`.${domain}`));
}

export function createCollector(options: CollectorOptions): Collector {
  const token = options.token?.trim();
  const org = options.org?.trim();
  const site = options.site?.trim();
  const domain = siteDomain(site);
  const ready = !!(token && org && domain);
  if (!ready && (token || org || site)) {
    console.warn("[metainfo] traffic reporting is off: set METAINFO_TOKEN, METAINFO_ORG and METAINFO_SITE (all three are on MetaInfo's Traffic page)");
  }
  const endpoint = options.endpoint?.trim() || DEFAULT_ENDPOINT;
  const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  let buffer: CollectorEvent[] = [];
  let scheduled = false;
  let warned = false;

  /** Posts one batch. Resolves to whether it should be retried. */
  async function post(batch: CollectorEvent[]): Promise<boolean> {
    try {
      const res = await send(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/x-ndjson",
          "x-metainfo-org": org!,
          "x-metainfo-site": site!,
          "x-metainfo-collector": options.via,
        },
        body: batch.map((e) => JSON.stringify(e)).join("\n"),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (res.status !== 202 && !warned) {
        warned = true;
        console.warn(`[metainfo] traffic report refused (HTTP ${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
      } else {
        await res.body?.cancel().catch(() => {});
      }
      return res.status === 429 || res.status >= 500;
    } catch (err) {
      if (!warned) {
        warned = true;
        console.warn(`[metainfo] traffic report failed: ${err}`);
      }
      return true;
    }
  }

  async function flush(): Promise<void> {
    while (buffer.length) {
      const batch = buffer.slice(0, MAX_BATCH);
      buffer = buffer.slice(MAX_BATCH);
      if (await post(batch)) {
        // Keep it for the next flush; stop here rather than hammering an unavailable MetaInfo.
        buffer = batch.concat(buffer).slice(0, MAX_BUFFERED);
        return;
      }
    }
  }

  function observe(request: Request, status: number, waitUntil: WaitUntil): void {
    if (!ready) return;
    try {
      const url = new URL(request.url);
      if (!onSite(url.host, domain) || !isPageLoad(request, url)) return;
      const event = toEvent(request, status, now(), url);
      if (!options.batch) {
        waitUntil(post([event]));
        return;
      }
      buffer.push(event);
      if (buffer.length >= MAX_BATCH) {
        waitUntil(flush());
      } else if (!scheduled) {
        scheduled = true;
        waitUntil(
          sleep(MAX_AGE_MS).then(() => {
            scheduled = false;
            return flush();
          }),
        );
      }
    } catch (err) {
      console.warn(`[metainfo] traffic report skipped: ${err}`);
    }
  }

  return {
    observe,
    flush,
    get pending() {
      return buffer.length;
    },
  };
}
