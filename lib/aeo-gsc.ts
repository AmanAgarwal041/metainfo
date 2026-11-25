"use client";

// Search Console opportunities for the AI visibility Recommendations tab: one cheap call to the workspace's
// connection. Not connected (or not signed in) is a normal state, not an error.

import { useEffect, useState } from "react";
import { getToken } from "@clerk/nextjs";
import { useAccount } from "@/lib/account";
import type { GscOpportunity } from "@/lib/aeo-signals";

export type GscState = { connected: false; reason?: string } | { connected: true; site: string; days: number; opportunities: GscOpportunity[] };

const DAYS = 28;

export function useGscOpportunities(projectId: string): GscState | null {
  const account = useAccount();
  const key = account.loaded && projectId ? `${account.workspace?.id ?? "anon"}|${projectId}` : null;
  const [result, setResult] = useState<{ key: string; state: GscState } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    (async () => {
      const token = await getToken().catch(() => null);
      const res = await fetch(`/api/gsc/opportunities?projectId=${encodeURIComponent(projectId)}&days=${DAYS}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as Partial<{ connected: boolean; site: string; opportunities: GscOpportunity[]; error: string; reason: string }>;
      if (!res.ok || !json.connected || !json.site) return { connected: false as const, reason: json.error ?? json.reason };
      return { connected: true as const, site: json.site, days: DAYS, opportunities: json.opportunities ?? [] };
    })().then(
      (state) => live && setResult({ key, state }),
      () => live && setResult({ key, state: { connected: false } }),
    );
    return () => {
      live = false;
    };
  }, [key, projectId]);
  return result?.key === key ? result.state : null;
}

/** One line for the Recommendations tab about where Search Console suggestions come from. */
export function gscNote(s: GscState | null): string | undefined {
  if (!s) return undefined;
  return s.connected ? `Search Console: ${s.opportunities.length} opportunities on ${s.site.replace(/^sc-domain:/, "")}` : "Search Console not connected";
}
