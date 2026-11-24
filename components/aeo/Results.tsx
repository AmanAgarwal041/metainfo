"use client";

import { Fragment, useMemo, useState } from "react";
import {
  citationTable,
  classifyPrompt,
  metricsFor,
  nameOf,
  OPPORTUNITY_KINDS,
  opportunities,
  PROMPT_TYPES,
  SOURCE_TYPES,
  STAGES,
  type Answer,
  type Brand,
  type PromptType,
  type SourceType,
  type Stage,
} from "@/lib/aeo";
import type { Observation } from "@/lib/ai-visibility";
import { fromOpportunity, type PromptContext } from "@/lib/fix-prompts";
import { CollatedPrompt, FixPromptButton, PickBox, useFixPicker } from "../FixPrompt";
import { AI_ENGINES, type AiEngine } from "@/lib/research-types";
import { Kpi } from "../kit";
import { Meter, Section, SentimentBadge, TypeBadge } from "./shared";

const engineLabel = (e: AiEngine) => AI_ENGINES.find((x) => x.id === e)?.label ?? e;
const fmtPos = (p: number | null) => (p == null ? "–" : `#${p}`);

// ------------------------------------------------------------- overview

export function Overview({ answers, brands, brand }: { answers: Answer[]; brands: Brand[]; brand: string }) {
  const you = brands[0].domain;
  const m = metricsFor(answers, you);
  const engines = AI_ENGINES.filter((e) => answers.some((a) => a.engine === e.id));
  const types = useMemo(() => {
    const by = new Map<PromptType, Answer[]>();
    for (const a of answers) {
      const t = classifyPrompt(a.prompt, brand);
      by.set(t, [...(by.get(t) ?? []), a]);
    }
    return [...by].map(([t, xs]) => ({ t, m: metricsFor(xs, you) })).sort((a, b) => Object.keys(PROMPT_TYPES).indexOf(a.t) - Object.keys(PROMPT_TYPES).indexOf(b.t));
  }, [answers, brand, you]);
  const landscape = brands.map((b) => ({ b, m: metricsFor(answers, b.domain) })).sort((a, b) => b.m.shareOfVoice - a.m.shareOfVoice);

  return (
    <>
      <div className="kpi-row">
        <Kpi label="Visibility" value={`${m.visibility}%`} foot={`of ${m.answered} answers mention you`} />
        <Kpi label="Share of voice" value={`${m.shareOfVoice}%`} foot="of all brand mentions" />
        <Kpi label="Average position" value={m.avgPosition == null ? "–" : `#${m.avgPosition}`} foot="among brands named, when you're named" />
        <Kpi label="Sentiment" value={m.sentiment == null ? "–" : m.sentiment} foot={`${m.sentiments.positive} positive · ${m.sentiments.mixed} mixed · ${m.sentiments.negative} negative`} tone={m.sentiment != null && m.sentiment < 50 ? "var(--warn)" : undefined} />
      </div>

      <div className="bento">
        <section className="card card-pad b-7">
          <h2 className="section-title">Competitive landscape</h2>
          <p className="section-sub">Share of voice: each brand&apos;s share of all brand mentions across the answers.</p>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th style={{ width: "34%" }}>Share of voice</th>
                  <th style={{ textAlign: "right" }}>Visibility</th>
                  <th style={{ textAlign: "right" }}>Cited</th>
                  <th style={{ textAlign: "right" }}>Position</th>
                  <th style={{ textAlign: "right" }}>Sentiment</th>
                </tr>
              </thead>
              <tbody>
                {landscape.map(({ b, m: x }) => (
                  <tr key={b.domain}>
                    <td>
                      <b>{b.name}</b> {b.domain === you && <span className="badge accent">you</span>}
                      <div className="muted small">{b.domain}</div>
                    </td>
                    <td style={{ verticalAlign: "middle" }}>
                      <div className="row" style={{ gap: 8 }}>
                        <Meter value={x.shareOfVoice} color={b.domain === you ? "var(--accent)" : "var(--text-3)"} />
                        <span className="small mono">{x.shareOfVoice}%</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>{x.visibility}%</td>
                    <td style={{ textAlign: "right" }}>{x.citationRate}%</td>
                    <td style={{ textAlign: "right" }}>{x.avgPosition == null ? "–" : `#${x.avgPosition}`}</td>
                    <td style={{ textAlign: "right" }}>{x.sentiment ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {brands.length === 1 && <p className="muted small">Add competitors to the project to compare.</p>}
        </section>

        <section className="card card-pad b-5">
          <h2 className="section-title">By engine</h2>
          <div className="list-rows">
            {engines.map((e) => {
              const x = metricsFor(answers.filter((a) => a.engine === e.id), you);
              return (
                <div className="list-row" key={e.id}>
                  <span className="row" style={{ gap: 6, width: 150 }}><span className="dot" style={{ background: e.color }} />{e.label}</span>
                  <Meter value={x.visibility} color={e.color} />
                  <span className="mono small" style={{ width: 40, textAlign: "right" }}>{x.visibility}%</span>
                  <span className="muted small" style={{ width: 40, textAlign: "right" }}>{x.avgPosition == null ? "" : `#${x.avgPosition}`}</span>
                </div>
              );
            })}
          </div>
          <h2 className="section-title" style={{ marginTop: 18 }}>By prompt type</h2>
          <div className="list-rows">
            {types.map(({ t, m: x }) => (
              <div className="list-row" key={t}>
                <span style={{ width: 150 }}>
                  {PROMPT_TYPES[t].label} <span className="muted small">{STAGES[PROMPT_TYPES[t].stage]}</span>
                </span>
                <Meter value={x.visibility} />
                <span className="mono small" style={{ width: 40, textAlign: "right" }}>{x.visibility}%</span>
                <span className="muted small" style={{ width: 40, textAlign: "right" }}>{x.answered}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

// -------------------------------------------------------------- prompts

export function PromptTable({
  observations,
  brand,
  brands,
  onOpen,
  onReport,
}: {
  observations: Observation[];
  brand: string;
  brands: Brand[];
  onOpen: (o: Observation) => void;
  /** Open the prompt's report: every engine side by side, and what to do. */
  onReport?: (prompt: string) => void;
}) {
  const [stage, setStage] = useState<Stage | "all">("all");
  const engines = AI_ENGINES.filter((e) => observations.some((o) => o.engine === e.id));
  const prompts = [...new Set(observations.map((o) => o.prompt))].filter((p) => stage === "all" || PROMPT_TYPES[classifyPrompt(p, brand)].stage === stage);
  const you = brands[0].domain;

  return (
    <>
      <div className="segmented" role="group" aria-label="Stage" style={{ marginBottom: 12 }}>
        {(["all", "awareness", "consideration", "decision"] as const).map((s) => (
          <button key={s} aria-pressed={stage === s} onClick={() => setStage(s)}>
            {s === "all" ? "All stages" : STAGES[s]}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Prompt</th>
              {engines.map((e) => (
                <th key={e.id}>
                  <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: e.color }} />{e.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {prompts.map((p) => (
              <tr key={p}>
                <td style={{ maxWidth: 320 }}>
                  {p}
                  <div className="row" style={{ marginTop: 4, gap: 8 }}>
                    <TypeBadge type={classifyPrompt(p, brand)} />
                    {onReport && (
                      <button className="link-btn small" onClick={() => onReport(p)}>
                        Compare and improve
                      </button>
                    )}
                  </div>
                </td>
                {engines.map((e) => {
                  const o = observations.find((x) => x.prompt === p && x.engine === e.id);
                  const me = o?.brands?.find((b) => b.domain === you);
                  const leader = o?.brands?.filter((b) => b.mentioned).sort((a, b) => (a.position ?? 99) - (b.position ?? 99))[0];
                  return (
                    <td key={e.id}>
                      {!o ? (
                        <span className="na">.</span>
                      ) : o.error ? (
                        <span className="na" title={o.error}>error</span>
                      ) : !o.answered ? (
                        <span className="na">no answer</span>
                      ) : (
                        <button className="btn-ghost" style={{ border: 0, background: "none", padding: 0, cursor: "pointer", textAlign: "left" }} onClick={() => onOpen(o)} aria-label={`View ${e.label} answer`}>
                          {me?.mentioned || o.you.mentioned ? (
                            <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                              <span className={`badge ${me?.cited || o.you.cited ? "gain" : "accent"}`}>{fmtPos(me?.position ?? null)} {me?.cited || o.you.cited ? "cited" : "named"}</span>
                              <SentimentBadge s={me?.sentiment ?? null} />
                            </span>
                          ) : (
                            <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                              <span className="badge">absent</span>
                              {leader && <span className="muted small">{nameOf(leader.domain)} #{leader.position}</span>}
                            </span>
                          )}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------ citations

export function Citations({ answers, brands }: { answers: Answer[]; brands: Brand[] }) {
  const you = brands[0].domain;
  const comps = brands.slice(1).map((b) => b.domain);
  const rows = citationTable(answers, you, comps, brands);
  const [type, setType] = useState<SourceType | "all">("all");
  const totals = new Map<SourceType, number>();
  for (const r of rows) totals.set(r.type, (totals.get(r.type) ?? 0) + r.answers);
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  const yourPages = rows.filter((r) => r.type === "you").flatMap((r) => r.urls);

  return (
    <>
      <div className="list-rows" style={{ marginBottom: 14 }}>
        {[...totals].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
          <button key={t} className="list-row" style={{ border: 0, background: type === t ? "var(--surface-2)" : "none", cursor: "pointer", textAlign: "left", width: "100%" }} onClick={() => setType(type === t ? "all" : t)}>
            <span style={{ width: 170 }}>{SOURCE_TYPES[t].label}</span>
            <Meter value={(n / sum) * 100} color={t === "you" ? "var(--accent)" : t === "competitor" ? "var(--fail)" : "var(--text-3)"} />
            <span className="mono small" style={{ width: 48, textAlign: "right" }}>{Math.round((n / sum) * 100)}%</span>
            <span className="muted small" style={{ flex: 2 }}>{SOURCE_TYPES[t].play}</span>
          </button>
        ))}
      </div>
      {yourPages.length > 0 && type === "all" && (
        <p className="small" style={{ marginBottom: 12 }}>
          <b>Your cited pages:</b>{" "}
          {yourPages.slice(0, 6).map((u, i) => (
            <Fragment key={u.url}>
              {i > 0 && ", "}
              <a href={u.url} target="_blank" rel="noreferrer">{new URL(u.url).pathname || "/"}</a> ({u.count})
            </Fragment>
          ))}
        </p>
      )}
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Type</th>
              <th style={{ textAlign: "right" }}>Answers</th>
              <th>Brands named alongside</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => type === "all" || r.type === type)
              .slice(0, 40)
              .map((r) => (
                <tr key={r.domain}>
                  <td>
                    <b>{r.domain}</b>
                    <div className="muted small" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.urls[0] && <a href={r.urls[0].url} target="_blank" rel="noreferrer">{r.urls[0].title || r.urls[0].url}</a>}
                    </div>
                  </td>
                  <td><span className={`badge ${r.type === "you" ? "accent" : ""}`}>{SOURCE_TYPES[r.type].label}</span></td>
                  <td style={{ textAlign: "right" }} className="mono">{r.answers}</td>
                  <td className="small">
                    {Object.entries(r.withBrands)
                      .sort((a, b) => b[1] - a[1])
                      .map(([d, n]) => `${d === you ? "you" : nameOf(d)} ${n}`)
                      .join(" · ") || <span className="muted">none</span>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// -------------------------------------------------------- opportunities

export function Opportunities({
  answers,
  brands,
  brand,
  domain,
  onSimulate,
}: {
  answers: Answer[];
  brands: Brand[];
  brand: string;
  domain: string;
  onSimulate: (prompt: string) => void;
}) {
  const list = useMemo(() => opportunities(answers, brands, brand), [answers, brands, brand]);
  const fixes = useMemo(() => list.map(fromOpportunity), [list]);
  const ctx = useMemo<PromptContext>(() => ({ site: domain ? `https://${domain}` : brand, source: `AI visibility run (brand: ${brand})` }), [domain, brand]);
  const picker = useFixPicker();
  if (!list.length) return <p className="muted">No gaps found in this run: you&apos;re named wherever a competitor is. Add more prompts, especially best-of and alternatives prompts.</p>;
  const cls = { high: "s-fail", medium: "s-warn", low: "s-info" };
  return (
    <div>
      <CollatedPrompt fixes={fixes} ctx={ctx} picker={picker} />
      {list.map((o, k) => (
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
            {o.prompts.length > 0 && (
              <div className="list-rows" style={{ marginTop: 10 }}>
                {o.prompts.map((p) => (
                  <div className="list-row" key={p}>
                    <span style={{ flex: 1 }}>{p}</span>
                    <button className="btn btn-sm" onClick={() => onSimulate(p)}>Simulate agents</button>
                  </div>
                ))}
              </div>
            )}
            {o.targets.length > 0 && (
              <ul className="plain-list" style={{ marginTop: 10 }}>
                {o.targets.map((t, i) => (
                  <li key={`${i}:${t.url ?? t.label}`}>{t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.label}</a> : <span className="small">{t.label}</span>}</li>
                ))}
              </ul>
            )}
            <FixPromptButton fix={fixes[k]} ctx={ctx} />
          </div>
        </details>
      ))}
    </div>
  );
}

export { engineLabel, Section };
