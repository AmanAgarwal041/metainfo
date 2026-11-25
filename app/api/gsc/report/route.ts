import { buildReport, parseReportParams } from "@/lib/server/gsc-report";
import { gscRoute, readJson } from "@/lib/server/gsc-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST {site, days: 7|28|90|180|480, country?, device?, search_type?}. Rows are third-party (Google) data. */
export const POST = gscRoute(async (req, auth) => buildReport(auth, parseReportParams(await readJson(req))));
