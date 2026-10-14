"use client";

// The signed-in account, if any. Signing in is optional: every tool works
// anonymously; an account saves the workspace and shares it with a team.

import { useEffect, useState } from "react";

export type Role = "owner" | "admin" | "member";
export interface OrgSummary {
  id: string;
  name: string;
  role: Role;
}
export interface Account {
  authenticated: boolean;
  providers: string[];
  user?: { id: string; email: string; name: string | null; picture: string | null };
  org?: OrgSummary | null;
  orgs?: OrgSummary[];
}

const EVENT = "metainfo:account";
let current: Account | null = null;
let loading: Promise<Account> | null = null;

export function loadAccount(force = false): Promise<Account> {
  if (force) loading = null;
  loading ??= fetch("/api/session", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Account>) : { authenticated: false, providers: [] }))
    .catch(() => ({ authenticated: false, providers: [] }) as Account)
    .then((a) => {
      current = a;
      window.dispatchEvent(new Event(EVENT));
      return a;
    });
  return loading;
}

export function useAccount(): Account | null {
  const [a, setA] = useState<Account | null>(current);
  useEffect(() => {
    const on = () => setA(current);
    window.addEventListener(EVENT, on);
    void loadAccount().then(setA);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return a;
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
  return body;
}

export function signInUrl(provider: string, opts: { invite?: string; returnTo?: string } = {}) {
  const q = new URLSearchParams();
  if (opts.invite) q.set("invite", opts.invite);
  q.set("returnTo", opts.returnTo ?? (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/"));
  return `/auth/${provider}?${q}`;
}

export const PROVIDER_LABEL: Record<string, string> = { google: "Google", github: "GitHub", dev: "Test account (dev only)" };
