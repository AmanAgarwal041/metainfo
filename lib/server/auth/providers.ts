// Google (OIDC, PKCE) and GitHub OAuth, as in socialbrewery. A provider is
// offered only when its client id and secret are configured. The "dev"
// provider signs in as a test user and exists only outside production with
// AUTH_DEV_LOGIN=1, for local testing without OAuth apps.

import { base64url, randomToken } from "./crypto";
import { AuthError, type Identity } from "./accounts";

export type ProviderId = "google" | "github" | "dev";

const env = (k: string) => process.env[k]?.trim() || "";

export function appUrl(req: Request): string {
  return (env("APP_URL") || new URL(req.url).origin).replace(/\/+$/, "");
}

export function providers(): ProviderId[] {
  const out: ProviderId[] = [];
  if (env("GOOGLE_AUTH_CLIENT_ID") && env("GOOGLE_AUTH_CLIENT_SECRET")) out.push("google");
  if (env("GITHUB_AUTH_CLIENT_ID") && env("GITHUB_AUTH_CLIENT_SECRET")) out.push("github");
  if (env("AUTH_DEV_LOGIN") === "1" && process.env.NODE_ENV !== "production") out.push("dev");
  return out;
}

/** Only same-site paths, so a crafted link can't bounce users to another site after sign-in. */
export function safeReturn(v: string | null): string | null {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v.slice(0, 500) : null;
}

export const isProvider = (p: string): p is ProviderId => (providers() as string[]).includes(p);

async function pkce() {
  const verifier = randomToken(48);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

/** Where to send the browser, and the PKCE verifier to keep with the state. */
export async function authorizeUrl(p: ProviderId, base: string, state: string): Promise<{ url: string; verifier: string | null }> {
  const redirect = `${base}/auth/${p}/callback`;
  if (p === "google") {
    const { verifier, challenge } = await pkce();
    const q = new URLSearchParams({
      client_id: env("GOOGLE_AUTH_CLIENT_ID"),
      redirect_uri: redirect,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, verifier };
  }
  if (p === "github") {
    const q = new URLSearchParams({ client_id: env("GITHUB_AUTH_CLIENT_ID"), redirect_uri: redirect, scope: "read:user user:email", state, allow_signup: "true" });
    return { url: `https://github.com/login/oauth/authorize?${q}`, verifier: null };
  }
  return { url: `${redirect}?${new URLSearchParams({ code: "dev", state })}`, verifier: null };
}

async function json<T>(res: Response, what: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new AuthError(`${what} failed (HTTP ${res.status}).`, 502);
  return body as T;
}

export async function identityFor(p: ProviderId, base: string, code: string, verifier: string | null, devEmail?: string): Promise<Identity> {
  const redirect = `${base}/auth/${p}/callback`;
  if (p === "google") {
    const tok = await json<{ access_token?: string }>(
      await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env("GOOGLE_AUTH_CLIENT_ID"),
          client_secret: env("GOOGLE_AUTH_CLIENT_SECRET"),
          redirect_uri: redirect,
          grant_type: "authorization_code",
          code_verifier: verifier ?? "",
        }),
      }),
      "Google sign-in",
    );
    if (!tok.access_token) throw new AuthError("Google didn't return an access token.", 502);
    const u = await json<{ sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }>(
      await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tok.access_token}` } }),
      "Google profile",
    );
    return { provider: "google", subject: u.sub, emails: u.email && u.email_verified ? [u.email] : [], name: u.name ?? null, picture: u.picture ?? null };
  }
  if (p === "github") {
    const tok = await json<{ access_token?: string; error_description?: string }>(
      await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ client_id: env("GITHUB_AUTH_CLIENT_ID"), client_secret: env("GITHUB_AUTH_CLIENT_SECRET"), code, redirect_uri: redirect }),
      }),
      "GitHub sign-in",
    );
    if (!tok.access_token) throw new AuthError(tok.error_description || "GitHub didn't return an access token.", 502);
    const headers = { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json", "user-agent": "MetaInfo" };
    const [u, emails] = await Promise.all([
      json<{ id: number; name?: string; login: string; avatar_url?: string }>(await fetch("https://api.github.com/user", { headers }), "GitHub profile"),
      json<{ email: string; verified: boolean; primary: boolean }[]>(await fetch("https://api.github.com/user/emails", { headers }), "GitHub emails"),
    ]);
    const verified = emails.filter((e) => e.verified).sort((a, b) => Number(b.primary) - Number(a.primary)).map((e) => e.email);
    return { provider: "github", subject: String(u.id), emails: verified, name: u.name || u.login, picture: u.avatar_url ?? null };
  }
  const email = (devEmail || "dev@metainfo.test").toLowerCase();
  return { provider: "dev", subject: email, emails: [email], name: email.split("@")[0], picture: null };
}
