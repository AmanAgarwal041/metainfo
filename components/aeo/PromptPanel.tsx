"use client";

import { useMemo } from "react";
import { metricsFor, nameOf, OPPORTUNITY_KINDS, SOURCE_TYPES, type Brand, type SourceType } from "@/lib/aeo";
import type { RunAnswers } from "@/lib/aeo-actions";
import { PROMPT_STATUS, promptReport } from "@/lib/aeo-prompt";
import { AI_ENGINES } from "@/lib/research-types";
import { HBars, LineChart } from "../charts";
import { Kpi } from "../kit";
import { SentimentBadge, TypeBadge } from "./shared";

// The side panel on the Prompts tab: one prompt's visibility against competitors over time, each engine's answer,
// the channels its citations come from, and what to do, with a way into the full analysis.

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)"];
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const engine = (id: string) => AI_ENGINES.find((e) => e.id === id);
const PRIO = { high: "sev-critical", medium: "sev-high", low: "" };

export default function PromptPanel({
  prompt,
  runs,
  brands,
  brand,
  onClose,
  onFull,
  onCompare,
}: {
  prompt: string;
  /** Runs (already filtered), oldest first. */
  runs: RunAnswers[];
  brands: Brand[];
  brand: string;
  onClose: () => void;
  onFull: (prompt: string) => void;
  onCompare: (prompt: string) => void;
}) {
  const you = brands[0].domain;
  const mine = useMemo(() => runs.map((r) => ({ at: r.at, answers: r.answers.filter((a) => a.prompt === prompt) })).filter((r) => r.answers.length), [runs, prompt]);
  const latest = useMemo(() => mine.at(-1)?.answers ?? [], [mine]);
  const r = useMemo(() => promptReport(prompt, latest, brands, brand, mine.at(-2)?.answers ?? []), [prompt, latest, mine, brands, brand]);
  const channels = useMemo(() => {
    const c = new Map<SourceType, number>();
    for (const s of r.sources) c.set(s.type, (c.get(s.type) ?? 0) + s.engines.length);
    return [...c].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ label: SOURCE_TYPES[t].label, value: n }));
  }, [r.sources]);

  return (
    <aside className="drawer" role="dialog" aria-label={`Prompt: ${prompt}`}>
      <div className="drawer-top">
        <span className={`badge ${PROMPT_STATUS[r.status].cls}`}>{PROMPT_STATUS[r.status].label}</span>
        <TypeBadge type={r.type} />
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <h3 className="drawer-title">“{prompt}”</h3>
      <p className="small muted" style={{ margin: "0 0 12px" }}>{r.summary}</p>

      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 14 }}>
        <Kpi label="Visibility" value={r.answered ? `${Math.round((r.named / r.answered) * 100)}%` : "–"} foot={`${r.named} of ${r.answered} engines`} />
        <Kpi label="Avg position" value={r.avgPosition == null ? "–" : `#${r.avgPosition}`} foot="when named" />
        <Kpi label="Cited" value={`${r.cited}/${r.answered}`} foot="link to you" />
      </div>

      <h4 className="drawer-h">Visibility vs competitors{mine.length > 1 ? " over time" : ""}</h4>
      {mine.length > 1 ? (
        <LineChart
          ariaLabel={`Visibility per brand for “${prompt}”`}
          height={180}
          x={mine.map((x) => fmt(x.at))}
          yDomain={[0, 100]}
          format={(n) => `${n}%`}
          series={brands.slice(0, 7).map((b, i) => ({ id: b.domain, label: i === 0 ? `${b.name} (you)` : b.name, color: SERIES[i], values: mine.map((x) => { const k = metricsFor(x.answers, b.domain); return k.answered ? k.visibility : null; }) }))}
        />
      ) : (
        <>
          <HBars items={brands.map((b) => ({ label: b.domain === you ? `${b.name} (you)` : b.name, value: metricsFor(latest, b.domain).visibility })).sort((a, b) => b.value - a.value)} format={(n) => `${n}%`} />
          <p className="muted small" style={{ margin: "4px 0 0" }}>Share of engines naming each brand. Run again to see the trend.</p>
        </>
      )}

      <h4 className="drawer-h" style={{ marginTop: 16 }}>By engine</h4>
      <div className="list-rows">
        {r.engines.map((e) => (
          <div className="list-row" key={e.engine}>
            <span className="row small" style={{ gap: 6, width: 150, flexWrap: "nowrap" }}><span className="dot" style={{ background: engine(e.engine)?.color }} />{engine(e.engine)?.label}</span>
            <span className="row" style={{ gap: 4, flex: 1, flexWrap: "wrap" }}>
              {e.state === "no-answer" ? (
                <span className="na">no answer</span>
              ) : e.state === "absent" ? (
                <>
                  <span className="badge">not named</span>
                  {e.ahead.length > 0 && <span className="muted small">{e.ahead.slice(0, 2).map(nameOf).join(", ")} instead</span>}
                </>
              ) : (
                <>
                  <span className={`badge ${e.state === "cited" ? "gain" : "accent"}`}>{e.position ? `#${e.position} ` : ""}{e.state}</span>
                  <SentimentBadge s={e.sentiment} />
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      <h4 className="drawer-h" style={{ marginTop: 16 }}>Channels driving citations</h4>
      {channels.length ? <HBars items={channels} /> : <p className="muted small">The answers cite no sources.</p>}

      <h4 className="drawer-h" style={{ marginTop: 16 }}>Recommendations</h4>
      {r.plan.length ? (
        <div className="list-rows">
          {r.plan.slice(0, 3).map((o) => (
            <div className="list-row" key={o.id} style={{ alignItems: "flex-start" }}>
              <span className={`badge ${PRIO[o.priority]}`}>{OPPORTUNITY_KINDS[o.kind]}</span>
              <span className="small" style={{ flex: 1 }}>{o.title}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">Nothing to do for this prompt yet.</p>
      )}

      <div className="row" style={{ gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" onClick={() => onFull(prompt)}>View full prompt analysis</button>
        <button className="btn btn-sm" onClick={() => onCompare(prompt)}>Compare engines</button>
      </div>
    </aside>
  );
}
