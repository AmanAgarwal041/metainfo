"use client";

import { useEffect, useMemo, useState } from "react";
import { nameOf, OPPORTUNITY_KINDS, SOURCE_TYPES, type Answer, type Brand, type Opportunity } from "@/lib/aeo";
import { actionId } from "@/lib/aeo-actions";
import { engineChange, PROMPT_STATUS, promptReports, type EngineRow, type PromptReport as Report, type PromptStatus } from "@/lib/aeo-prompt";
import { fromOpportunity, type PromptContext } from "@/lib/fix-prompts";
import { AI_ENGINES, type AiEngine } from "@/lib/research-types";
import { CollatedPrompt, FixPromptButton, PickBox, useFixPicker } from "../FixPrompt";
import { SentimentBadge, TypeBadge } from "./shared";

// "By prompt": pick a prompt, see where each engine puts you against competitors and which pages it cites,
// then the plan: rank higher when you're named, get into the answer when you're not.

const engine = (e: AiEngine) => AI_ENGINES.find((x) => x.id === e);
const host = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? u.hostname : `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
};

function StatusBadge({ status }: { status: PromptStatus }) {
  return <span className={`badge ${PROMPT_STATUS[status].cls}`}>{PROMPT_STATUS[status].label}</span>;
}

function YouCell({ e }: { e: EngineRow }) {
  if (e.state === "no-answer") return <span className="na">no answer</span>;
  if (e.state === "absent") return <span className="badge">not named</span>;
  return (
    <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      <span className={`badge ${e.state === "cited" ? "gain" : "accent"}`}>
        {e.position ? `#${e.position} ` : ""}
        {e.state}
      </span>
      <SentimentBadge s={e.sentiment} />
    </span>
  );
}

function Change({ e }: { e: EngineRow }) {
  const c = engineChange(e);
  if (!c) return <span className="muted small">{e.before ? "same" : "–"}</span>;
  return (
    <span className="small" style={{ color: c.dir === "up" ? "var(--pass)" : "var(--fail)" }}>
      {c.dir === "up" ? "▲" : "▼"} {c.label}
    </span>
  );
}

function Detail({ r, you, ctx, onSimulate, tracked, onTrack }: { r: Report; you: string; ctx: PromptContext; onSimulate: (prompt: string, engine?: AiEngine) => void; tracked?: Set<string>; onTrack?: (o: Opportunity) => void }) {
  const fixes = useMemo(() => r.plan.map(fromOpportunity), [r.plan]);
  const picker = useFixPicker();
  const cls = { high: "s-fail", medium: "s-warn", low: "s-info" };
  const absentSome = r.engines.find((e) => e.state === "absent");
  const [allSources, setAllSources] = useState(false);
  const shown = allSources ? r.sources : r.sources.slice(0, 8);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="panel-head">
        <div>
          <h2 className="section-title">“{r.prompt}”</h2>
          <div className="row" style={{ gap: 6, margin: "6px 0" }}>
            <StatusBadge status={r.status} />
            <TypeBadge type={r.type} />
          </div>
          <p className="section-sub" style={{ marginBottom: 0 }}>{r.summary}</p>
        </div>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => onSimulate(r.prompt, absentSome?.engine)} title="Score your page against the pages the engine cited for this prompt">
          Simulate agents
        </button>
      </div>

      <div>
        <h3 className="small" style={{ margin: "0 0 6px" }}>By engine</h3>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Engine</th>
                <th>You</th>
                <th>Named ahead of you</th>
                <th style={{ textAlign: "right" }}>Sources</th>
                <th>Since last run</th>
              </tr>
            </thead>
            <tbody>
              {r.engines.map((e) => (
                <tr key={e.engine}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="dot" style={{ background: engine(e.engine)?.color }} />
                      {engine(e.engine)?.label ?? e.engine}
                    </span>
                  </td>
                  <td><YouCell e={e} /></td>
                  <td className="small">{e.ahead.length ? e.ahead.map(nameOf).join(", ") : <span className="muted">{e.state === "no-answer" ? "" : "nobody"}</span>}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{e.sources || ""}</td>
                  <td><Change e={e} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {r.rivals.length > 0 && (
        <div>
          <h3 className="small" style={{ margin: "0 0 6px" }}>Competitors in these answers</h3>
          <div className="list-rows">
            {r.rivals.map((x) => (
              <div className="list-row" key={x.domain}>
                <b style={{ width: 150 }}>{nameOf(x.domain)}</b>
                <span className="small" style={{ flex: 1 }}>
                  named by {x.named} of {r.answered}
                  {x.bestPosition ? `, best #${x.bestPosition}` : ""}
                  {x.cited ? `, cited by ${x.cited}` : ""}
                </span>
                {x.ahead > 0 && <span className="badge sev-high">ahead of you on {x.ahead}</span>}
              </div>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>Only tracked competitors are counted. Add others in project settings.</p>
        </div>
      )}

      {r.sources.length > 0 && (
        <div>
          <h3 className="small" style={{ margin: "0 0 6px" }}>Pages cited for this prompt</h3>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Type</th>
                  <th>Engines</th>
                  <th title="Tracked brands named in the answers that cite this page">Answer names</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.url} className={s.type === "you" ? "is-mine" : undefined}>
                    <td style={{ maxWidth: 360 }}>
                      <a href={s.url} target="_blank" rel="noreferrer" className="small" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {host(s.url)}
                      </a>
                      {s.title && <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>}
                    </td>
                    <td><span className={`badge ${s.type === "you" ? "accent" : ""}`}>{SOURCE_TYPES[s.type].label}</span></td>
                    <td>
                      <span className="row" style={{ gap: 3 }}>
                        {s.engines.map((e) => <span key={e} className="dot" title={engine(e)?.label} style={{ background: engine(e)?.color }} />)}
                      </span>
                    </td>
                    <td className="small">
                      {s.names.length ? (
                        <>
                          {s.names.includes(you) ? <span className="badge gain">you</span> : <span className="badge">not you</span>}{" "}
                          {s.names.filter((n) => n !== you).map(nameOf).join(", ")}
                        </>
                      ) : (
                        <span className="muted">no tracked brand</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.sources.length > 8 && (
            <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setAllSources(!allSources)}>
              {allSources ? "Show fewer" : `Show all ${r.sources.length}`}
            </button>
          )}
        </div>
      )}

      <div>
        <h3 className="small" style={{ margin: "0 0 6px" }}>{r.status === "absent" ? "How to get into this answer" : r.status === "leading" ? "How to keep it" : "How to rank higher"}</h3>
        {r.plan.length ? (
          <>
            <CollatedPrompt fixes={fixes} ctx={ctx} picker={picker} />
            {r.plan.map((o, k) => (
              <details className="insight" key={o.id} open={k === 0}>
                <summary>
                  <div className="insight-head has-pick">
                    <PickBox id={o.id} title={o.title} picker={picker} />
                    <span className={`badge ${cls[o.priority]}`}>{OPPORTUNITY_KINDS[o.kind]}</span>
                    <div>
                      <div className="task-title">{o.title}</div>
                      <div className="task-rec">{o.why}</div>
                    </div>
                  </div>
                </summary>
                <div className="insight-body">
                  <ol className="insight-steps">
                    {o.steps.map((s) => <li key={s}>{s}</li>)}
                  </ol>
                  {o.targets.length > 0 && (
                    <ul className="plain-list" style={{ marginTop: 10 }}>
                      {o.targets.map((t, i) => (
                        <li key={`${i}:${t.url ?? t.label}`}>{t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.label}</a> : <span className="small">{t.label}</span>}</li>
                      ))}
                    </ul>
                  )}
                  <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                    <FixPromptButton fix={fixes[k]} ctx={ctx} />
                    {onTrack &&
                      (tracked?.has(actionId(o)) ? (
                        <span className="badge gain" style={{ marginTop: 4 }}>Tracked in Actions</span>
                      ) : (
                        <button className="btn btn-sm" onClick={() => onTrack(o)}>Track as action</button>
                      ))}
                  </div>
                </div>
              </details>
            ))}
          </>
        ) : (
          <p className="muted small">No engine answered this prompt, so there&apos;s nothing to compare yet.</p>
        )}
      </div>
    </div>
  );
}

export default function PromptReport({
  answers,
  previous,
  brands,
  brand,
  domain,
  initial,
  onSimulate,
  tracked,
  onTrack,
}: {
  answers: Answer[];
  /** The run before, for "since last run". */
  previous: Answer[];
  brands: Brand[];
  brand: string;
  domain: string;
  initial: { prompt: string; nonce: number } | null;
  onSimulate: (prompt: string, engine?: AiEngine) => void;
  tracked?: Set<string>;
  onTrack?: (o: Opportunity) => void;
}) {
  const reports = useMemo(() => promptReports(answers, brands, brand, previous), [answers, brands, brand, previous]);
  const [filter, setFilter] = useState<PromptStatus | "all">("all");
  const [picked, setPicked] = useState(initial?.prompt ?? "");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening a prompt from the Prompts tab
    if (initial) setPicked(initial.prompt);
  }, [initial]);
  const ctx = useMemo<PromptContext>(() => ({ site: domain ? `https://${domain}` : brand, source: `AI visibility run (brand: ${brand})` }), [domain, brand]);
  const counts = useMemo(() => {
    const c: Record<PromptStatus, number> = { leading: 0, behind: 0, absent: 0, "no-data": 0 };
    for (const r of reports) c[r.status]++;
    return c;
  }, [reports]);
  const listed = reports.filter((r) => filter === "all" || r.status === filter);
  const current = reports.find((r) => r.prompt === picked) ?? listed[0] ?? reports[0];

  if (!reports.length) return <p className="muted">No prompts in this run.</p>;
  return (
    <div className="prompt-report">
      <div className="prompt-report-list">
        <div className="segmented" role="group" aria-label="Filter prompts" style={{ marginBottom: 10, flexWrap: "wrap" }}>
          <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All {reports.length}</button>
          {(["absent", "behind", "leading"] as const).map((s) =>
            counts[s] ? (
              <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)}>
                {PROMPT_STATUS[s].label} {counts[s]}
              </button>
            ) : null,
          )}
        </div>
        <div className="list-rows">
          {listed.map((r) => (
            <button
              key={r.prompt}
              className="list-row prompt-pick"
              aria-pressed={current?.prompt === r.prompt}
              onClick={() => setPicked(r.prompt)}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="prompt-pick-text">{r.prompt}</span>
                <span className="row" style={{ gap: 4, marginTop: 4 }}>
                  <StatusBadge status={r.status} />
                  {r.answered > 0 && <span className="muted small">{r.named}/{r.answered} engines{r.avgPosition != null ? ` · #${r.avgPosition}` : ""}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="prompt-report-detail">{current && <Detail key={current.prompt} r={current} you={brands[0].domain} ctx={ctx} onSimulate={onSimulate} tracked={tracked} onTrack={onTrack} />}</div>
    </div>
  );
}
