import { analyzeAnswer, type Brand } from "@/lib/aeo";
import { BadRequest, researchRoute } from "@/lib/server/research-route";
import { judgeAnswer, llmConfigured } from "@/lib/server/aeo/llm";
import { bareDomain } from "@/lib/research-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/aeo/judge {text, sources, brands: [{domain, name, aliases?}]} → BrandResult[]
 * Code matching first, then Claude confirms mentions and judges sentiment. Needs ANTHROPIC_API_KEY.
 */
export const POST = researchRoute(async (req) => {
  if (!llmConfigured()) throw new BadRequest("Set ANTHROPIC_API_KEY on the server to judge answers with Claude.");
  const b = (await req.json().catch(() => null)) as { text?: unknown; sources?: unknown; brands?: unknown; prompt?: unknown } | null;
  const text = typeof b?.text === "string" ? b.text.slice(0, 20000) : "";
  if (!text) throw new BadRequest("Missing text.");
  const brands: Brand[] = (Array.isArray(b?.brands) ? b.brands : [])
    .slice(0, 6)
    .map((x: { domain?: unknown; name?: unknown; aliases?: unknown }) => ({
      domain: bareDomain(String(x?.domain ?? "")),
      name: String(x?.name ?? "").slice(0, 80),
      aliases: Array.isArray(x?.aliases) ? x.aliases.filter((a: unknown): a is string => typeof a === "string").slice(0, 5) : [],
    }))
    .filter((x) => x.domain);
  const sources = (Array.isArray(b?.sources) ? b.sources : []).filter((s: { domain?: unknown }) => typeof s?.domain === "string").slice(0, 40) as { domain: string }[];
  return judgeAnswer(text, brands, analyzeAnswer(text, sources, brands, typeof b?.prompt === "string" ? b.prompt.slice(0, 500) : ""));
});
