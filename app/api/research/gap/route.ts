import { param, researchRoute } from "@/lib/server/research-route";
import { keywordGap } from "@/lib/server/research/gap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = researchRoute((req, { location }) => keywordGap(param(req, "you"), param(req, "them").split(","), location));
