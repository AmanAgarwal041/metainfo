import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { clerkEnabled } from "@/lib/server/auth/clerk";
import { currentSession, handle } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/session → whether this server can save workspaces (a database and Clerk keys), and the
 * signed-in workspace if any. Who is signed in comes from Clerk in the browser; this is the server's view.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const available = !!(await getDb()) && clerkEnabled();
    const s = available ? await currentSession(req) : null;
    const headers = { "cache-control": "no-store" };
    if (!s) return NextResponse.json({ available, authenticated: false }, { headers });
    return NextResponse.json({ available, authenticated: true, workspace: { id: s.scope, personal: s.personal, role: s.role } }, { headers });
  });
}
