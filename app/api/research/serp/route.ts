import { param, researchRoute } from "@/lib/server/research-route";
import { serpCheck } from "@/lib/server/research/serp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = researchRoute((req, { location }) => serpCheck(param(req, "q"), param(req, "device", false), location));
