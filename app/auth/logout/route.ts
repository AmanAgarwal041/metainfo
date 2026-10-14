import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { deleteSession, SESSION_COOKIE } from "@/lib/server/auth/accounts";
import { assertSameOrigin, handle, sessionCookie } from "@/lib/server/auth/session";

export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const db = await getDb();
    if (db) await deleteSession(db, (await cookies()).get(SESSION_COOKIE)?.value);
    return sessionCookie(NextResponse.json({ ok: true }), req, null);
  });
}
