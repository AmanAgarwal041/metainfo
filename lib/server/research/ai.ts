// Ask an AI engine a prompt (with web search) and return its answer and the
// sources it cited. Brand matching happens client-side so a project's brand
// and competitors can change without re-paying for answers.
//
// ChatGPT, Claude, Gemini and Perplexity: DataForSEO AI Optimization
// `{engine}/llm_responses/live`; model names come from the free models catalog
// (DataForSEO bills tasks that fail on an invalid model). Google AI Overview:
// the SERP API with the AI Overview loaded.

import { BadRequest, requireProvider } from "@/lib/server/research-route";
import { call, getCatalog } from "@/lib/server/dataforseo";
import { serpCheck } from "./serp";
import type { AiAnswer, AiEngine, Location } from "@/lib/research-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const SLUG: Record<Exclude<AiEngine, "google">, string> = {
  chatgpt: "chat_gpt",
  claude: "claude",
  gemini: "gemini",
  perplexity: "perplexity",
};

function collectStrings(node: Json, keys: Set<string>, out: string[]) {
  if (Array.isArray(node)) return node.forEach((n) => collectStrings(n, keys, out));
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string" && keys.has(k)) out.push(v);
    else if (v && typeof v === "object" && !/source|citation|annotation|reference|link/i.test(k)) collectStrings(v, keys, out);
  }
}

function collectSources(node: Json, out: Map<string, { url: string; domain: string; title: string }>) {
  if (Array.isArray(node)) return node.forEach((n) => collectSources(n, out));
  if (!node || typeof node !== "object") return;
  if (typeof node.url === "string" && /^https?:\/\//.test(node.url)) {
    try {
      const u = new URL(node.url);
      if (!out.has(u.href)) out.set(u.href, { url: u.href, domain: u.hostname.replace(/^www\./, ""), title: String(node.title ?? node.source ?? "") });
    } catch {
      /* skip malformed */
    }
  }
  for (const v of Object.values(node)) if (v && typeof v === "object") collectSources(v, out);
}

const SKIP_MODEL = /mini|nano|lite|flash-8b|haiku|small|instant/i;

async function pickModel(slug: string): Promise<string> {
  const override = process.env[`DATAFORSEO_MODEL_${slug.toUpperCase()}`];
  if (override) return override;
  const catalog = await getCatalog(`ai_optimization/${slug}/llm_responses/models`);
  const names: string[] = [];
  const walk = (n: Json) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      if (typeof n.model_name === "string") names.push(n.model_name);
      Object.values(n).forEach((v) => v && typeof v === "object" && walk(v));
    }
  };
  walk(catalog);
  if (!names.length) throw new Error(`No ${slug} models available from DataForSEO.`);
  return names.find((m) => !SKIP_MODEL.test(m)) ?? names[0];
}

export async function askEngine(engine: AiEngine, prompt: string, location: Location): Promise<AiAnswer> {
  requireProvider();
  const text = prompt.trim().slice(0, 500);
  if (!text) throw new BadRequest("Missing prompt.");

  if (engine === "google") {
    const serp = await serpCheck(text, "desktop", location);
    return {
      engine,
      model: "Google AI Overview",
      prompt: text,
      answered: Boolean(serp.aiOverview),
      text: serp.aiOverview ? "" : "Google showed no AI Overview for this query.",
      sources: serp.aiOverview?.references ?? [],
      cost: serp.cost,
      cached: serp.cached,
    };
  }

  const slug = SLUG[engine];
  if (!slug) throw new BadRequest(`Unknown engine: ${engine}`);
  const model = await pickModel(slug);
  const r = await call(`ai_optimization/${slug}/llm_responses/live`, {
    user_prompt: text,
    model_name: model,
    web_search: true,
    ...(engine === "claude" ? { force_web_search: true } : {}),
    web_search_country_iso_code: location.gl.toUpperCase() === "UK" ? "GB" : location.gl.toUpperCase(),
    max_output_tokens: 1024,
  });
  const parts: string[] = [];
  collectStrings(r.result, new Set(["text", "markdown", "content", "message"]), parts);
  const sources = new Map<string, { url: string; domain: string; title: string }>();
  collectSources(r.result, sources);
  const answer = [...new Set(parts)].join("\n\n").trim();
  return {
    engine,
    model: String(r.result?.model_name ?? model),
    prompt: text,
    answered: answer.length > 0,
    text: answer.slice(0, 12_000),
    sources: [...sources.values()].slice(0, 40),
    cost: Math.round(r.cost * 10000) / 10000,
    cached: r.cached,
  };
}
