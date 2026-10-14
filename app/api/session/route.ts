import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { providers } from "@/lib/server/auth/providers";
import { currentSession, handle } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";

/** GET /api/session → who's signed in (if anyone) and which sign-in methods exist. */
export async function GET() {
  return handle(async () => {
    const available = (await getDb()) ? providers() : [];
    const s = await currentSession();
    const headers = { "cache-control": "no-store" };
    if (!s) return NextResponse.json({ authenticated: false, providers: available }, { headers });
    return NextResponse.json({ authenticated: true, providers: available, user: s.user, org: s.org, orgs: s.orgs }, { headers });
  });
}
