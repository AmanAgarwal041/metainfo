import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, status } from "@/lib/server/gsc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What's configured and whether this browser is connected. Never calls Google. */
export async function GET(req: NextRequest) {
  return NextResponse.json(await status(req.cookies.get(SESSION_COOKIE)?.value, req.headers), { headers: { "cache-control": "no-store" } });
}
