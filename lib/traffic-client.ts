"use client";

// The Traffic page's calls: the project's collector and what it has reported. Signed-in only (the data lives
// in the workspace's database), so every call carries Clerk's session token.

import { useEffect, useState } from "react";
import { getToken } from "@clerk/nextjs";
import { useAccount } from "@/lib/account";
import type { CollectorSite, TrafficStats } from "@/lib/traffic";

/** Where collectors send events. Kept here and in collector/src/core.ts (DEFAULT_ENDPOINT). */
export const HOSTED_ENDPOINT = "https://metainfo.agarwal-aman041.workers.dev/api/traffic/events";
/** Where the collector's source lives (links and curl commands in the setup steps). */
export const COLLECTOR_REPO = "https://github.com/AmanAgarwal041/metainfo";
export const COLLECTOR_RAW = "https://raw.githubusercontent.com/AmanAgarwal041/metainfo/main/collector/src";

export class TrafficError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken().catch(() => null);
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new TrafficError(json.error ?? `Request failed (HTTP ${res.status})`, res.status);
  return json;
}

export const loadTraffic = (projectId: string, days: number) =>
  call<{ site: CollectorSite | null; stats?: TrafficStats }>("GET", `/api/traffic/stats?projectId=${encodeURIComponent(projectId)}&days=${days}`);

export const issueCollectorToken = (projectId: string) => call<{ site: CollectorSite; token: string }>("POST", "/api/traffic/sites", { projectId });

export const disconnectCollector = (projectId: string) => call<{ ok: true }>("DELETE", `/api/traffic/sites?projectId=${encodeURIComponent(projectId)}`);

export type TrafficView =
  /** Sign-in isn't available here, or nobody is signed in: traffic lives in the workspace. */
  | { state: "unavailable"; canSignIn: boolean }
  | { state: "loading" }
  | { state: "error"; error: string }
  /** Signed in, but the project has no collector yet. */
  | { state: "none" }
  | { state: "ready"; site: CollectorSite; stats: TrafficStats };

/** A project's traffic for the dashboard and the audit's crawler matrix. `projectId` null: not wanted. */
export function useTraffic(projectId: string | null, days: number): TrafficView {
  const account = useAccount();
  const key = account.authenticated && projectId ? `${account.workspace?.id}|${projectId}|${days}` : null;
  const [result, setResult] = useState<{ key: string; view: TrafficView } | null>(null);
  useEffect(() => {
    if (!key || !projectId) return;
    let live = true;
    loadTraffic(projectId, days).then(
      (d) => live && setResult({ key, view: d.site && d.stats ? { state: "ready", site: d.site, stats: d.stats } : { state: "none" } }),
      (e: Error) => live && setResult({ key, view: { state: "error", error: e.message } }),
    );
    return () => {
      live = false;
    };
  }, [key, projectId, days]);
  if (!account.loaded) return { state: "loading" };
  if (!key) return { state: "unavailable", canSignIn: account.enabled && !account.authenticated };
  return result?.key === key ? result.view : { state: "loading" };
}
