import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { saveAuthState } from "@/lib/server/auth/accounts";
import { appUrl, authorizeUrl, isProvider, safeReturn } from "@/lib/server/auth/providers";

export const dynamic = "force-dynamic";

/** GET /auth/{google|github}?invite=…&returnTo=/path → the provider's consent screen. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const base = appUrl(req);
  const db = await getDb();
  if (!db || !isProvider(provider)) return NextResponse.redirect(`${base}/login?error=${encodeURIComponent("That sign-in method isn't available.")}`);
  const sp = req.nextUrl.searchParams;
  // The PKCE verifier is stored with the state, so build the URL first and set the state afterwards.
  const pending = await authorizeUrl(provider, base, "");
  const state = await saveAuthState(db, { provider, verifier: pending.verifier, invite: sp.get("invite"), returnTo: safeReturn(sp.get("returnTo")) });
  const url = new URL(pending.url);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url.toString());
}
