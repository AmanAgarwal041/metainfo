import { researchRoute } from "@/lib/server/research-route";
import { accountInfo } from "@/lib/server/dataforseo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/research/account → the DataForSEO login and balance for the keys in use (free). */
export const GET = researchRoute(() => accountInfo());
