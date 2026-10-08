"use client";

import type { ResearchStatus } from "@/lib/research-types";

let statusPromise: Promise<ResearchStatus> | null = null;
const TOKEN_KEY = "metainfo:research-token";
const KEYS_KEY = "metainfo:dataforseo-keys";

export interface ProviderKeys {
  login: string;
  password: string;
}

/** DataForSEO keys entered in this browser. Sent only with research requests to this app's server. */
export function getProviderKeys(): ProviderKeys | null {
  try {
    const k = JSON.parse(localStorage.getItem(KEYS_KEY) ?? "null");
    return k?.login && k?.password ? k : null;
  } catch {
    return null;
  }
}

export function setProviderKeys(keys: ProviderKeys | null) {
  try {
    if (keys) localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
    else localStorage.removeItem(KEYS_KEY);
  } catch {
    /* storage blocked */
  }
  statusPromise = null;
  window.dispatchEvent(new Event("metainfo:keys"));
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "x-research-token": getToken() };
  const k = getProviderKeys();
  if (k) {
    h["x-dataforseo-login"] = k.login;
    h["x-dataforseo-password"] = k.password;
  }
  return h;
}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(t: string) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* storage blocked */
  }
}

export class ResearchError extends Error {
  constructor(message: string, public code?: string | number) {
    super(message);
  }
}

export async function research<T>(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`/api/research/${path}?${qs}`, { headers: authHeaders(), signal });
  const body = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status})` }));
  if (!res.ok || body.error) throw new ResearchError(body.error ?? `HTTP ${res.status}`, body.code);
  return body as T;
}

export function researchStatus(): Promise<ResearchStatus> {
  statusPromise ??= fetch("/api/research/status")
    .then((r) => r.json() as Promise<ResearchStatus>)
    .catch(() => ({ dataforseo: false, tokenRequired: false }))
    .then((s) => {
      const own = getProviderKeys() !== null;
      return { ...s, dataforseo: s.dataforseo || own, ownKeys: own };
    });
  return statusPromise;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v == null ? "" : Array.isArray(v) ? v.join(" ") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
