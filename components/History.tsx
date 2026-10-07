"use client";

import { diffSnapshots, type TrackedSite } from "@/lib/history";
import { PLATFORM_META, PLATFORMS, type Report } from "@/lib/types";
import { LineChart } from "./charts";
import { download, scoreColor } from "./ui";

function fmtTick(iso: string, all: { scannedAt: string }[]) {
  const sameDay = all.length > 0 && new Date(all[0].scannedAt).toDateString() === new Date(all[all.length - 1].scannedAt).toDateString();
  const d = new Date(iso);
  return sameDay ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function History({ report, site }: { report: Report; site: TrackedSite | null }) {
  if (!site) {
    return <div className="card empty">Tracking needs a scanned URL. Scan a live page to start recording its history.</div>;
  }
  const title = (id: string) => report.checks.find((c) => c.id === id)?.title ?? id;
  const rows = [...site.snapshots].reverse();

  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row">
          <h3 className="section-title">Score trend</h3>
          <span className="muted small">{site.snapshots.length} scan(s) of {site.key}</span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => download("metainfo-history.json", JSON.stringify(site, null, 2), "application/json")}>
            Export history
          </button>
        </div>
        <div style={{ marginTop: 10 }}>
          <LineChart
            ariaLabel="Audit scores over time"
            x={site.snapshots.map((s) => fmtTick(s.scannedAt, site.snapshots))}
            yDomain={[0, 100]}
            series={[
              { id: "overall", label: "Overall", color: "var(--text)", values: site.snapshots.map((s) => s.overall) },
              ...PLATFORMS.map((p) => ({ id: p, label: PLATFORM_META[p].short, color: PLATFORM_META[p].color, values: site.snapshots.map((s) => s.scores[p] ?? null) })),
            ]}
            initiallyHidden={["bing", "gemini", "social"]}
          />
        </div>
        {site.snapshots.length === 1 && <p className="muted small">Rescan after shipping fixes to see the trend.</p>}
      </div>

      <div className="card card-pad">
        <h3 className="section-title">Scan log</h3>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="t">
            <thead>
              <tr>
                <th>Scanned</th>
                <th>Overall</th>
                {PLATFORMS.map((p) => (
                  <th key={p} className="c">
                    {PLATFORM_META[p].short}
                  </th>
                ))}
                <th>Changes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const prev = rows[i + 1];
                const d = prev ? diffSnapshots(prev, s) : null;
                return (
                  <tr key={s.id}>
                    <td className="small" style={{ whiteSpace: "nowrap" }}>{new Date(s.scannedAt).toLocaleString()}</td>
                    <td>
                      <b style={{ color: scoreColor(s.overall) }}>{s.overall}</b>
                      {prev && s.overall !== prev.overall && (
                        <span className="small" style={{ marginLeft: 4, color: s.overall > prev.overall ? "var(--pass)" : "var(--fail)" }}>
                          {s.overall > prev.overall ? "+" : ""}
                          {s.overall - prev.overall}
                        </span>
                      )}
                    </td>
                    {PLATFORMS.map((p) => (
                      <td key={p} className="c" style={{ color: scoreColor(s.scores[p] ?? 0) }}>
                        {s.scores[p] ?? "-"}
                      </td>
                    ))}
                    <td className="small">
                      {!d && <span className="muted">first scan · {s.summary.failed} failed, {s.summary.warnings} warnings</span>}
                      {d && d.fixed.length === 0 && d.regressed.length === 0 && <span className="muted">no change</span>}
                      {d && d.fixed.length > 0 && <div style={{ color: "var(--pass)" }}>Fixed: {d.fixed.map(title).join(", ")}</div>}
                      {d && d.regressed.length > 0 && <div style={{ color: "var(--fail)" }}>Regressed: {d.regressed.map(title).join(", ")}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="section-title">Automate tracking</h3>
        <p className="section-sub">
          History is saved in this browser. To track from CI or a cron job, call the JSON API. It runs the same WASM engine
          on the server. Add <code>min</code> to fail a deploy when the score drops below a threshold.
        </p>
        <pre className="code" style={{ padding: "12px 14px", overflowX: "auto" }}>
          <code>{`curl "${typeof window !== "undefined" ? window.location.origin : ""}/api/report?url=${encodeURIComponent(site.url)}&format=summary&min=80"`}</code>
        </pre>
      </div>
    </div>
  );
}
