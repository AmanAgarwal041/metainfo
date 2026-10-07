// Browser-side engine: loads the WASM module once and runs scans locally.

import type { Report, ScanInput } from "@/lib/types";

type Engine = typeof import("@/wasm/pkg/metainfo.js");
let loading: Promise<Engine> | null = null;

export function loadEngine(): Promise<Engine> {
  loading ??= import("@/wasm/pkg/metainfo.js").then(async (m) => {
    await m.default({ module_or_path: "/engine/metainfo_bg.wasm" });
    return m;
  });
  return loading;
}

export async function runEngine(input: ScanInput): Promise<{ report: Report; analyzeMs: number }> {
  const engine = await loadEngine();
  const t0 = performance.now();
  const out = JSON.parse(engine.analyze(JSON.stringify(input)));
  const analyzeMs = performance.now() - t0;
  if (out.error) throw new Error(out.error);
  return { report: out as Report, analyzeMs };
}

export async function fetchBundle(url: string, signal?: AbortSignal): Promise<ScanInput> {
  const res = await fetch(`/api/scan?url=${encodeURIComponent(url)}`, { signal });
  const body = await res.json().catch(() => ({ error: `Scan failed (HTTP ${res.status})` }));
  if (!res.ok || body.error) throw new Error(body.error ?? `Scan failed (HTTP ${res.status})`);
  return body as ScanInput;
}

export function htmlBundle(html: string, baseUrl: string): ScanInput {
  return { url: baseUrl, headers: {}, html, redirects: [], sitemaps: [], botProbes: [] };
}
