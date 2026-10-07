import { param, researchRoute } from "@/lib/server/research-route";
import { backlinkResearch } from "@/lib/server/research/backlinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = researchRoute((req) => backlinkResearch(param(req, "target"), param(req, "competitors", false).split(",")));
