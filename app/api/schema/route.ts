import { NextRequest, NextResponse } from "next/server";
import { ScanError } from "@/lib/server/fetch-bundle";
import { validateSchemaOnServer } from "@/lib/server/engine";
import { validateUrl } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(e: unknown) {
  const status = e instanceof ScanError ? e.status : 502;
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
}

/**
 * GET /api/schema?url=…[&render=0] → schema.org validation of a live page: the
 * raw HTML, plus the rendered DOM when the Scrapling service is configured.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing ?url=" }, { status: 400 });
  try {
    return NextResponse.json(await validateUrl(url, req.nextUrl.searchParams.get("render") !== "0"), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/schema with an HTML page or markup snippet as the body (≤ 3 MB). */
export async function POST(req: NextRequest) {
  const html = await req.text();
  if (!html.trim()) return NextResponse.json({ error: "Send the HTML or JSON-LD snippet as the request body." }, { status: 400 });
  if (html.length > 3_000_000) return NextResponse.json({ error: "Body is larger than 3 MB." }, { status: 413 });
  try {
    return NextResponse.json(validateSchemaOnServer(html));
  } catch (e) {
    return fail(e);
  }
}
