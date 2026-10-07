// Free keyword ideas from Google Autocomplete: what people actually type.
// The seed is expanded with question words, modifiers and a–z so we see the
// long tail. No volumes. Those need a data provider.

import type { KeywordRow } from "@/lib/research-types";

const QUESTION = ["how", "what", "why", "when", "where", "who", "which", "can", "is", "does", "are", "should"];
const COMMERCIAL = ["best", "top", "cheap", "free", "review", "reviews", "pricing", "price", "cost", "alternative", "alternatives", "buy", "deal"];
const COMPARISON = ["vs", "versus", "or", "compared", "comparison", "like"];
const PREPOSITION = ["for", "with", "without", "near", "to", "in", "on", "from", "and"];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; out: string[] }>();

async function suggest(q: string, gl: string, hl: string): Promise<string[]> {
  const key = `${q}|${gl}|${hl}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.out;
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Autocomplete HTTP ${res.status}`);
  const body = await res.json();
  const out = Array.isArray(body?.[1]) ? (body[1] as unknown[]).filter((s): s is string => typeof s === "string") : [];
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), out });
  return out;
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

export async function autocompleteIdeas(seed: string, gl: string, hl: string): Promise<{ keywords: string[]; failed: number }> {
  const s = seed.trim().toLowerCase();
  const queries = [
    s,
    ...QUESTION.map((w) => `${w} ${s}`),
    ...COMMERCIAL.slice(0, 6).map((w) => `${w} ${s}`),
    ...COMPARISON.slice(0, 2).map((w) => `${s} ${w}`),
    ...PREPOSITION.slice(0, 4).map((w) => `${s} ${w}`),
    ..."abcdefghijklmnopqrstuvwxyz".split("").map((c) => `${s} ${c}`),
  ];
  const results = await pool(queries, 6, (q) => suggest(q, gl, hl));
  const seen = new Set<string>();
  const keywords: string[] = [];
  let failed = 0;
  for (const r of results) {
    if (r.status === "rejected") {
      failed++;
      continue;
    }
    for (const k of r.value) {
      const norm = k.trim().toLowerCase();
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        keywords.push(norm);
      }
    }
  }
  return { keywords, failed };
}
