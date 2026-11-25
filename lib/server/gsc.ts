// Google Search Console: real Google clicks, impressions, CTR and positions for
// a site you own, plus URL inspection and sitemaps.
//
// Authentication (resolved in gsc-auth.ts), all on fetch and Web Crypto (Workers runtime):
//  1. A workspace connection: an admin connects Google once for the whole
//     organisation; the refresh token is stored in D1, AES-GCM sealed with a
//     key derived from GSC_COOKIE_SECRET (or the OAuth client secret). It never
//     leaves the server.
//  2. A service account (GSC_SERVICE_ACCOUNT_JSON) for self-hosting and MCP:
//     add its client_email as a user on the Search Console property. Because it
//     exposes the server owner's data, it's only used for callers that present
//     RESEARCH_TOKEN when one is set.
//  3. Servers without accounts (no D1 or no Clerk): the sealed refresh token
//     lives in an HttpOnly cookie in the browser instead.
// Access tokens are cached in memory per connection until shortly before
// they expire.

import { AsyncLocalStorage } from "node:async_hooks";
import type { GscSite, Row } from "../gsc-analysis";

// Pure helpers (property matching, period comparison, opportunities) live in a client-safe module.
export * from "../gsc-analysis";

export const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** OAuth asks for these too, so the id_token names the Google account that was connected. */
const OAUTH_SCOPES = `openid email ${SCOPE}`;
export const SESSION_COOKIE = "gsc_session";
export const STATE_COOKIE = "gsc_state";
/** The session cookie is only sent to these routes. */
export const COOKIE_PATH = "/api/gsc";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/webmasters/v3";
const INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

export class GscError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- encoding

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Constant-time string comparison (Web Crypto has none; this avoids early exit). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function sha256Hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- cookie encryption

const keyCache = new Map<string, Promise<CryptoKey>>();

function cookieSecret(): string | null {
  return process.env.GSC_COOKIE_SECRET || process.env.GOOGLE_CLIENT_SECRET || null;
}

function cookieKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle
      .importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"])
      .then((base) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: enc.encode("metainfo:gsc:v1"), info: enc.encode("refresh-token-cookie") },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    keyCache.set(secret, k);
  }
  return k;
}

/** "v1.<iv>.<ciphertext>", base64url. */
export async function sealToken(plain: string, secret = cookieSecret()): Promise<string> {
  if (!secret) throw new GscError("Set GSC_COOKIE_SECRET or GOOGLE_CLIENT_SECRET.", 501, "not-configured");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cookieKey(secret), enc.encode(plain));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

/** The plaintext, or null if the value is missing, tampered with or sealed with another key. */
export async function openToken(sealed: string | undefined | null, secret = cookieSecret()): Promise<string | null> {
  if (!sealed || !secret || sealed.length > 4096) return null;
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await cookieKey(secret), fromB64url(ct));
    return dec.decode(pt);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- access-token cache

const tokenCache = new Map<string, { token: string; exp: number }>();
const EARLY = 120_000; // refresh two minutes before Google's expiry

function cached(key: string): string | null {
  const hit = tokenCache.get(key);
  if (hit && hit.exp - EARLY > Date.now()) return hit.token;
  if (hit) tokenCache.delete(key);
  return null;
}

function remember(key: string, token: string, expiresIn: number) {
  if (tokenCache.size > 500) tokenCache.clear();
  tokenCache.set(key, { token, exp: Date.now() + Math.max(60, expiresIn) * 1000 });
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string; id_token?: string }> {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    if (data.error === "invalid_grant") throw new GscError("Your Google connection expired or was revoked. Connect Search Console again.", 401, "not-connected");
    if (data.error === "invalid_client" || data.error === "unauthorized_client") throw new GscError("Google rejected this server's OAuth client or service account. Check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET or GSC_SERVICE_ACCOUNT_JSON.", 502, "config");
    throw new GscError(`Google token request failed (${data.error ?? `HTTP ${res.status}`}).`, 502, "google");
  }
  return { access_token: data.access_token, expires_in: data.expires_in ?? 3600, refresh_token: data.refresh_token, id_token: data.id_token };
}

// ---------------------------------------------------------------- OAuth

export function oauthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Must be registered as an authorised redirect URI on the OAuth client in Google Cloud. */
export function redirectUri(origin: string): string {
  return process.env.GSC_REDIRECT_URI || `${origin.replace(/\/+$/, "")}/api/gsc/callback`;
}

export function authUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${q}`;
}

/**
 * The email claim of an id_token received directly from Google's token
 * endpoint over TLS (OpenID Connect allows skipping signature checks then).
 */
export function idTokenEmail(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(dec.decode(fromB64url(payload))) as { email?: unknown; email_verified?: unknown };
    return typeof claims.email === "string" && claims.email_verified !== false ? claims.email.slice(0, 320) : null;
  } catch {
    return null;
  }
}

/** Cache key for one OAuth connection: a hash, so the refresh token itself isn't kept as a key. */
export const connectionKey = async (refreshToken: string) => `rt:${await sha256Hex(refreshToken)}`;

/** Exchange the authorization code; returns the refresh token and the Google account (and primes the access-token cache). */
export async function exchangeCode(code: string, origin: string): Promise<{ refreshToken: string; email: string | null }> {
  const t = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri(origin),
    grant_type: "authorization_code",
  });
  if (!t.refresh_token) throw new GscError("Google didn't return a refresh token. Remove MetaInfo from your Google account's third-party access and connect again.", 502, "google");
  remember(await connectionKey(t.refresh_token), t.access_token, t.expires_in);
  return { refreshToken: t.refresh_token, email: idTokenEmail(t.id_token) };
}

/** An access token for a stored refresh token, cached per connection. Throws GscError "not-connected" on a revoked/expired grant. */
export async function oauthAccessToken(refreshToken: string): Promise<string> {
  const key = await connectionKey(refreshToken);
  const hit = cached(key);
  if (hit) return hit;
  try {
    const t = await tokenRequest({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    remember(key, t.access_token, t.expires_in);
    return t.access_token;
  } catch (e) {
    tokenCache.delete(key);
    throw e;
  }
}

/** Forget a connection's cached access token (disconnect, invalid grant). */
export async function forgetConnection(refreshToken: string): Promise<void> {
  tokenCache.delete(await connectionKey(refreshToken));
}

/** Best effort: revoke at Google and forget the cached access token. */
export async function revoke(refreshToken: string): Promise<void> {
  await forgetConnection(refreshToken);
  try {
    await fetch(REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshToken }), signal: AbortSignal.timeout(5000) });
  } catch {
    /* the stored token is deleted either way */
  }
}

// ---------------------------------------------------------------- service account

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let saParsed: { raw: string; sa: ServiceAccount | null } | null = null;

/** GSC_SERVICE_ACCOUNT_JSON: the key file's JSON, or the same base64-encoded. */
export function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  if (saParsed?.raw === raw) return saParsed.sa;
  let sa: ServiceAccount | null = null;
  try {
    const json = raw.startsWith("{") ? raw : new TextDecoder().decode(fromB64url(raw.replace(/=+$/, "")));
    const o = JSON.parse(json) as Partial<ServiceAccount>;
    if (typeof o.client_email === "string" && typeof o.private_key === "string") sa = { client_email: o.client_email, private_key: o.private_key, token_uri: o.token_uri };
  } catch {
    sa = null;
  }
  saParsed = { raw, sa };
  return sa;
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/\\n/g, "\n").replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** RS256 JWT signed with a PKCS#8 PEM private key (RSASSA-PKCS1-v1_5, SHA-256). */
export async function signJwt(payload: Record<string, unknown>, privateKeyPem: string): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

export async function serviceAccountToken(sa: ServiceAccount): Promise<string> {
  const key = `sa:${sa.client_email}`;
  const hit = cached(key);
  if (hit) return hit;
  const aud = sa.token_uri || TOKEN_URL;
  const iat = Math.floor(Date.now() / 1000);
  let assertion: string;
  try {
    assertion = await signJwt({ iss: sa.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 }, sa.private_key);
  } catch {
    throw new GscError("GSC_SERVICE_ACCOUNT_JSON has a private key this server can't read (expected the PKCS#8 PEM from Google's JSON key file).", 500, "config");
  }
  const t = await tokenRequest({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
  remember(key, t.access_token, t.expires_in);
  return t.access_token;
}

// ---------------------------------------------------------------- who may use the service account

const ownerStore = new AsyncLocalStorage<boolean>();

/**
 * The service account reads the server owner's properties, so when RESEARCH_TOKEN
 * is set only callers presenting it may use it (own DataForSEO keys don't count).
 */
export function isOwnerRequest(headers: Headers): boolean {
  const required = process.env.RESEARCH_TOKEN;
  if (!required) return true;
  const given = headers.get("x-research-token") || (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return Boolean(given) && safeEqual(given, required);
}

/** Run `fn` (e.g. an MCP call) with the caller's service-account permission. */
export function withGscOwner<T>(headers: Headers, fn: () => Promise<T>): Promise<T> {
  return ownerStore.run(isOwnerRequest(headers), fn);
}

// ---------------------------------------------------------------- auth handle

export interface GscAuth {
  token: string;
  /** org: the workspace's connection; browser: the cookie (servers without accounts); service-account. */
  via: "org" | "browser" | "service-account";
  /** Service-account or connected Google account email, for access errors. */
  email?: string;
}

/** For MCP: the service account only, for callers allowed to use it (see withGscOwner). */
export async function serviceAccountAuth(): Promise<GscAuth> {
  const sa = serviceAccount();
  if (!sa) throw new GscError("Search Console for agents needs GSC_SERVICE_ACCOUNT_JSON on the server, with the service account added as a user on the property.", 501, "not-configured");
  if (!(ownerStore.getStore() ?? false)) throw new GscError("Search Console tools need this server's RESEARCH_TOKEN (Authorization: Bearer ...).", 401, "token");
  return { token: await serviceAccountToken(sa), via: "service-account", email: sa.client_email };
}

export const serviceAccountConfigured = () => serviceAccount() !== null;

// ---------------------------------------------------------------- API calls

async function gapi<T>(auth: GscAuth, url: string, init: RequestInit = {}, property?: string): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${auth.token}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null;
  const detail = String(body?.error?.message ?? "").slice(0, 300);
  if (res.status === 401) {
    throw new GscError(auth.via === "service-account" ? "Google rejected the service account's token." : "Google rejected the Search Console connection. Connect Search Console again.", 401, "not-connected");
  }
  if (res.status === 403) {
    const what = property ? `"${property}"` : "this property";
    if (/has not been used|is disabled|accessNotConfigured/i.test(detail)) {
      throw new GscError("The Search Console API isn't enabled for this Google Cloud project. Enable it in the Google Cloud console and retry.", 403, "api-disabled");
    }
    throw new GscError(
      auth.via === "service-account"
        ? `The service account ${auth.email} has no access to ${what}. Add it as a user on the property in Search Console (Settings > Users and permissions).`
        : `The connected Google account${auth.email ? ` (${auth.email})` : ""} has no access to ${what}. Pick a property it can read, or connect a Google account that has access.`,
      403,
      "forbidden",
    );
  }
  if (res.status === 429) throw new GscError("Search Console's rate limit was hit. Wait a minute and retry.", 429, "rate-limit");
  if (res.status === 400) throw new GscError(`Search Console rejected the request: ${detail || "bad request"}`, 400, "bad-request");
  if (res.status === 404) throw new GscError(`Not found in Search Console${property ? `: ${property}` : ""}.`, 404, "not-found");
  throw new GscError(`Search Console error (HTTP ${res.status})${detail ? `: ${detail}` : ""}`, 502, "google");
}

export async function listSites(auth: GscAuth): Promise<GscSite[]> {
  const r = await gapi<{ siteEntry?: GscSite[] }>(auth, `${API}/sites`);
  return (r.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export type SearchType = "web" | "image" | "video" | "news" | "discover" | "googleNews";
export type Dimension = "date" | "query" | "page" | "country" | "device" | "searchAppearance";

export interface QueryOptions {
  startDate: string;
  endDate: string;
  dimensions?: Dimension[];
  rowLimit?: number;
  startRow?: number;
  type?: SearchType;
  dimensionFilterGroups?: { groupType?: "and"; filters: { dimension: Dimension; operator: "equals" | "contains" | "notEquals" | "notContains" | "includingRegex" | "excludingRegex"; expression: string }[] }[];
  aggregationType?: "auto" | "byPage" | "byProperty";
  dataState?: "final" | "all";
}

export async function query(auth: GscAuth, site: string, opts: QueryOptions): Promise<Row[]> {
  const r = await gapi<{ rows?: Row[] }>(auth, `${API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { method: "POST", body: JSON.stringify({ rowLimit: 1000, ...opts }) }, site);
  return r.rows ?? [];
}

export async function sitemaps(auth: GscAuth, site: string) {
  const r = await gapi<{ sitemap?: { path: string; lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean; errors?: string; warnings?: string; contents?: { type: string; submitted?: string; indexed?: string }[] }[] }>(
    auth,
    `${API}/sites/${encodeURIComponent(site)}/sitemaps`,
    {},
    site,
  );
  return (r.sitemap ?? []).map((s) => ({
    path: s.path,
    lastSubmitted: s.lastSubmitted ?? null,
    lastDownloaded: s.lastDownloaded ?? null,
    pending: Boolean(s.isPending),
    errors: Number(s.errors ?? 0),
    warnings: Number(s.warnings ?? 0),
    submitted: (s.contents ?? []).reduce((n, c) => n + Number(c.submitted ?? 0), 0),
  }));
}

interface RawInspection {
  inspectionResult?: {
    inspectionResultLink?: string;
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
      googleCanonical?: string;
      userCanonical?: string;
      crawledAs?: string;
      sitemap?: string[];
      referringUrls?: string[];
    };
    mobileUsabilityResult?: { verdict?: string; issues?: { issueType?: string; message?: string }[] };
    richResultsResult?: { verdict?: string; detectedItems?: { richResultType?: string; items?: { name?: string; issues?: { issueMessage?: string; severity?: string }[] }[] }[] };
  };
}

export interface Inspection {
  url: string;
  verdict: string | null;
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  crawledAs: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  canonicalMismatch: boolean;
  sitemaps: string[];
  referringUrls: string[];
  mobile: { verdict: string; issues: string[] } | null;
  richResults: { verdict: string; items: { type: string; issues: { severity: string; message: string }[] }[] } | null;
  link: string | null;
}

export async function inspectUrl(auth: GscAuth, site: string, url: string): Promise<Inspection> {
  const r = await gapi<RawInspection>(auth, INSPECT_URL, { method: "POST", body: JSON.stringify({ inspectionUrl: url, siteUrl: site, languageCode: "en-US" }) }, site);
  const i = r.inspectionResult ?? {};
  const x = i.indexStatusResult ?? {};
  const g = x.googleCanonical ?? null;
  const u = x.userCanonical ?? null;
  return {
    url,
    verdict: x.verdict ?? null,
    coverageState: x.coverageState ?? null,
    indexingState: x.indexingState ?? null,
    robotsTxtState: x.robotsTxtState ?? null,
    pageFetchState: x.pageFetchState ?? null,
    lastCrawlTime: x.lastCrawlTime ?? null,
    crawledAs: x.crawledAs ?? null,
    googleCanonical: g,
    userCanonical: u,
    canonicalMismatch: Boolean(g && u && g !== u),
    sitemaps: (x.sitemap ?? []).slice(0, 5),
    referringUrls: (x.referringUrls ?? []).slice(0, 5),
    mobile: i.mobileUsabilityResult?.verdict
      ? { verdict: i.mobileUsabilityResult.verdict, issues: (i.mobileUsabilityResult.issues ?? []).map((m) => m.message || m.issueType || "").filter(Boolean).slice(0, 10) }
      : null,
    richResults: i.richResultsResult?.verdict
      ? {
          verdict: i.richResultsResult.verdict,
          items: (i.richResultsResult.detectedItems ?? []).slice(0, 10).map((d) => ({
            type: d.richResultType ?? "Unknown",
            issues: (d.items ?? []).flatMap((it) => it.issues ?? []).slice(0, 10).map((s) => ({ severity: s.severity ?? "", message: s.issueMessage ?? "" })),
          })),
        }
      : null,
    link: i.inspectionResultLink ?? null,
  };
}

