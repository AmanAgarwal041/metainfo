// Fetches everything the engine needs for one URL: the page (following
// redirects by hand so the chain is recorded), robots.txt, llms.txt, sitemaps,
// and the page again with each crawler's user agent to detect CDN/WAF blocks.

import type { Resource, ScanInput } from "@/lib/types";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** ids must match `crawlers.rs`. Only search/user-facing bots are probed. */
const BOT_UAS: Record<string, string> = {
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  bingbot: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "oai-searchbot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
  "chatgpt-user": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)",
  "claude-searchbot": "Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)",
  "claude-user": "Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  claudebot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  perplexitybot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  "perplexity-user": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
};

const PAGE_MAX_BYTES = 5 * 1024 * 1024;
const TEXT_MAX_BYTES = 512 * 1024;
const SITEMAP_MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 10;

export class ScanError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ---------------------------------------------------------------- SSRF guard

/** 4 for an IPv4 literal, 6 for IPv6, 0 otherwise (node:net.isIP without the import). */
function ipVersion(s: string): 0 | 4 | 6 {
  if (/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(s)) return 4;
  if (s.includes(":") && /^[0-9a-f:.]+$/i.test(s)) return 6;
  return 0;
}

function isPrivateIp(ip: string): boolean {
  if (ipVersion(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const l = ip.toLowerCase();
  if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
  return l === "::" || l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
}

/** True when running on Cloudflare Workers (workerd). */
const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScanError(`Only http(s) URLs can be scanned (got ${url.protocol}).`);
  }
  if (process.env.ALLOW_PRIVATE_HOSTS === "1") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new ScanError("That host resolves to a private network address and can't be scanned.");
  }
  // Workers can't reach private networks (global_fetch_strictly_public), so only literal IPs need checking there.
  if (onWorkers && !ipVersion(host)) return;
  const addrs = ipVersion(host)
    ? [{ address: host }]
    : await (await import("node:dns/promises")).default.lookup(host, { all: true }).catch(() => {
        throw new ScanError(`Could not resolve ${host}.`);
      });
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new ScanError("That host resolves to a private network address and can't be scanned.");
  }
}

export function normalizeUrl(raw: string): URL {
  let s = raw.trim();
  if (!s) throw new ScanError("Enter a URL to scan.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    u.hash = "";
    return u;
  } catch {
    throw new ScanError("That doesn't look like a valid URL.");
  }
}

// ---------------------------------------------------------------- fetching

interface FetchResult {
  url: string;
  status: number;
  headers: Record<string, string>;
  bytes: Uint8Array | null;
  redirects: { url: string; status: number }[];
  ttfbMs: number;
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, out.length - off);
    out.set(c.subarray(0, take), off);
    off += take;
    if (off >= out.length) break;
  }
  return out;
}

async function fetchFollow(
  start: URL,
  opts: { ua: string; maxBytes: number; accept?: string; headersOnly?: boolean },
): Promise<FetchResult> {
  let current = start;
  const redirects: FetchResult["redirects"] = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(current);
    const t0 = performance.now();
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "user-agent": opts.ua,
        accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    const ttfbMs = Math.round(performance.now() - t0);
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      redirects.push({ url: current.toString(), status: res.status });
      current = new URL(location, current);
      continue;
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    let bytes: Uint8Array | null = null;
    if (opts.headersOnly) {
      await res.body?.cancel().catch(() => {});
    } else {
      bytes = await readCapped(res, opts.maxBytes);
    }
    return { url: current.toString(), status: res.status, headers, bytes, redirects, ttfbMs };
  }
  throw new ScanError(`More than ${MAX_REDIRECTS} redirects.`, 502);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decode(bytes: Uint8Array, contentType?: string): Promise<string> {
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      bytes = await gunzip(bytes);
    } catch {
      /* fall through with raw bytes */
    }
  }
  const charset = /charset=([\w-]+)/i.exec(contentType ?? "")?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function fetchResource(url: URL, maxBytes: number, accept = "text/plain,*/*;q=0.8"): Promise<Resource> {
  try {
    const r = await fetchFollow(url, { ua: BROWSER_UA, maxBytes, accept });
    return {
      url: url.toString(),
      status: r.status,
      contentType: r.headers["content-type"] ?? null,
      body: r.bytes ? await decode(r.bytes, r.headers["content-type"]) : null,
    };
  } catch (e) {
    return { url: url.toString(), status: null, error: errMessage(e) };
  }
}

function errMessage(e: unknown): string {
  if (e instanceof ScanError) return e.message;
  if (e instanceof Error) {
    if (e.name === "TimeoutError") return `Timed out after ${TIMEOUT_MS / 1000}s`;
    const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ? `${e.message} (${cause.code})` : e.message;
  }
  return String(e);
}

function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/g)].map((m) =>
    m[1].replace(/&amp;/g, "&"),
  );
}

async function fetchSitemaps(origin: string, robotsBody: string | null, pagePath: string): Promise<Resource[]> {
  const declared = robotsBody
    ? [...robotsBody.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1])
    : [];
  const candidates = (declared.length ? declared : [`${origin}/sitemap.xml`]).slice(0, 3);
  const top = await Promise.all(
    candidates.map((u) => {
      try {
        return fetchResource(new URL(u, origin), SITEMAP_MAX_BYTES, "application/xml,text/xml,*/*;q=0.8");
      } catch {
        return Promise.resolve<Resource>({ url: u, status: null, error: "Invalid sitemap URL" });
      }
    }),
  );
  // For sitemap indexes, fetch a few children, preferring ones that look related to this page.
  const firstSeg = pagePath.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  const children = top
    .filter((r) => r.body?.includes("<sitemapindex"))
    .flatMap((r) => sitemapLocs(r.body!))
    .sort((a, b) => Number(firstSeg && b.toLowerCase().includes(firstSeg)) - Number(firstSeg && a.toLowerCase().includes(firstSeg)))
    .slice(0, 4);
  const childRes = await Promise.all(
    children.map((u) => fetchResource(new URL(u), SITEMAP_MAX_BYTES, "application/xml,text/xml,*/*;q=0.8")),
  );
  return [...top, ...childRes];
}

export async function buildBundle(rawUrl: string): Promise<ScanInput> {
  const started = performance.now();
  const target = normalizeUrl(rawUrl);

  let page: FetchResult;
  try {
    page = await fetchFollow(target, { ua: BROWSER_UA, maxBytes: PAGE_MAX_BYTES });
  } catch (e) {
    if (e instanceof ScanError) throw e;
    throw new ScanError(`Couldn't fetch ${target.host}: ${errMessage(e)}`, 502);
  }
  const final = new URL(page.url);
  const origin = final.origin;
  const contentType = page.headers["content-type"] ?? "";
  if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
    throw new ScanError(`That URL returned ${contentType}, not an HTML page.`, 422);
  }

  const [robots, llms, probes] = await Promise.all([
    fetchResource(new URL("/robots.txt", origin), TEXT_MAX_BYTES),
    fetchResource(new URL("/llms.txt", origin), TEXT_MAX_BYTES),
    Promise.all(
      Object.entries(BOT_UAS).map(async ([bot, ua]) => {
        try {
          const r = await fetchFollow(final, { ua, maxBytes: 0, headersOnly: true });
          return { bot, status: r.status };
        } catch (e) {
          return { bot, status: null, error: errMessage(e) };
        }
      }),
    ),
  ]);
  const robotsOk = robots.status && robots.status < 300 ? robots.body ?? null : null;
  const sitemaps = await fetchSitemaps(origin, robotsOk, final.pathname);

  return {
    url: target.toString(),
    finalUrl: page.url,
    status: page.status,
    headers: page.headers,
    html: page.bytes ? await decode(page.bytes, contentType) : "",
    redirects: page.redirects,
    ttfbMs: page.ttfbMs,
    robots,
    sitemaps,
    llms,
    botProbes: probes,
    fetchMs: Math.round(performance.now() - started),
  };
}
