// Provider credentials for the current request.
//
// Anyone can bring their own DataForSEO keys: the browser (or an API/MCP
// client) sends them per request in headers, and they take precedence over
// the server's environment keys. They're held only for the duration of the
// request (AsyncLocalStorage), never stored or logged.

import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";

export interface ProviderCredentials {
  login: string;
  password: string;
  /** "request" = supplied by the caller; "server" = from the environment. */
  source: "request" | "server";
}

export const HEADER_LOGIN = "x-dataforseo-login";
export const HEADER_PASSWORD = "x-dataforseo-password";

const store = new AsyncLocalStorage<ProviderCredentials | null>();

/** Credentials from the request headers, if the caller supplied a complete pair. */
export function credentialsFromHeaders(headers: Headers): ProviderCredentials | null {
  const login = headers.get(HEADER_LOGIN)?.trim();
  const password = headers.get(HEADER_PASSWORD)?.trim();
  if (!login || !password || login.length > 200 || password.length > 200) return null;
  return { login, password, source: "request" };
}

function serverCredentials(): ProviderCredentials | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  return login && password ? { login, password, source: "server" } : null;
}

/** Run `fn` with the request's own credentials (if any) taking precedence over the server's. */
export function withCredentials<T>(headers: Headers, fn: () => Promise<T>): Promise<T> {
  return store.run(credentialsFromHeaders(headers), fn);
}

export function currentCredentials(): ProviderCredentials | null {
  return store.getStore() ?? serverCredentials();
}

export function serverHasCredentials(): boolean {
  return serverCredentials() !== null;
}

/**
 * RESEARCH_TOKEN protects the server owner's DataForSEO balance. Callers who
 * bring their own keys don't touch that balance, so they don't need it.
 */
export function tokenSatisfied(headers: Headers, given: string | null): boolean {
  const required = process.env.RESEARCH_TOKEN;
  if (!required || credentialsFromHeaders(headers)) return true;
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(required);
  return a.length === b.length && timingSafeEqual(a, b);
}
