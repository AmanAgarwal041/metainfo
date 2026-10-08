// Free keyword ideas from search autocomplete (Google, falling back to Bing
// and DuckDuckGo): what people actually type.
// The seed is expanded with question words, modifiers and common letters so we see the
// long tail. No volumes. Those need a data provider.

import type { KeywordRow } from "@/lib/research-types";

const QUESTION = ["how", "what", "why", "when", "where", "who", "which", "can", "is", "does", "are", "should"];
const COMMERCIAL = ["best", "top", "cheap", "free", "review", "reviews", "pricing", "price", "cost", "alternative", "alternatives", "buy", "deal"];
const COMPARISON = ["vs", "versus", "or", "compared", "comparison", "like"];
const PREPOSITION = ["for", "with", "without", "near", "to", "in", "on", "from", "and"];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; out: string[]; source: string }>();

// Google blocks some datacenter IPs (Cloudflare Workers get HTTP 403), so fall
// back to Bing and DuckDuckGo, which answer in the same OpenSearch format.
const SOURCES: { name: string; url: (q: string, gl: string, hl: string) => string }[] = [
  { name: "Google", url: (q, gl, hl) => `https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}` },
  { name: "Bing", url: (q, gl, hl) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}&market=${hl}-${gl.toUpperCase() === "UK" ? "GB" : gl.toUpperCase()}` },
  { name: "DuckDuckGo", url: (q, gl, hl) => `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list&kl=${gl === "uk" ? "uk" : gl}-${hl}` },
];
const BLOCK_MS = 10 * 60 * 1000;
const blockedUntil = new Map<string, number>();

async function suggest(q: string, gl: string, hl: string): Promise<{ out: string[]; source: string }> {
  const key = `${q}|${gl}|${hl}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { out: hit.out, source: hit.source };
  let lastError = "no source available";
  for (const src of SOURCES) {
    if ((blockedUntil.get(src.name) ?? 0) > Date.now()) continue;
    const res = await fetch(src.url(q, gl, hl), { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0" } }).catch((e) => e as Error);
    if (res instanceof Error) {
      lastError = `${src.name}: ${res.message}`;
      continue;
    }
    if (res.status === 403 || res.status === 429) {
      // This source refuses this server; skip it for a while instead of retrying every query.
      blockedUntil.set(src.name, Date.now() + BLOCK_MS);
      lastError = `${src.name} HTTP ${res.status}`;
      continue;
    }
    if (!res.ok) {
      lastError = `${src.name} HTTP ${res.status}`;
      continue;
    }
    const body = await res.json().catch(() => null);
    const out = Array.isArray(body?.[1]) ? (body[1] as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: Date.now(), out, source: src.name });
    return { out, source: src.name };
  }
  throw new Error(lastError);
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          out[i] = { status: "fulfilled", value: await fn(items[i]) };
        } catch (reason) {
          out[i] = { status: "rejected", reason };
        }
      }
    }),
  );
  return out;
}

export function groupOf(keyword: string, seed: string): KeywordRow["group"] {
  const rest = ` ${keyword.toLowerCase().replace(seed.toLowerCase(), " ")} `;
  const has = (words: string[]) => words.some((w) => rest.includes(` ${w} `));
  if (has(QUESTION) || keyword.trim().endsWith("?")) return "questions";
  if (has(COMPARISON)) return "comparisons";
  if (has(COMMERCIAL)) return "commercial";
  if (has(PREPOSITION)) return "prepositions";
  return "other";
}

export async function autocompleteIdeas(seed: string, gl: string, hl: string): Promise<{ keywords: string[]; failed: number; error?: string; sources: string[] }> {
  const s = seed.trim().toLowerCase();
  // About 36 lookups: Cloudflare Workers (Free) allow 50 outgoing requests per
  // invocation, and keyword research also needs up to 3 DataForSEO calls.
  const queries = [
    s,
    ...QUESTION.slice(0, 8).map((w) => `${w} ${s}`),
    ...COMMERCIAL.slice(0, 4).map((w) => `${w} ${s}`),
    ...COMPARISON.slice(0, 2).map((w) => `${s} ${w}`),
    ...PREPOSITION.slice(0, 3).map((w) => `${s} ${w}`),
    ..."abcdefghilmnoprstw".split("").map((c) => `${s} ${c}`),
  ];
  const results = await pool(queries, 6, (q) => suggest(q, gl, hl));
  const seen = new Set<string>();
  const keywords: string[] = [];
  let failed = 0;
  let error: string | undefined;
  const sources = new Set<string>();
  for (const r of results) {
    if (r.status === "rejected") {
      failed++;
      error ??= r.reason instanceof Error ? r.reason.message : String(r.reason);
      continue;
    }
    sources.add(r.value.source);
    for (const k of r.value.out) {
      const norm = k.trim().toLowerCase();
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        keywords.push(norm);
      }
    }
  }
  return { keywords, failed, error, sources: [...sources] };
}
