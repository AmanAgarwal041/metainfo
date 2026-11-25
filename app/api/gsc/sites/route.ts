import { listSites } from "@/lib/server/gsc";
import { gscRoute } from "@/lib/server/gsc-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Search Console properties the connected account (or service account) can read. */
export const GET = gscRoute(async (_req, auth) => ({ via: auth.via, sites: await listSites(auth) }));
