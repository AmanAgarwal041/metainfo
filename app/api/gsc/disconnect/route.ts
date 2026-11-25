import { NextRequest, NextResponse } from "next/server";
import { openToken, revoke, SESSION_COOKIE } from "@/lib/server/gsc";
import { sameOrigin, sessionCookie } from "@/lib/server/gsc-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clear the connection cookie and revoke the grant at Google (best effort). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const refresh = await openToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (refresh) await revoke(refresh);
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookie(req), maxAge: 0 });
  return res;
}
