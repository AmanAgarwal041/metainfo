import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { acceptInvites, AuthError, createOrg, createSession, membershipsFor, takeAuthState, upsertUser } from "@/lib/server/auth/accounts";
import { appUrl, identityFor, isProvider } from "@/lib/server/auth/providers";
import { sessionCookie } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";

/** OAuth callback: verify state, fetch the identity, join invites, create the first organisation, start a session. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const base = appUrl(req);
  const fail = (msg: string) => NextResponse.redirect(`${base}/login?error=${encodeURIComponent(msg)}`);
  const sp = req.nextUrl.searchParams;
  const db = await getDb();
  if (!db || !isProvider(provider)) return fail("That sign-in method isn't available.");
  if (sp.get("error")) return fail(sp.get("error_description") || "Sign-in was cancelled.");
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) return fail("The sign-in response was incomplete. Try again.");
  try {
    const saved = await takeAuthState(db, state);
    if (!saved || saved.provider !== provider) return fail("That sign-in link expired. Try again.");
    const identity = await identityFor(provider, base, code, saved.verifier, sp.get("email") ?? undefined);
    const user = await upsertUser(db, identity);
    const { preferred, tokenMismatch } = await acceptInvites(db, user, saved.invite);
    let orgs = await membershipsFor(db, user.id);
    if (!orgs.length) {
      await createOrg(db, `${(user.name || user.email).split(/[\s@]/)[0]}'s workspace`, user.id);
      orgs = await membershipsFor(db, user.id);
    }
    const token = await createSession(db, user.id, preferred ?? orgs[0]?.id ?? null);
    const dest = new URL(saved.return_to || "/", base);
    // First sign-in from this browser: the client uploads the local workspace into the account.
    dest.searchParams.set("signedIn", "1");
    if (tokenMismatch) dest.searchParams.set("inviteError", "That invite was sent to a different email address.");
    return sessionCookie(NextResponse.redirect(dest.toString()), req, token);
  } catch (e) {
    console.error(e);
    return fail(e instanceof AuthError ? e.message : "Sign-in failed. Try again.");
  }
}
