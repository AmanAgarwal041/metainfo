import { param, researchRoute } from "@/lib/server/research-route";
import { askEngine } from "@/lib/server/research/ai";
import type { AiEngine } from "@/lib/research-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/research/ai?engine=chatgpt|claude|gemini|perplexity|google&prompt=&loc= */
export const GET = researchRoute((req, { location }) => askEngine(param(req, "engine") as AiEngine, param(req, "prompt"), location));
