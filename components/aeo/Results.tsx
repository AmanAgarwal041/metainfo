"use client";

import { Fragment, useMemo, useState } from "react";
import {
  citationTable,
  classifyPrompt,
  nameOf,
  PROMPT_TYPES,
  SOURCE_TYPES,
  STAGES,
  type Answer,
  type Brand,
  type SourceType,
  type Stage,
} from "@/lib/aeo";
import type { Observation } from "@/lib/ai-visibility";
import { AI_ENGINES, type AiEngine } from "@/lib/research-types";
import { Delta } from "../kit";
import { promptRows, visTone } from "@/lib/aeo-insights";
import { Meter, Section, SentimentBadge, TypeBadge } from "./shared";

const engineLabel = (e: AiEngine) => AI_ENGINES.find((x) => x.id === e)?.label ?? e;
const NONE: Answer[] = [];
const fmtPos = (p: number | null) => (p == null ? "–" : `#${p}`);

// -------------------------------------------------------------- prompts

export function PromptTable({
  observations,
  brand,
  brands,
  onOpen,
  onReport,
  previous = NONE,
}: {
  observations: Observation[];
  brand: string;
  brands: Brand[];
  /** The previous run's answers, for the change column. */
  previous?: Answer[];
  onOpen: (o: Observation) => void;
  /** Open the prompt's report: every engine side by side, and what to do. */
  onReport?: (prompt: string) => void;
}) {
  const [stage, setStage] = useState<Stage | "all">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"order" | "low" | "high" | "change">("order");
  const engines = AI_ENGINES.filter((e) => observations.some((o) => o.engine === e.id));
  const stats = useMemo(() => new Map(promptRows(observations, previous, brands, brand).map((r) => [r.prompt, r])), [observations, previous, brands, brand]);
  const needle = q.trim().toLowerCase();
  const prompts = [...new Set(observations.map((o) => o.prompt))]
    .filter((p) => stage === "all" || PROMPT_TYPES[classifyPrompt(p, brand)].stage === stage)
    .filter((p) => !needle || p.toLowerCase().includes(needle))
    .sort((a, b) => {
      const x = stats.get(a)!;
      const y = stats.get(b)!;
      if (sort === "low") return x.visibility - y.visibility;
      if (sort === "high") return y.visibility - x.visibility;
      if (sort === "change") return (y.change ?? -999) - (x.change ?? -999);
      return 0;
    });
  const you = brands[0].domain;

  return (
    <>
      <div className="row" style={{ marginBottom: 12, gap: 10 }}>
        <input className="input search-input" type="search" style={{ flex: 1, minWidth: 200, margin: 0 }} placeholder="Search prompts" aria-label="Search prompts" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <div className="segmented" role="group" aria-label="Stage">
          {(["all", "awareness", "consideration", "decision"] as const).map((s) => (
            <button key={s} aria-pressed={stage === s} onClick={() => setStage(s)}>
              {s === "all" ? "All stages" : STAGES[s]}
            </button>
          ))}
        </div>
        <select className="select" aria-label="Sort prompts" value={sort} onChange={(e) => setSort(e.currentTarget.value as typeof sort)}>
          <option value="order">Your order</option>
          <option value="low">Lowest visibility first</option>
          <option value="high">Highest visibility first</option>
          <option value="change">Biggest gain first</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Prompt</th>
              <th style={{ textAlign: "right" }}>Visibility</th>
              <th style={{ textAlign: "right" }} title="Points vs the previous run">Change</th>
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
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <span className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <span className="dot" style={{ background: visTone(stats.get(p)!.visibility) }} />
                    <b className="mono small">{stats.get(p)!.visibility}%</b>
                  </span>
                </td>
                <td style={{ textAlign: "right" }} className="small">{stats.get(p)!.change == null ? <span className="muted">new</span> : <Delta value={stats.get(p)!.change!} suffix=" pts" />}</td>
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

export { engineLabel, Section };
