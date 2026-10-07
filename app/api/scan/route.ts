import { NextRequest, NextResponse } from "next/server";
import { buildBundle, ScanError } from "@/lib/server/fetch-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/scan?url=… → the raw scan bundle; the browser runs the WASM engine on it. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing ?url=" }, { status: 400 });
  try {
    const bundle = await buildBundle(url);
    return NextResponse.json(bundle, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof ScanError ? e.status : 500;
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status });
  }
}
