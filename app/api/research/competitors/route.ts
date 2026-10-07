import { param, researchRoute } from "@/lib/server/research-route";
import { competitorResearch } from "@/lib/server/research/competitors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = researchRoute((req, { location }) => competitorResearch(param(req, "domain"), location));
