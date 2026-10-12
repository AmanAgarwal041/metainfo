import { NextRequest, NextResponse } from "next/server";
import { fetchPage, ScanError } from "@/lib/server/fetch-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/page?url=… → one page's status, headers and HTML (the built-in crawler's fetch). */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing ?url=" }, { status: 400 });
  try {
    return NextResponse.json(await fetchPage(url), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof ScanError ? e.status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
