"use client";

import { useMemo, useState } from "react";
import { metricsFor, type Brand } from "@/lib/aeo";
import { actionImpact, ownedPages, type AeoAction, type RunAnswers } from "@/lib/aeo-actions";
import { AI_ENGINES } from "@/lib/research-types";
import { HBars, LineChart } from "../charts";
import { Delta, Kpi } from "../kit";
import TrafficImpact from "./TrafficImpact";
import { GroupHead, Tile } from "./tables";

// Impact: is the work paying off? Your numbers and competitors' across runs, which of your pages engines cite and
// how often, and before/after for every action marked done.

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)"];
const path = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
};

function Bars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <span className="mini-bars" title={values.map((v, i) => `run ${i + 1}: ${v}`).join(", ")} aria-label={`Citations per run: ${values.join(", ")}`}>
      {values.slice(-12).map((v, i) => (
        <span key={i} style={{ height: `${Math.max(2, (v / max) * 100)}%`, opacity: v ? 1 : 0.35 }} />
      ))}
    </span>
  );
}

export default function Impact({ runs, brands, actions, projectId, domain }: { runs: RunAnswers[]; brands: Brand[]; actions: AeoAction[]; projectId: string; domain: string }) {
  const [view, setView] = useState<"citations" | "traffic">("citations");
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="segmented" role="group" aria-label="Impact view" style={{ alignSelf: "flex-start" }}>
        <button aria-pressed={view === "citations"} onClick={() => setView("citations")}>Citation performance</button>
        <button aria-pressed={view === "traffic"} onClick={() => setView("traffic")}>Bot and referral traffic</button>
      </div>
      {view === "citations" ? <CitationImpact runs={runs} brands={brands} actions={actions} /> : <TrafficImpact projectId={projectId} domain={domain} />}
    </div>
  );
}

function CitationImpact({ runs, brands, actions }: { runs: RunAnswers[]; brands: Brand[]; actions: AeoAction[] }) {
  const you = brands[0].domain;
  const [allPages, setAllPages] = useState(false);
  const x = runs.map((r) => fmt(r.at));
  const mine = useMemo(() => runs.map((r) => metricsFor(r.answers, you)), [runs, you]);
  const pages = useMemo(() => ownedPages(runs, brands), [runs, brands]);
  const done = actions.filter((a) => a.status === "done").map((a) => ({ a, x: actionImpact(a, runs, you) }));
  const engines = AI_ENGINES.filter((e) => runs.some((r) => r.answers.some((a) => a.engine === e.id && a.answered)));
  const now = mine.at(-1);
  const before = mine.at(-2);
  const citedNow = pages.filter((p) => p.perRun.at(-1)! > 0).length;
  const citedBefore = runs.length > 1 ? pages.filter((p) => p.perRun.at(-2)! > 0).length : null;
  const shownPages = allPages ? pages : pages.slice(0, 10);

  if (!now) return null;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <GroupHead title="Summary" sub="How your own pages are doing in AI answers, and whether the work is paying off." />
      <div className="impact-summary">
        <div className="impact-kpis">
          <Kpi label="Total URLs" value={pages.length} foot="your pages cited in any run" />
          <Kpi label="Cited URLs" value={citedNow} foot={citedBefore != null ? <>latest run <Delta value={citedNow - citedBefore} /></> : "in the latest run"} />
          <Kpi label="Citation rate" value={`${now.citationRate}%`} foot={before ? <>of answers <Delta value={now.citationRate - before.citationRate} suffix=" pts" /></> : "of answers cite your pages"} />
        </div>
        <Tile title="Citation rate of your pages over time" sub="Share of each engine's answers citing one of your pages.">
          {runs.length > 1 ? (
            <LineChart
              ariaLabel="Your citation rate per engine per run"
              x={x}
              yDomain={[0, 100]}
              format={(n) => `${n}%`}
              series={engines.map((e) => ({ id: e.id, label: e.label, color: e.color, values: runs.map((r) => { const m = metricsFor(r.answers.filter((a) => a.engine === e.id), you); return m.answered ? m.citationRate : null; }) }))}
            />
          ) : (
            <HBars items={engines.map((e) => ({ label: e.label, value: metricsFor(now ? runs.at(-1)!.answers.filter((a) => a.engine === e.id) : [], you).citationRate }))} format={(n) => `${n}%`} />
          )}
        </Tile>
      </div>

      <section className="card card-pad">
        <h2 className="section-title">Your pages AI answers cite</h2>
        <p className="section-sub">Pages on your site and your own accounts (GitHub, PyPI, social profiles). Frequency: share of the latest run&apos;s prompts whose answers cite the page.</p>
        {pages.length ? (
          <>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Prompts (latest)</th>
                    <th>Engines</th>
                    <th style={{ textAlign: "right" }}>Frequency</th>
                    <th>Per run</th>
                    <th>First cited</th>
                  </tr>
                </thead>
                <tbody>
                  {shownPages.map((p) => (
                    <tr key={p.url}>
                      <td style={{ maxWidth: 380 }}>
                        <a href={p.url} target="_blank" rel="noreferrer" className="small" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{path(p.url)}</a>
                        {p.title && <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>}
                      </td>
                      <td className="small" title={p.prompts.join("\n")}>{p.prompts.length ? `${p.prompts.length} ${p.prompts.length === 1 ? "prompt" : "prompts"}` : <span className="muted">not in latest run</span>}</td>
                      <td>
                        <span className="row" style={{ gap: 3 }}>
                          {p.engines.map((e) => <span key={e} className="dot" title={AI_ENGINES.find((x) => x.id === e)?.label} style={{ background: AI_ENGINES.find((x) => x.id === e)?.color }} />)}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}><span className={`badge freq ${p.frequency >= 50 ? "gain" : p.frequency >= 20 ? "sev-high" : "sev-critical"}`}>{p.frequency}%</span></td>
                      <td><Bars values={p.perRun} /></td>
                      <td className="small muted">{fmt(p.firstSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages.length > 10 && (
              <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setAllPages(!allPages)}>{allPages ? "Show fewer" : `Show all ${pages.length}`}</button>
            )}
          </>
        ) : (
          <p className="muted small">No page of yours has been cited yet. The Actions tab lists what to publish and where to get mentioned.</p>
        )}
      </section>

      <div className="bento">
        <Tile className="b-6" title="Top performing citations" sub="Your most cited pages, across every run.">
          {pages.length ? (
            <HBars items={[...pages].sort((a, b) => sum(b.perRun) - sum(a.perRun)).slice(0, 8).map((p) => ({ label: path(p.url), value: sum(p.perRun), href: p.url, title: p.title || p.url }))} />
          ) : (
            <p className="muted small">None yet.</p>
          )}
        </Tile>
        <Tile className="b-6" title="Answer engine performance" sub="Answers citing your pages, per engine and run.">
          {runs.length > 1 ? (
            <LineChart
              ariaLabel="Answers citing your pages per engine per run"
              x={x}
              series={engines.map((e) => ({ id: e.id, label: e.label, color: e.color, values: runs.map((r) => r.answers.filter((a) => a.engine === e.id && a.answered && a.brands?.some((b) => b.domain === you && b.cited)).length) }))}
            />
          ) : (
            <HBars items={engines.map((e) => ({ label: e.label, value: runs.at(-1)!.answers.filter((a) => a.engine === e.id && a.answered && a.brands?.some((b) => b.domain === you && b.cited)).length }))} />
          )}
        </Tile>
        {runs.length > 1 && (
          <Tile className="b-12" title="You over time" sub="Visibility, citation rate and share of voice across every prompt and engine.">
            <LineChart
              ariaLabel="Your visibility, citation rate and share of voice per run"
              x={x}
              yDomain={[0, 100]}
              format={(n) => `${n}%`}
              series={[
                { id: "vis", label: "Visibility", color: SERIES[0], values: mine.map((m) => (m.answered ? m.visibility : null)) },
                { id: "cit", label: "Citation rate", color: SERIES[1], values: mine.map((m) => (m.answered ? m.citationRate : null)) },
                { id: "sov", label: "Share of voice", color: SERIES[2], values: mine.map((m) => (m.answered ? m.shareOfVoice : null)) },
              ]}
            />
          </Tile>
        )}
      </div>

      <section className="card card-pad">
        <h2 className="section-title">Done actions: before and after</h2>
        <p className="section-sub">On the answers each action targets: the last run before you marked it done against the latest run since.</p>
        {done.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Done</th>
                  <th style={{ textAlign: "right" }}>Named</th>
                  <th style={{ textAlign: "right" }}>Cited</th>
                  <th style={{ textAlign: "right" }}>Position</th>
                  <th style={{ textAlign: "right" }}>Runs since</th>
                </tr>
              </thead>
              <tbody>
                {done.map(({ a, x: i }) => (
                  <tr key={a.id}>
                    <td style={{ maxWidth: 360 }}><b className="small">{a.title}</b></td>
                    <td className="small muted">{a.doneAt ? fmt(a.doneAt) : "–"}</td>
                    {i ? (
                      <>
                        <td style={{ textAlign: "right" }} className="small">{i.before.visibility}% → {i.after.visibility}% <Delta value={i.visibility} /></td>
                        <td style={{ textAlign: "right" }} className="small">{i.before.citationRate}% → {i.after.citationRate}% <Delta value={i.citationRate} /></td>
                        <td style={{ textAlign: "right" }} className="small">{i.position == null ? "–" : <Delta value={i.position} />}</td>
                        <td style={{ textAlign: "right" }} className="mono">{i.runsAfter}</td>
                      </>
                    ) : (
                      <td colSpan={4} className="muted small" style={{ textAlign: "right" }}>Waiting for a run after it was done</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">Mark actions done in the Actions tab; the next run measures them here.</p>
        )}
      </section>

    </div>
  );
}
