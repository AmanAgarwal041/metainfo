import { param, researchRoute } from "@/lib/server/research-route";
import { keywordResearch } from "@/lib/server/research/keywords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = researchRoute((req, { location }) => keywordResearch(param(req, "q"), location));
