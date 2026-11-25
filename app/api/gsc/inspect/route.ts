import { inspectUrl, validSite } from "@/lib/server/gsc";
import { BadInput } from "@/lib/server/gsc-report";
import { gscRoute, readJson } from "@/lib/server/gsc-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST {site, url}: Google's index status for one URL of the property. */
export const POST = gscRoute(async (req, auth) => {
  const body = await readJson(req);
  if (!validSite(body.site)) throw new BadInput('"site" must be a Search Console property.');
  const url = typeof body.url === "string" ? body.url.trim() : "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadInput('"url" must be a full URL, e.g. https://example.com/page');
  }
  if (!/^https?:$/.test(parsed.protocol) || url.length > 2000) throw new BadInput('"url" must be an http(s) URL.');
  return inspectUrl(auth, body.site, parsed.href);
});
