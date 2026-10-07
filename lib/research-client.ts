"use client";

import type { ResearchStatus } from "@/lib/research-types";

const TOKEN_KEY = "metainfo:research-token";

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
  const res = await fetch(`/api/research/${path}?${qs}`, { headers: { "x-research-token": getToken() }, signal });
  const body = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status})` }));
  if (!res.ok || body.error) throw new ResearchError(body.error ?? `HTTP ${res.status}`, body.code);
  return body as T;
}

let statusPromise: Promise<ResearchStatus> | null = null;
export function researchStatus(): Promise<ResearchStatus> {
  statusPromise ??= fetch("/api/research/status")
    .then((r) => r.json())
    .catch(() => ({ dataforseo: false, tokenRequired: false }));
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
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
