"use client";

import { useState, type FormEvent } from "react";
import { removeSite, type TrackedSite } from "@/lib/history";
import { scoreColor, Sparkline } from "./ui";

const EXAMPLES = ["vercel.com", "stripe.com/pricing", "nextjs.org/docs", "anthropic.com"];

const FEATURES = [
  { t: "Search engines and AI engines", d: "Separate scores for Google, Bing, ChatGPT, Perplexity, Claude, Gemini and social sharing, each weighted by what that platform depends on." },
  { t: "Crawler access matrix", d: "Checks robots.txt rules and real HTTP responses for Googlebot, OAI-SearchBot, ClaudeBot, PerplexityBot and more, so CDN blocks surface too." },
  { t: "Missing tags, ready to paste", d: "Generates a complete <head>, JSON-LD, robots.txt and llms.txt from your page's own content." },
  { t: "Fix plan and tracking", d: "Prioritises fixes by score gain per unit of effort. Rescan to verify fixes and follow the trend." },
];

export default function Home({
  error,
  sites,
  onScanUrl,
  onScanHtml,
  onSitesChange,
}: {
  error: string | null;
  sites: Record<string, TrackedSite>;
  onScanUrl: (url: string) => void;
  onScanHtml: (html: string, base: string) => void;
  onSitesChange: () => void;
}) {
  const [mode, setMode] = useState<"url" | "html">("url");
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [base, setBase] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (mode === "url") {
      if (!/\w+\.\w{2,}/.test(url.trim())) return setLocalError("Enter a domain or full URL, e.g. example.com/pricing");
      onScanUrl(url.trim());
    } else {
      if (html.trim().length < 20) return setLocalError("Paste the page's HTML source (at least the <head>).");
      onScanHtml(html, base.trim());
    }
  };

  const tracked = Object.values(sites).sort((a, b) =>
    (b.snapshots.at(-1)?.scannedAt ?? "").localeCompare(a.snapshots.at(-1)?.scannedAt ?? ""),
  );

  return (
    <>
      <section className="hero">
        <h1>
          See your site the way <span>Google, ChatGPT, Perplexity &amp; Claude</span> see it
        </h1>
        <p>
          Scan for missing meta tags, crawler blocks, sitemap, robots.txt and llms.txt issues, check pages against Google&apos;s
          rules and AI-readiness guidelines, then work through a prioritised fix plan and track your scores.
        </p>
        <form className="card scan-box" onSubmit={submit}>
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="segmented" role="group" aria-label="Input type">
              <button type="button" aria-pressed={mode === "url"} onClick={() => setMode("url")}>
                Scan URL
              </button>
              <button type="button" aria-pressed={mode === "html"} onClick={() => setMode("html")}>
                Paste HTML
              </button>
            </div>
            <span className="muted small">
              {mode === "url" ? "Fetched server-side, analysed in your browser" : "Analysed locally; nothing leaves your browser"}
            </span>
          </div>
          {mode === "url" ? (
            <>
              <div className="scan-row">
                <input
                  className="input"
                  placeholder="https://example.com/page"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  autoFocus
                  inputMode="url"
                  aria-label="URL to scan"
                />
                <button className="btn btn-primary" type="submit">
                  Scan
                </button>
              </div>
              <div className="chips">
                <span className="muted small">Try:</span>
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="chip" onClick={() => onScanUrl(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="grid" style={{ gap: 8 }}>
              <textarea
                className="textarea"
                placeholder="<!doctype html><html>…"
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                aria-label="HTML source"
              />
              <div className="scan-row">
                <input
                  className="input"
                  placeholder="Page URL (optional, used to resolve links and canonicals)"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  aria-label="Base URL"
                />
                <button className="btn btn-primary" type="submit">
                  Analyse
                </button>
              </div>
            </div>
          )}
          {(localError || error) && <div className="error-box">{localError || error}</div>}
        </form>
      </section>

      {tracked.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <h2 className="section-title">Tracked pages</h2>
            <span className="muted small">Each scan is saved here so you can follow your progress</span>
          </div>
          <div className="card">
            {tracked.map((s) => {
              const last = s.snapshots.at(-1);
              const prev = s.snapshots.at(-2);
              const delta = last && prev ? last.overall - prev.overall : 0;
              return (
                <div className="site-row" key={s.key}>
                  <div style={{ minWidth: 0 }}>
                    <a href={`?url=${encodeURIComponent(s.url)}`} onClick={(e) => { e.preventDefault(); onScanUrl(s.url); }} className="break" style={{ fontWeight: 600 }}>
                      {s.key}
                    </a>
                    <div className="muted small">
                      {s.snapshots.length} scan{s.snapshots.length === 1 ? "" : "s"} · last {last ? new Date(last.scannedAt).toLocaleString() : "-"}
                    </div>
                  </div>
                  <Sparkline values={s.snapshots.map((x) => x.overall)} />
                  <div style={{ fontWeight: 700, fontSize: 18, color: scoreColor(last?.overall ?? 0) }}>
                    {last?.overall ?? "-"}
                    {delta !== 0 && (
                      <span className="small" style={{ marginLeft: 4, color: delta > 0 ? "var(--pass)" : "var(--fail)" }}>
                        {delta > 0 ? "+" : ""}
                        {delta}
                      </span>
                    )}
                  </div>
                  <div className="row">
                    <button className="btn btn-sm" onClick={() => onScanUrl(s.url)}>
                      Rescan
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      aria-label={`Stop tracking ${s.key}`}
                      onClick={() => {
                        removeSite(s.key);
                        onSitesChange();
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="features">
        {FEATURES.map((f) => (
          <div className="card feature" key={f.t}>
            <h3>{f.t}</h3>
            <p>{f.d}</p>
          </div>
        ))}
      </section>
    </>
  );
}
