"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useProject } from "@/lib/project";
import { checkFromSerp, rankHistory, rankKey, recordRanks, type RankCheck } from "@/lib/rank-history";
import { research, toCsv } from "@/lib/research-client";
import { locationByCode, type SerpResult } from "@/lib/research-types";
import { Distribution, LineChart } from "../charts";
import { Delta, EmptyState, Kpi, PageHead } from "../kit";
import { download } from "../ui";
import { ErrorBox, ProjectBar, ProviderNotice, useResearchStatus } from "./common";

type Device = "desktop" | "mobile";
const SERP_COST = 0.004; // live SERP, depth 20 (DataForSEO: $0.002 per 10 results)

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function Rankings() {
  const [project, update] = useProject();
  const status = useResearchStatus();
  const [device, setDevice] = useState<Device>("desktop");
  const [adding, setAdding] = useState("");
  const [histories, setHistories] = useState<Record<string, RankCheck[]>>({});
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; cost: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [fatal, setFatal] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "dates">("table");
  const domains = [project.domain, ...project.competitors].filter(Boolean);

  useEffect(() => {
    const h: Record<string, RankCheck[]> = {};
    for (const k of project.keywords) h[k] = rankHistory(rankKey(k, project.location, device));
    setHistories(h);
  }, [project.keywords, project.location, device]);

  const rows = useMemo(
    () =>
      project.keywords.map((k) => {
        const h = histories[k] ?? [];
        const cur = h.at(-1);
        const before = h.at(-2);
        const pos = cur?.positions[project.domain] ?? null;
        const prev = before?.positions[project.domain] ?? null;
        const best = h.reduce<number | null>((b, c) => {
          const p = c.positions[project.domain];
          return p != null && (b == null || p < b) ? p : b;
        }, null);
        return { keyword: k, h, cur, pos, change: pos != null && prev != null ? prev - pos : 0, best };
      }),
    [project.keywords, project.domain, histories],
  );

  const checked = rows.filter((r) => r.cur);
  const ranking = checked.filter((r) => r.pos != null);
  const avg = ranking.length ? Math.round((ranking.reduce((n, r) => n + r.pos!, 0) / ranking.length) * 10) / 10 : null;
  const aiCited = checked.filter((r) => r.cur?.ai?.cited).length;
  const aiShown = checked.filter((r) => r.cur?.ai?.present).length;
  const dates = [...new Set(rows.flatMap((r) => r.h.map((c) => c.checkedAt.slice(0, 10))))].sort().slice(-8);

  const addKeywords = () => {
    const list = adding.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (list.length) update({ keywords: [...project.keywords, ...list] });
    setAdding("");
  };

  const runChecks = async () => {
    setConfirm(false);
    setErrors([]);
    setFatal(null);
    const list = [...project.keywords];
    setProgress({ done: 0, total: list.length, cost: 0 });
    let next = 0;
    let cost = 0;
    let done = 0;
    let stop = false;
    await Promise.all(
      Array.from({ length: Math.min(3, list.length) }, async () => {
        while (next < list.length && !stop) {
          const k = list[next++];
          try {
            const d = await research<SerpResult>("serp", { q: k, loc: project.location, device });
            cost += d.cost;
            const h = recordRanks(rankKey(k, project.location, device), checkFromSerp(d, domains));
            setHistories((prev) => ({ ...prev, [k]: h }));
          } catch (e) {
            const code = (e as { code?: unknown }).code;
            if (code === 40100 || code === 40210 || code === "token" || code === "not-configured") {
              stop = true;
              setFatal(e);
            } else setErrors((x) => [...x, `${k}: ${e instanceof Error ? e.message : String(e)}`]);
          }
          setProgress({ done: ++done, total: list.length, cost });
        }
      }),
    );
    setProgress((p) => (p ? { ...p, done: p.total } : p));
    setTimeout(() => setProgress(null), 2500);
  };

  const exportCsv = () =>
    download(
      `rankings-${project.domain}-${device}.csv`,
      toCsv(rows.map((r) => ({ keyword: r.keyword, position: r.pos ?? "", change: r.change, best: r.best ?? "", url: r.cur?.urls?.[project.domain] ?? "", ai_overview: r.cur?.ai?.present ? (r.cur.ai.cited ? "cited" : "shown") : "", checked: r.cur?.checkedAt ?? "", ...Object.fromEntries(project.competitors.map((c) => [c, r.cur?.positions[c] ?? ""])) }))),
      "text/csv",
    );

  return (
    <main className="shell">
      <PageHead
        title="Rank tracking"
        sub={`Google positions for ${project.domain || "your site"} and competitors in ${locationByCode(project.location).name}. Every check is kept so you can see movement.`}
        actions={
          <>
            <div className="segmented" role="group" aria-label="Device">
              {(["desktop", "mobile"] as Device[]).map((d) => (
                <button key={d} aria-pressed={device === d} onClick={() => setDevice(d)}>
                  {d === "desktop" ? "Desktop" : "Mobile"}
                </button>
              ))}
            </div>
            {status?.dataforseo && (
              <button className="btn btn-primary" disabled={!project.keywords.length || !project.domain || !!progress} onClick={() => setConfirm(true)}>
                {progress ? `Checking ${progress.done}/${progress.total}` : "Check rankings"}
              </button>
            )}
          </>
        }
      />
      <div className="stack">
        <ProjectBar />
        {status && !status.dataforseo && <ProviderNotice unlocks="rank checks" free={<>You can build your keyword list now; positions are fetched once DataForSEO is connected.</>} />}

        {confirm && (
          <div className="card card-pad row" role="alertdialog" aria-label="Confirm rank check">
            <div style={{ flex: 1, minWidth: 240 }}>
              <b>Check {project.keywords.length} keywords on {device}?</b>
              <div className="muted small">
                About ${(project.keywords.length * SERP_COST).toFixed(3)} in DataForSEO credit (top 20 results each). Results cached in the last 12 hours are free.
              </div>
            </div>
            <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={runChecks}>Run check</button>
          </div>
        )}
        {progress && (
          <div className="card card-pad">
            <div className="row small" style={{ marginBottom: 8 }}>
              <span className="spinner" style={{ visibility: progress.done < progress.total ? "visible" : "hidden" }} />
              {progress.done < progress.total ? `Checking ${progress.done} of ${progress.total}` : `Checked ${progress.total} keywords`}
              <span className="spacer" />
              <span className="muted">Spent ${progress.cost.toFixed(4)}</span>
            </div>
            <div className="progress-bar"><span style={{ width: `${(progress.done / progress.total) * 100}%`, background: "var(--accent)" }} /></div>
          </div>
        )}
        <ErrorBox error={fatal} onRetry={runChecks} />
        {errors.length > 0 && <div className="error-box">{errors.slice(0, 5).join(" ")}</div>}

        {checked.length > 0 && (
          <>
            <div className="kpi-row">
              <Kpi label="Average position" value={avg ?? "n/a"} foot={`${ranking.length} of ${checked.length} keywords rank in the top 20`} />
              <Kpi label="In the top 3" value={ranking.filter((r) => r.pos! <= 3).length} foot={`${ranking.filter((r) => r.pos! <= 10).length} on page one`} />
              <Kpi label="Moved up" value={rows.filter((r) => r.change > 0).length} foot={`${rows.filter((r) => r.change < 0).length} moved down since the last check`} />
              <Kpi label="AI Overview citations" value={aiCited} foot={`AI Overview shown for ${aiShown} of ${checked.length} keywords`} />
            </div>
            <div className="card card-pad">
              <h2 className="section-title">Position distribution</h2>
              <div style={{ marginTop: 10 }}>
                <Distribution
                  ariaLabel="Keywords by position bucket"
                  parts={[
                    { label: "Top 3", value: ranking.filter((r) => r.pos! <= 3).length, color: "#1c5cab" },
                    { label: "4 to 10", value: ranking.filter((r) => r.pos! > 3 && r.pos! <= 10).length, color: "#2a78d6" },
                    { label: "11 to 20", value: ranking.filter((r) => r.pos! > 10).length, color: "#86b6ef" },
                    { label: "Not in top 20", value: checked.length - ranking.length, color: "var(--surface-3)" },
                  ]}
                />
              </div>
            </div>
          </>
        )}

        <div className="card card-pad">
          <div className="panel-head">
            <div>
              <h2 className="section-title">Tracked keywords ({project.keywords.length})</h2>
              <p className="section-sub" style={{ marginBottom: 0 }}>Add keywords here or from Keyword research. Select a row to see its history.</p>
            </div>
            <span className="spacer" />
            {checked.length > 0 && (
              <div className="segmented" role="group" aria-label="View">
                <button aria-pressed={view === "table"} onClick={() => setView("table")}>Latest</button>
                <button aria-pressed={view === "dates"} onClick={() => setView("dates")}>By date</button>
              </div>
            )}
            {checked.length > 0 && <button className="btn btn-sm" onClick={exportCsv}>Export CSV</button>}
          </div>
          <form
            className="scan-row"
            style={{ marginBottom: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              addKeywords();
            }}
          >
            <input className="input" style={{ height: 36 }} placeholder="Add keywords, separated by commas" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Keywords to track" />
            <button className="btn" style={{ height: 36 }} type="submit" disabled={!adding.trim()}>Add</button>
          </form>

          {project.keywords.length === 0 ? (
            <EmptyState title="No keywords tracked" body="Add the searches you want to rank for. Keyword research can suggest them, with volumes." action={{ href: "/keywords", label: "Find keywords" }} />
          ) : view === "dates" ? (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    {dates.map((d) => <th key={d} style={{ textAlign: "center" }}>{fmt(d)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const byDate = new Map(r.h.map((c) => [c.checkedAt.slice(0, 10), c.positions[project.domain]]));
                    return (
                      <tr key={r.keyword}>
                        <td>{r.keyword}</td>
                        {dates.map((d, i) => {
                          const p = byDate.get(d);
                          const q = i > 0 ? byDate.get(dates[i - 1]) : undefined;
                          return (
                            <td key={d} style={{ textAlign: "center" }}>
                              {p == null ? <span className="na">{byDate.has(d) ? "20+" : ""}</span> : <b>{p}</b>}
                              {p != null && q != null && p !== q && <span className="small" style={{ color: q > p ? "var(--pass)" : "var(--fail)", marginLeft: 4 }}>{q > p ? "▲" : "▼"}{Math.abs(q - p)}</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th style={{ textAlign: "right" }}>Position</th>
                    <th>Change</th>
                    <th style={{ textAlign: "right" }}>Best</th>
                    {project.competitors.map((c) => <th key={c} style={{ textAlign: "right" }}>{c}</th>)}
                    <th>AI Overview</th>
                    <th>Ranking URL</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.keyword}>
                      <tr onClick={() => setOpen(open === r.keyword ? null : r.keyword)} style={{ cursor: "pointer" }} aria-expanded={open === r.keyword}>
                        <td style={{ fontWeight: 560 }}>{r.keyword}</td>
                        <td style={{ textAlign: "right" }}>{r.cur ? (r.pos != null ? <b>{r.pos}</b> : <span className="na">20+</span>) : <span className="na">not checked</span>}</td>
                        <td>{r.cur && r.h.length > 1 ? <Delta value={r.change} /> : null}</td>
                        <td style={{ textAlign: "right" }} className="muted">{r.best ?? ""}</td>
                        {project.competitors.map((c) => <td key={c} style={{ textAlign: "right" }}>{r.cur?.positions[c] ?? <span className="na">{r.cur ? "20+" : ""}</span>}</td>)}
                        <td>{r.cur?.ai?.present ? (r.cur.ai.cited ? <span className="badge gain">cited</span> : <span className="badge">shown</span>) : null}</td>
                        <td className="small break muted" style={{ maxWidth: 260 }}>{r.cur?.urls?.[project.domain]?.replace(/^https?:\/\/(www\.)?/, "") ?? ""}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <Link className="btn btn-sm btn-ghost" href={`/serp?q=${encodeURIComponent(r.keyword)}`} onClick={(e) => e.stopPropagation()}>SERP</Link>
                          <button
                            className="btn btn-sm btn-ghost"
                            aria-label={`Stop tracking ${r.keyword}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              update({ keywords: project.keywords.filter((k) => k !== r.keyword) });
                            }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                      {open === r.keyword && (
                        <tr>
                          <td colSpan={7 + project.competitors.length} style={{ background: "var(--surface)" }}>
                            {r.h.length ? (
                              <LineChart
                                ariaLabel={`Position history for ${r.keyword}`}
                                invert
                                x={r.h.map((c) => fmt(c.checkedAt))}
                                series={domains.map((d, i) => ({ id: d, label: i === 0 ? `${d} (you)` : d, color: `var(--series-${i + 1})`, values: r.h.map((c) => c.positions[d] ?? null) }))}
                              />
                            ) : (
                              <p className="muted">No checks yet for this keyword on {device}.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
