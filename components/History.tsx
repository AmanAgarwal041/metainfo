"use client";

import { useState } from "react";
import { diffSnapshots, type TrackedSite } from "@/lib/history";
import { PLATFORM_META, PLATFORMS, type Platform, type Report } from "@/lib/types";
import { download, scoreColor } from "./ui";

type Series = Platform | "overall";

function TrendChart({ site, visible }: { site: TrackedSite; visible: Set<Series> }) {
  const snaps = site.snapshots;
  const W = 760;
  const H = 240;
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (snaps.length === 1 ? iw / 2 : (i / (snaps.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / 100) * ih;
  const series: { id: Series; color: string; values: number[] }[] = [
    { id: "overall", color: "var(--text)", values: snaps.map((s) => s.overall) },
    ...PLATFORMS.map((p) => ({ id: p as Series, color: PLATFORM_META[p].color, values: snaps.map((s) => s.scores[p] ?? 0) })),
  ];
  const sameDay = snaps.length > 0 && new Date(snaps[0].scannedAt).toDateString() === new Date(snaps[snaps.length - 1].scannedAt).toDateString();
  const fmt = (iso: string) =>
    sameDay
      ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const ticks = snaps.length <= 6 ? snaps.map((_, i) => i) : [0, Math.floor((snaps.length - 1) / 2), snaps.length - 1];
  return (
    <div className="table-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Score trend">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line className="gridline" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle">
            {fmt(snaps[i].scannedAt)}
          </text>
        ))}
        {series
          .filter((s) => visible.has(s.id))
          .map((s) => (
            <g key={s.id}>
              <polyline
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={s.id === "overall" ? 3 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={s.id === "overall" ? 3.5 : 2.5} fill={s.color}>
                  <title>
                    {s.id === "overall" ? "Overall" : PLATFORM_META[s.id].short}: {v} ({new Date(snaps[i].scannedAt).toLocaleString()})
                  </title>
                </circle>
              ))}
            </g>
          ))}
      </svg>
    </div>
  );
}

export default function History({ report, site }: { report: Report; site: TrackedSite | null }) {
  const [visible, setVisible] = useState<Set<Series>>(new Set(["overall", "google", "chatgpt", "perplexity", "claude"]));
  if (!site) {
    return <div className="card empty">Tracking needs a scanned URL. Scan a live page to start recording its history.</div>;
  }
  const title = (id: string) => report.checks.find((c) => c.id === id)?.title ?? id;
  const toggle = (s: Series) => {
    const next = new Set(visible);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setVisible(next);
  };
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
        <div className="legend" style={{ margin: "10px 0" }}>
          {(["overall", ...PLATFORMS] as Series[]).map((s) => (
            <button key={s} aria-pressed={visible.has(s)} onClick={() => toggle(s)}>
              <span className="dot" style={{ background: s === "overall" ? "var(--text)" : PLATFORM_META[s].color }} />
              {s === "overall" ? "Overall" : PLATFORM_META[s].short}
            </button>
          ))}
        </div>
        <TrendChart site={site} visible={visible} />
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
                        {s.scores[p] ?? "—"}
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
