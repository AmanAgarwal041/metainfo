"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBundle, htmlBundle, loadEngine, runEngine } from "@/lib/engine";
import { loadSites, recordScan, type TrackedSite } from "@/lib/history";
import { activeProject, saveProject } from "@/lib/project";
import type { Report as ReportT } from "@/lib/types";
import Home from "./Home";
import Report from "./Report";

type Phase = "idle" | "fetching" | "analyzing" | "done";

export interface ScanMeta {
  fetchMs?: number;
  analyzeMs: number;
  scannedAt: string;
  source: "url" | "html";
}

const STEPS = [
  { id: "fetching", label: "Fetching the page, robots.txt, sitemaps & llms.txt; probing 10 crawler user agents" },
  { id: "analyzing", label: "Running the Rust/WASM engine: parsing, 55+ checks, scoring, fix plan" },
];

export default function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportT | null>(null);
  const [meta, setMeta] = useState<ScanMeta | null>(null);
  const [site, setSite] = useState<TrackedSite | null>(null);
  const [sites, setSites] = useState<Record<string, TrackedSite>>({});
  const [lastInput, setLastInput] = useState<{ kind: "url" | "html"; value: string; base?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scanUrl = useCallback(async (url: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setLastInput({ kind: "url", value: url });
    setPhase("fetching");
    try {
      const [bundle] = await Promise.all([fetchBundle(url, ctrl.signal), loadEngine()]);
      if (ctrl.signal.aborted) return;
      setPhase("analyzing");
      const { report, analyzeMs } = await runEngine(bundle);
      setReport(report);
      setMeta({ fetchMs: bundle.fetchMs, analyzeMs, scannedAt: new Date().toISOString(), source: "url" });
      setSite(recordScan(report));
      setSites(loadSites());
      setPhase("done");
      // First scan with no project yet: make this site the project.
      if (!activeProject()?.domain) saveProject({ domain: report.finalUrl || url });
      const q = new URL(window.location.href);
      q.searchParams.set("url", report.finalUrl || url);
      window.history.replaceState(null, "", q);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }, []);

  const scanHtml = useCallback(async (html: string, base: string) => {
    setError(null);
    setLastInput({ kind: "html", value: html, base });
    setPhase("analyzing");
    try {
      const { report, analyzeMs } = await runEngine(htmlBundle(html, base));
      setReport(report);
      setMeta({ analyzeMs, scannedAt: new Date().toISOString(), source: "html" });
      // Pasted HTML is tracked only when it resolves to a real URL.
      if (report.finalUrl) {
        setSite(recordScan(report));
        setSites(loadSites());
      } else {
        setSite(null);
      }
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }, []);

  useEffect(() => {
    // Warm up the engine while the user types, and pick up ?url= deep links.
    loadEngine().catch(() => {});
    const sitesNow = loadSites();
    const url = new URL(window.location.href).searchParams.get("url");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage after mount
    setSites(sitesNow);
    if (url) scanUrl(url);
  }, [scanUrl]);

  const goHome = () => {
    abortRef.current?.abort();
    setReport(null);
    setPhase("idle");
    setSites(loadSites());
    const q = new URL(window.location.href);
    q.searchParams.delete("url");
    window.history.replaceState(null, "", q);
  };

  const rescan = () => {
    if (!lastInput) return;
    if (lastInput.kind === "url") scanUrl(lastInput.value);
    else scanHtml(lastInput.value, lastInput.base ?? "");
  };

  const busy = phase === "fetching" || phase === "analyzing";

  return (
    <>
      <main className="shell">
        {busy && (
          <div className="card progress-steps" aria-live="polite">
            {lastInput?.kind === "url" && <div className="muted small" style={{ marginBottom: 10 }}>Scanning {lastInput.value}</div>}
            {STEPS.filter((s) => lastInput?.kind === "url" || s.id === "analyzing").map((s) => {
              const idx = STEPS.findIndex((x) => x.id === phase);
              const mine = STEPS.findIndex((x) => x.id === s.id);
              const cls = mine < idx ? "done" : mine === idx ? "active" : "";
              return (
                <div key={s.id} className={`step ${cls}`}>
                  <span className="step-dot">{cls === "done" ? "✓" : ""}</span>
                  {s.label}
                </div>
              );
            })}
          </div>
        )}
        {!busy && report && meta && phase === "done" && (
          <Report
            report={report}
            meta={meta}
            site={site}
            onRescan={rescan}
            onNewScan={goHome}
            onSiteChange={(s) => {
              setSite(s);
              setSites(loadSites());
            }}
          />
        )}
        {!busy && phase !== "done" && (
          <Home
            error={error}
            sites={sites}
            onScanUrl={scanUrl}
            onScanHtml={scanHtml}
            onSitesChange={() => setSites(loadSites())}
          />
        )}
      </main>
    </>
  );
}
