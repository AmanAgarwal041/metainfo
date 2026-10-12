import { NextRequest, NextResponse } from "next/server";
import { normalizeUrl, ScanError } from "@/lib/server/fetch-bundle";
import { crawlSite, scraperConfigured } from "@/lib/server/scraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/crawl {url, maxPages, maxDepth} → a site crawl from the Scrapling
 * service, streamed through untouched (no parsing, so almost no Worker CPU).
 * 501 when no service is configured: the browser then crawls page by page.
 */
export async function POST(req: NextRequest) {
  if (!scraperConfigured()) return NextResponse.json({ error: "No crawl service configured.", code: "no-scraper" }, { status: 501 });
  const body = await req.json().catch(() => ({}));
  try {
    const url = normalizeUrl(String(body.url ?? "")).toString();
    const maxPages = Math.min(Math.max(Number(body.maxPages) || 50, 1), 200);
    const maxDepth = Math.min(Math.max(Number(body.maxDepth) || 4, 0), 6);
    const res = await crawlSite(url, maxPages, maxDepth);
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof ScanError ? e.status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
