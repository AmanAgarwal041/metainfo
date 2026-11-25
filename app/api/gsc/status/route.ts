import { NextRequest, NextResponse } from "next/server";
import { gscStatus } from "@/lib/server/gsc-auth";
import { gscError, NO_STORE } from "@/lib/server/gsc-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?projectId= → mode, connection, who may manage it, and the project's saved property. Never calls Google. */
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await gscStatus(req, req.nextUrl.searchParams.get("projectId")), { headers: NO_STORE });
  } catch (e) {
    return gscError(req, e);
  }
}
