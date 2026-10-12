import { NextRequest, NextResponse } from "next/server";
import { normalizeUrl, ScanError } from "@/lib/server/fetch-bundle";
import { renderPage, scraperConfigured } from "@/lib/server/scraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/render?url=… → the page's DOM after JavaScript, from the Scrapling service. */
export async function GET(req: NextRequest) {
  if (!scraperConfigured()) return NextResponse.json({ error: "No rendering service configured.", code: "no-scraper" }, { status: 501 });
  try {
    const url = normalizeUrl(req.nextUrl.searchParams.get("url") ?? "").toString();
    const r = await renderPage(url);
    return NextResponse.json(r, { status: "error" in r ? 502 : 200, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof ScanError ? e.status : 502 });
  }
}
