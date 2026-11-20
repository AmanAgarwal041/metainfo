import { BadRequest, researchRoute } from "@/lib/server/research-route";
import { simulate } from "@/lib/server/aeo/simulate";
import { AI_ENGINES, bareDomain, type AiEngine } from "@/lib/research-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/aeo/simulate {prompt, engine, domain, brand, competitors, cited, yourUrl?, explain?}
 * Fetches your page and the cited pages as the engine's crawler and scores them against the prompt. Free (no
 * DataForSEO); `explain` adds Claude's write-up when ANTHROPIC_API_KEY is set.
 */
export const POST = researchRoute(async (req) => {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const prompt = typeof b?.prompt === "string" ? b.prompt.trim().slice(0, 500) : "";
  const engine = b?.engine as AiEngine;
  const domain = bareDomain(typeof b?.domain === "string" ? b.domain : "");
  if (!prompt) throw new BadRequest("Missing prompt.");
  if (!AI_ENGINES.some((e) => e.id === engine)) throw new BadRequest("Unknown engine.");
  if (!domain) throw new BadRequest("Missing domain.");
  const strings = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);
  return simulate({
    prompt,
    engine,
    domain,
    brand: typeof b?.brand === "string" ? b.brand.slice(0, 80) : "",
    competitors: strings(b?.competitors, 5).map(bareDomain).filter(Boolean),
    cited: strings(b?.cited, 20).filter((u) => /^https?:\/\//.test(u)),
    yourUrl: typeof b?.yourUrl === "string" && /^https?:\/\//.test(b.yourUrl) ? b.yourUrl : undefined,
    explain: b?.explain === true,
  });
});
