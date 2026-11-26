"use client";

import { useEffect, useMemo, useState } from "react";
import { analyzeAnswer, classifyPrompt, FACTORS, nameOf, type Brand, type BrandResult, type Simulation } from "@/lib/aeo";
import type { Observation } from "@/lib/ai-visibility";
import type { Project } from "@/lib/project";
import { postResearch, research } from "@/lib/research-client";
import { AI_ENGINES, type AiAnswer, type AiEngine } from "@/lib/research-types";
import { setLocal } from "@/lib/store";
import { Kpi } from "../kit";
import { scoreColor } from "../ui";
import { ErrorBox } from "../research/common";
import { Highlight, Meter, SentimentBadge, TypeBadge } from "./shared";

// "Compare engines": one prompt, every engine at once, side by side. Live answers (DataForSEO) show where each
// engine ranks you against competitors; simulations (free) show how ready your page is for each engine's crawler.

interface EngineAnswer {
  engine: AiEngine;
  model: string;
  answered: boolean;
  error?: string;
  text: string;
  sources: { url: string; domain: string; title: string }[];
  brands: BrandResult[];
}

export interface Comparison {
  prompt: string;
  at: string;
  /** "run": taken from a tracking run; "live": asked from this tab. */
  from: "run" | "live";
  cost: number;
  answers: EngineAnswer[];
}

const KEY = (projectId: string) => `metainfo:aeo-compare:${projectId}`;
const MAX_SAVED = 20;
const engineOf = (e: AiEngine) => AI_ENGINES.find((x) => x.id === e);
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const host = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? u.hostname.replace(/^www\./, "") : `${u.hostname.replace(/^www\./, "")}${u.pathname}`;
  } catch {
    return url;
  }
};

function loadSaved(projectId: string): Comparison[] {
  try {
    const xs = JSON.parse(localStorage.getItem(KEY(projectId)) ?? "[]");
    return Array.isArray(xs) ? xs : [];
  } catch {
    return [];
  }
}

function save(projectId: string, c: Comparison): Comparison[] {
  const kept = [c, ...loadSaved(projectId).filter((x) => x.prompt !== c.prompt)].slice(0, MAX_SAVED);
  try {
    setLocal(KEY(projectId), JSON.stringify(kept));
  } catch {
    /* storage full: the comparison still shows */
  }
  return kept;
}

/** Brands an answer names, in the order it names them. */
const ranked = (a: EngineAnswer) => a.brands.filter((b) => b.mentioned && !b.subject).sort((x, y) => (x.position ?? 99) - (y.position ?? 99));

function fromRun(prompt: string, observations: Observation[], at: string): Comparison | null {
  const os = observations.filter((o) => o.prompt === prompt);
  if (!os.length) return null;
  return {
    prompt,
    at,
    from: "run",
    cost: 0,
    answers: os.map((o) => ({ engine: o.engine, model: o.model, answered: o.answered, error: o.error, text: o.excerpt, sources: o.sources, brands: o.brands ?? [] })),
  };
}

export default function EngineCompare({
  project,
  brand,
  brands,
  observations,
  runAt,
  live,
  judge,
  initial,
  onSimulation,
  onOpenSimulator,
}: {
  project: Project;
  brand: string;
  brands: Brand[];
  /** The latest run's answers (with brand results), so tracked prompts compare for free. */
  observations: Observation[];
  runAt: string | null;
  /** DataForSEO is configured: live answers can be asked. */
  live: boolean;
  /** Ask Claude to judge mentions and tone (one extra request per answer). */
  judge: boolean;
  initial: { prompt: string; nonce: number } | null;
  onSimulation: (s: Simulation) => void;
  onOpenSimulator: (prompt: string, engine: AiEngine) => void;
}) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? project.prompts[0] ?? "");
  const [engines, setEngines] = useState<Set<AiEngine>>(new Set(AI_ENGINES.map((e) => e.id)));
  const [saved, setSaved] = useState<Comparison[]>([]);
  const [busy, setBusy] = useState<null | "live" | "simulate">(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sims, setSims] = useState<{ prompt: string; rows: Partial<Record<AiEngine, Simulation | { error: string }>> } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- comparisons saved in this browser for the project
    setSaved(project.id ? loadSaved(project.id) : []);
  }, [project.id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opened from a prompt elsewhere on the page
    if (initial) setPrompt(initial.prompt);
  }, [initial]);

  const p = prompt.trim();
  const run = useMemo(() => (runAt ? fromRun(p, observations, runAt) : null), [p, observations, runAt]);
  const mine = saved.find((c) => c.prompt === p) ?? null;
  // The newest of: asked here, or the latest tracking run.
  const current = mine && (!run || mine.at > run.at) ? mine : run;
  const chosen = AI_ENGINES.filter((e) => engines.has(e.id));
  const you = brands[0].domain;
  const terms = [brand, project.domain, ...(project.aliases ?? []), ...brands.slice(1).map((b) => b.name)];
  const shownSims = sims && sims.prompt === p ? sims.rows : null;

  const ask = async () => {
    setConfirm(false);
    setError(null);
    setBusy("live");
    let cost = 0;
    let fatal: unknown = null;
    const answers = await Promise.all(
      chosen.map(async (e): Promise<EngineAnswer> => {
        try {
          const a = await research<AiAnswer>("ai", { engine: e.id, prompt: p, loc: project.location });
          cost += a.cost;
          let br = analyzeAnswer(a.text, a.sources, brands, p);
          if (judge && a.text) br = await postResearch<BrandResult[]>("/api/aeo/judge", { text: a.text, sources: a.sources, brands, prompt: p }).catch(() => br);
          return { engine: e.id, model: a.model, answered: a.answered, text: a.text.slice(0, 6000), sources: a.sources, brands: br };
        } catch (err) {
          const code = (err as { code?: unknown }).code;
          if (code === 40100 || code === 40210 || code === "token" || code === "not-configured") fatal = err;
          return { engine: e.id, model: "", answered: false, error: err instanceof Error ? err.message : String(err), text: "", sources: [], brands: [] };
        }
      }),
    );
    if (fatal) setError(fatal);
    if (answers.some((a) => !a.error)) setSaved(save(project.id, { prompt: p, at: new Date().toISOString(), from: "live", cost: Math.round(cost * 10000) / 10000, answers }));
    setBusy(null);
  };

  const simulate = async () => {
    setError(null);
    setBusy("simulate");
    const rows: Partial<Record<AiEngine, Simulation | { error: string }>> = {};
    await Promise.all(
      chosen.map(async (e) => {
        try {
          const cited = current?.answers.find((a) => a.engine === e.id)?.sources.map((s) => s.url) ?? [];
          const s = await postResearch<Simulation>("/api/aeo/simulate", { prompt: p, engine: e.id, domain: project.domain, brand, competitors: project.competitors, cited, explain: false });
          rows[e.id] = s;
          onSimulation(s);
        } catch (err) {
          rows[e.id] = { error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    setSims({ prompt: p, rows });
    setBusy(null);
  };

  const answers = current ? chosen.map((e) => current.answers.find((a) => a.engine === e.id)).filter((a): a is EngineAnswer => !!a) : [];
  const answered = answers.filter((a) => a.answered && !a.error);
  const named = answered.filter((a) => a.brands.find((b) => b.domain === you)?.mentioned);
  const positions = named.map((a) => a.brands.find((b) => b.domain === you)?.position).filter((x): x is number => x != null);
  const best = positions.length ? Math.min(...positions) : null;
  const avg = positions.length ? Math.round((positions.reduce((t, x) => t + x, 0) / positions.length) * 10) / 10 : null;
  const cited = answered.filter((a) => a.brands.find((b) => b.domain === you)?.cited).length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card card-pad">
        <h2 className="section-title">Compare engines</h2>
        <p className="section-sub">Ask one prompt on every engine at once and see, side by side, where each one ranks {brand || "you"} against your competitors and which pages it cites.</p>
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="pb-field" style={{ flex: 1, minWidth: 260 }}>
            <span>Prompt</span>
            <input className="input" list="compare-prompts" value={prompt} onChange={(e) => setPrompt(e.currentTarget.value)} placeholder="What is the best …?" />
            <datalist id="compare-prompts">{project.prompts.map((x) => <option key={x} value={x} />)}</datalist>
          </label>
          {live && (
            <button className="btn btn-primary" disabled={!p || !chosen.length || !project.domain || !!busy} onClick={() => setConfirm(true)}>
              {busy === "live" ? `Asking ${chosen.length} engines…` : current ? "Ask again" : `Ask ${chosen.length} engines`}
            </button>
          )}
          <button className={`btn ${live ? "" : "btn-primary"}`} disabled={!p || !chosen.length || !project.domain || !!busy} onClick={simulate} title="Free: reads your page and the cited pages as each engine's crawler does">
            {busy === "simulate" ? "Simulating…" : "Simulate on each engine"}
          </button>
        </div>
        <div className="row" style={{ flexWrap: "wrap", marginTop: 10 }}>
          {p && <TypeBadge type={classifyPrompt(p, brand)} />}
          {AI_ENGINES.map((e) => (
            <button
              key={e.id}
              className="chip"
              aria-pressed={engines.has(e.id)}
              onClick={() => {
                const n = new Set(engines);
                if (n.has(e.id)) n.delete(e.id);
                else n.add(e.id);
                setEngines(n);
              }}
            >
              <span className="dot" style={{ background: e.color }} /> {e.label}
            </button>
          ))}
        </div>
        {!project.domain && <p className="small" style={{ color: "var(--fail)", marginBottom: 0 }}>Set the project&apos;s domain in Setup first.</p>}
        {!live && <p className="muted small" style={{ marginBottom: 0 }}>Live answers need DataForSEO (Settings). Simulations are free and work now.</p>}
        {confirm && (
          <div className="card card-pad row" role="alertdialog" aria-label="Confirm comparison" style={{ marginTop: 12, background: "var(--surface-2)" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <b>Ask {chosen.length} engines this prompt?</b>
              <div className="muted small">{chosen.length} paid DataForSEO requests{judge ? ", plus one Claude request each to judge the answer" : ""}. Repeats within 12 hours are free.</div>
            </div>
            <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={ask}>Ask</button>
          </div>
        )}
        <ErrorBox error={error} onRetry={ask} />
      </section>

      {current && answers.length > 0 && (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            {current.from === "run" ? `From your tracking run on ${fmt(current.at)}.` : `Asked ${fmt(current.at)}${current.cost ? `, $${current.cost.toFixed(3)}` : ""}.`}
          </p>
          <div className="kpi-row">
            <Kpi label="Named by" value={`${named.length}/${answered.length}`} foot="engines that answered" />
            <Kpi label="Best rank" value={best == null ? "–" : `#${best}`} foot={best == null ? "not named" : engineOf(named.find((a) => a.brands.find((b) => b.domain === you)?.position === best)!.engine)?.label} />
            <Kpi label="Average rank" value={avg == null ? "–" : `#${avg}`} foot="where you're named" />
            <Kpi label="Cited by" value={`${cited}/${answered.length}`} foot="engines linking to your pages" />
          </div>

          <section className="card card-pad">
            <h3 className="section-title" style={{ fontSize: 15 }}>Ranking by engine</h3>
            <p className="section-sub">Where each engine names each brand: #1 is the first brand in the answer. Cited means it links to that brand&apos;s pages.</p>
            <div className="table-wrap">
              <table className="t compare-rank">
                <thead>
                  <tr>
                    <th>Brand</th>
                    {answers.map((a) => (
                      <th key={a.engine}><span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><span className="dot" style={{ background: engineOf(a.engine)?.color }} />{engineOf(a.engine)?.label}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {brands.map((b) => (
                    <tr key={b.domain} className={b.domain === you ? "is-mine" : undefined}>
                      <td><b>{b.name || nameOf(b.domain)}</b> {b.domain === you && <span className="badge accent">you</span>}</td>
                      {answers.map((a) => {
                        if (a.error) return <td key={a.engine}><span className="na" title={a.error}>error</span></td>;
                        if (!a.answered) return <td key={a.engine}><span className="na">no answer</span></td>;
                        const r = a.brands.find((x) => x.domain === b.domain);
                        if (!r?.mentioned) return <td key={a.engine}><span className="na">{r?.cited ? "cited only" : "–"}</span></td>;
                        return (
                          <td key={a.engine}>
                            <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                              <span className={`badge ${b.domain === you ? (r.position === 1 ? "gain" : "accent") : ""}`}>{r.subject ? "in prompt" : r.position ? `#${r.position}` : "named"}</span>
                              {r.cited && <span className="badge gain">cited</span>}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="compare-grid">
            {answers.map((a) => {
              const me = a.brands.find((b) => b.domain === you);
              const order = ranked(a);
              const ahead = me?.position ? order.filter((b) => b.position != null && b.position < me.position!) : [];
              const sim = shownSims?.[a.engine];
              return (
                <section className="card card-pad compare-col" key={a.engine}>
                  <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                    <span className="dot" style={{ background: engineOf(a.engine)?.color }} />
                    <b>{engineOf(a.engine)?.label}</b>
                    {a.model && <span className="muted small">{a.model}</span>}
                  </div>
                  {a.error ? (
                    <p className="small" style={{ color: "var(--fail)" }}>{a.error}</p>
                  ) : !a.answered ? (
                    <p className="muted small">No answer for this prompt.</p>
                  ) : (
                    <>
                      <div className="compare-rank-big">{me?.mentioned ? (me.position ? `#${me.position}` : "named") : "Not named"}</div>
                      <div className="row" style={{ gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                        {me?.cited && <span className="badge gain">cites your page</span>}
                        <SentimentBadge s={me?.sentiment ?? null} />
                      </div>
                      {me?.quote && <p className="small muted" style={{ margin: "0 0 8px" }}>“{me.quote}”</p>}
                      <div className="small" style={{ marginBottom: 8 }}>
                        <span className="muted">{me?.mentioned ? "Named ahead of you: " : "Named instead: "}</span>
                        {(me?.mentioned ? ahead : order).map((b) => nameOf(b.domain)).join(", ") || <span className="muted">nobody</span>}
                      </div>
                      {a.sources.length > 0 && (
                        <ul className="plain-list compare-sources">
                          {a.sources.slice(0, 6).map((s) => (
                            <li key={s.url} className={s.domain === you || s.domain.endsWith(`.${you}`) ? "is-mine" : ""}>
                              <a href={s.url} target="_blank" rel="noreferrer" className="small">{host(s.url)}</a>
                            </li>
                          ))}
                          {a.sources.length > 6 && <li className="muted small">+{a.sources.length - 6} more</li>}
                        </ul>
                      )}
                      {a.text && (
                        <details style={{ marginTop: 8 }}>
                          <summary className="small">Answer</summary>
                          <div className="answer" style={{ marginTop: 6 }}><Highlight text={a.text} terms={terms} /></div>
                        </details>
                      )}
                    </>
                  )}
                  {sim && <SimCell sim={sim} />}
                  <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => onOpenSimulator(p, a.engine)}>Open in Simulate agents</button>
                </section>
              );
            })}
          </div>
        </>
      )}

      {(!current || !answers.length) && shownSims && (
        <div className="compare-grid">
          {chosen.map((e) => (
            <section className="card card-pad compare-col" key={e.id}>
              <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                <span className="dot" style={{ background: e.color }} />
                <b>{e.label}</b>
              </div>
              {shownSims[e.id] ? <SimCell sim={shownSims[e.id]!} /> : <p className="muted small">Not simulated.</p>}
              <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => onOpenSimulator(p, e.id)}>Open in Simulate agents</button>
            </section>
          ))}
        </div>
      )}

      {!current && !shownSims && p && (
        <p className="muted small">
          {live ? "Not asked yet. " : ""}
          {live ? "Ask the engines for live answers, or simulate for free to see how ready your page is for each engine's crawler." : "Simulate to see how ready your page is for each engine's crawler."}
        </p>
      )}

      {saved.length > 0 && (
        <section className="card card-pad">
          <h3 className="section-title" style={{ fontSize: 15 }}>Recent comparisons</h3>
          <div className="list-rows">
            {saved.map((c) => {
              const ok = c.answers.filter((a) => a.answered && !a.error);
              const n = ok.filter((a) => a.brands.find((b) => b.domain === you)?.mentioned).length;
              return (
                <button key={c.prompt} className="list-row prompt-pick" aria-pressed={c.prompt === p} onClick={() => setPrompt(c.prompt)}>
                  <span style={{ flex: 1, minWidth: 0 }} className="small">{c.prompt}</span>
                  <span className="muted small">named by {n}/{ok.length} · {fmt(c.at)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function SimCell({ sim }: { sim: Simulation | { error: string } }) {
  if ("error" in sim) return <p className="small" style={{ color: "var(--fail)" }}>{sim.error}</p>;
  const best = sim.cited.length ? Math.max(...sim.cited.map((c) => c.total)) : null;
  const gap = [...sim.gaps].sort((a, b) => b.them - b.you - (a.them - a.you))[0];
  return (
    <div className="compare-sim">
      <div className="small muted" style={{ marginBottom: 4 }}>Page readiness (simulated)</div>
      {sim.you ? (
        <>
          <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <Meter value={sim.you.total} color={scoreColor(sim.you.total)} />
            <b className="mono small">{sim.you.total}</b>
          </span>
          <a href={sim.you.url} target="_blank" rel="noreferrer" className="small" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{host(sim.you.url)}</a>
        </>
      ) : (
        <span className="badge sev-critical">no page answers this</span>
      )}
      <div className="small" style={{ marginTop: 4 }}>
        {best != null && <span className="muted">Best cited page: {best}. </span>}
        {gap ? <span>{best != null ? "Biggest gap" : "Weakest area"}: {FACTORS[gap.factor].label.toLowerCase()}</span> : sim.you && best != null ? <span className="muted">No gap against cited pages.</span> : null}
      </div>
      {sim.you?.blockedByRobots && <p className="small" style={{ color: "var(--fail)", margin: "4px 0 0" }}>Blocked by robots.txt for {sim.agent.crawler}.</p>}
    </div>
  );
}
