"use client";

import type { Report } from "@/lib/types";

/** Raw HTML (what AI crawlers read) versus the browser-rendered DOM (what Google and people see). */
export default function Rendering({ report, scraper }: { report: Report; scraper: boolean }) {
  const r = report.render;
  if (!r) {
    return (
      <div className="card card-pad">
        <h3 className="section-title">JavaScript rendering not measured</h3>
        <p className="section-sub" style={{ marginBottom: 0 }}>
          {scraper
            ? "The rendering service didn't return this page (it may have timed out). Rescan to try again."
            : "Connect the Scrapling rendering service (SCRAPER_URL) to render pages in a real browser and measure exactly what crawlers that don't run JavaScript miss. Without it, the audit uses a heuristic for app shells."}
        </p>
      </div>
    );
  }
  const visible = r.renderedWords - r.hiddenWords;
  const tone = r.hiddenPct >= 50 ? "var(--fail)" : r.hiddenPct >= 20 ? "var(--warn)" : "var(--pass)";
  return (
    <div className="stack">
      <div className="kpi-row">
        <div className="kpi">
          <div className="k-label">Hidden from AI crawlers</div>
          <div className="k-value" style={{ color: tone }}>{r.hiddenPct}%</div>
          <div className="k-foot">{r.hiddenWords.toLocaleString()} of {r.renderedWords.toLocaleString()} words need JavaScript</div>
        </div>
        <div className="kpi">
          <div className="k-label">Meta tags changed by JavaScript</div>
          <div className="k-value" style={{ color: r.metaChanges.length ? "var(--fail)" : "var(--pass)" }}>{r.metaChanges.length}</div>
          <div className="k-foot">title, description, canonical, robots, Open Graph</div>
        </div>
        <div className="kpi">
          <div className="k-label">Links added by JavaScript</div>
          <div className="k-value" style={{ color: r.linksOnlyRendered.length ? "var(--warn)" : undefined }}>{r.linksOnlyRendered.length}</div>
          <div className="k-foot">{r.rawInternalLinks} internal links in the raw HTML</div>
        </div>
        <div className="kpi">
          <div className="k-label">Render time</div>
          <div className="k-value">{r.renderMs != null ? `${(r.renderMs / 1000).toFixed(1)} s` : "n/a"}</div>
          <div className="k-foot">Headless Chromium via Scrapling</div>
        </div>
      </div>

      <section className="card card-pad">
        <h3 className="section-title">Word coverage</h3>
        <p className="section-sub">What a crawler that doesn&apos;t run JavaScript (GPTBot, ClaudeBot, PerplexityBot, link previews) reads, against the rendered page.</p>
        <div className="dist" role="img" aria-label={`${visible} words visible without JavaScript, ${r.hiddenWords} only after`} style={{ height: 14 }}>
          {visible > 0 && <span style={{ flex: visible, background: "var(--pass)" }} />}
          {r.hiddenWords > 0 && <span style={{ flex: r.hiddenWords, background: "var(--fail)" }} />}
        </div>
        <div className="legend" style={{ marginTop: 10 }}>
          <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: "var(--pass)", borderRadius: 2 }} /> In the raw HTML <b style={{ color: "var(--text)" }}>{visible.toLocaleString()}</b></span>
          <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: "var(--fail)", borderRadius: 2 }} /> Only after JavaScript <b style={{ color: "var(--text)" }}>{r.hiddenWords.toLocaleString()}</b></span>
        </div>
        {r.hiddenSample && (
          <div style={{ marginTop: 14 }}>
            <div className="field-label" style={{ marginBottom: 6 }}>Example of text crawlers never see</div>
            <div className="answer">{r.hiddenSample}</div>
          </div>
        )}
      </section>

      {r.metaChanges.length > 0 && (
        <section className="card card-pad">
          <h3 className="section-title">Meta tags set or changed by JavaScript</h3>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="t">
              <thead>
                <tr><th>Tag</th><th>Raw HTML (crawlers, link previews)</th><th>After JavaScript (Google, browsers)</th></tr>
              </thead>
              <tbody>
                {r.metaChanges.map((m) => (
                  <tr key={m.field}>
                    <td className="mono">{m.field}</td>
                    <td className="break small">{m.raw ?? <span className="no">missing</span>}</td>
                    <td className="break small">{m.rendered ?? <span className="no">removed</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="two-col">
        <section className="card card-pad">
          <h3 className="section-title">Headings only after JavaScript ({r.headingsOnlyRendered.length})</h3>
          {r.headingsOnlyRendered.length ? (
            <ul className="plain-list">{r.headingsOnlyRendered.map((h) => <li key={h}>{h}</li>)}</ul>
          ) : (
            <p className="muted small">None. Every heading is in the raw HTML.</p>
          )}
        </section>
        <section className="card card-pad">
          <h3 className="section-title">Links only after JavaScript ({r.linksOnlyRendered.length})</h3>
          {r.linksOnlyRendered.length ? (
            <ul className="plain-list">{r.linksOnlyRendered.map((l) => <li key={l} className="break small">{l}</li>)}</ul>
          ) : (
            <p className="muted small">None. Crawlers can discover every internal link without rendering.</p>
          )}
        </section>
      </div>

      <section className="card card-pad">
        <h3 className="section-title">Structured data</h3>
        <p className="small" style={{ marginTop: 6 }}>
          Raw HTML: <b>{r.jsonldRaw.join(", ") || "none"}</b>. After JavaScript: <b>{r.jsonldRendered.join(", ") || "none"}</b>.
          {r.jsonldOnlyRendered.length > 0 && <span style={{ color: "var(--warn)" }}> Added by JavaScript: {r.jsonldOnlyRendered.join(", ")}.</span>}
        </p>
      </section>
    </div>
  );
}
