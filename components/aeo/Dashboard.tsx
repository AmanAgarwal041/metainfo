"use client";

import { useMemo, useState } from "react";
import { citationTable, classifyPrompt, nameOf, PROMPT_TYPES, SOURCE_TYPES, STAGES, type Answer, type Brand, type PromptType, type Sentiment } from "@/lib/aeo";
import type { RunAnswers } from "@/lib/aeo-actions";
import { metricsFor, urlTable } from "@/lib/aeo-insights";
import { AI_ENGINES } from "@/lib/research-types";
import { Distribution, Gauge, HBars, LineChart } from "../charts";
import { Delta, Kpi } from "../kit";
import { Meter, SentimentBadge } from "./shared";
import { ChannelBadge, ContentBadge, DomainCell, DomainMark, EngineDots, GroupHead, Pager, SearchBox, Tile, useSearchPage } from "./tables";

// Dashboard: the headline numbers (visibility gauge, trend per engine), sentiment, the competitor landscape and
// which sites and pages the engines cite, laid out like an AEO dashboard: one question per tile.

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)"];
const SENT_COLOR: Record<Sentiment, string> = { positive: "var(--pass)", neutral: "var(--text-3)", mixed: "var(--warn)", negative: "var(--fail)" };
const SENT_BANDS = [
  { to: 40, color: "var(--fail)" },
  { to: 60, color: "var(--warn)" },
  { to: 100, color: "var(--pass)" },
];

export default function Dashboard({ runs, brands, brand }: { runs: RunAnswers[]; brands: Brand[]; brand: string }) {
  const [view, setView] = useState<"visibility" | "sentiment">("visibility");
  const you = brands[0].domain;
  const answers = runs.at(-1)!.answers;
  const prev = runs.at(-2)?.answers;
  const x = runs.map((r) => fmt(r.at));
  const m = metricsFor(answers, you);
  const p = prev ? metricsFor(prev, you) : null;
  const engines = AI_ENGINES.filter((e) => answers.some((a) => a.engine === e.id && a.answered));
  const prompts = new Set(answers.map((a) => a.prompt)).size;
  const trend = runs.length > 1;

  const engineSeries = (f: (xs: Answer[]) => number | null) => engines.map((e) => ({ id: e.id, label: e.label, color: e.color, values: runs.map((r) => f(r.answers.filter((a) => a.engine === e.id))) }));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 10 }}>
        <div className="segmented" role="group" aria-label="Dashboard view">
          <button aria-pressed={view === "visibility"} onClick={() => setView("visibility")}>Brand visibility</button>
          <button aria-pressed={view === "sentiment"} onClick={() => setView("sentiment")}>Sentiment analysis</button>
        </div>
        <span className="muted small">{engines.length} engines · {prompts} prompts · {runs.length} {runs.length === 1 ? "run" : "runs"}</span>
      </div>

      <div className="kpi-row">
        <Kpi label="Visibility" value={`${m.visibility}%`} foot={p ? <>vs last run <Delta value={m.visibility - p.visibility} suffix=" pts" /></> : `of ${m.answered} answers name you`} />
        <Kpi label="Share of voice" value={`${m.shareOfVoice}%`} foot={p ? <>vs last run <Delta value={m.shareOfVoice - p.shareOfVoice} suffix=" pts" /></> : "of all brand mentions"} />
        <Kpi label="Citation rate" value={`${m.citationRate}%`} foot={p ? <>vs last run <Delta value={m.citationRate - p.citationRate} suffix=" pts" /></> : "answers citing your pages"} />
        <Kpi
          label="Average position"
          value={m.avgPosition == null ? "–" : `#${m.avgPosition}`}
          foot={p && m.avgPosition != null && p.avgPosition != null ? <>vs last run <Delta value={Math.round((p.avgPosition - m.avgPosition) * 10) / 10} /></> : "when you're named"}
        />
      </div>

      {view === "visibility" ? (
        <div className="bento">
          <Tile className="b-5" title="Brand visibility" sub={`Share of AI answers that name ${brand}.`}>
            <Gauge value={m.visibility} label="Brand visibility" sub={`of AI answers mention ${brand}`} />
            <div className="row small muted" style={{ justifyContent: "center", gap: 8 }}>
              <span>{engines.length} engines · {prompts} tracked prompts</span>
              {p && <Delta value={m.visibility - p.visibility} suffix=" pts" />}
            </div>
          </Tile>
          <Tile className="b-7" title={trend ? "Brand visibility over time" : "Brand visibility by engine"} sub={trend ? "Per engine, each run." : "Run the check again to see the trend."}>
            {trend ? (
              <LineChart ariaLabel="Visibility per engine per run" x={x} yDomain={[0, 100]} format={(n) => `${n}%`} series={engineSeries((xs) => { const k = metricsFor(xs, you); return k.answered ? k.visibility : null; })} />
            ) : (
              <EngineBars answers={answers} you={you} metric="visibility" />
            )}
          </Tile>
        </div>
      ) : (
        <Sentiment runs={runs} you={you} brand={brand} x={x} engineSeries={engineSeries} />
      )}

      <GroupHead title="Competitor landscape" sub="How you compare with the competitors in this project." />
      <div className="bento">
        <Tile className="b-6" title="Share of voice" sub="Each brand's share of all brand mentions in the latest run.">
          <ShareOfVoice answers={answers} previous={prev} brands={brands} />
        </Tile>
        <Tile className="b-6" title="Competitor visibility" sub={trend ? "Share of answers naming each brand, per run." : "Share of answers naming each brand."}>
          {brands.length === 1 ? (
            <p className="muted small">Add competitors to the project to compare.</p>
          ) : trend ? (
            <LineChart
              ariaLabel="Visibility per brand per run"
              x={x}
              yDomain={[0, 100]}
              format={(n) => `${n}%`}
              series={brands.slice(0, 7).map((b, i) => ({ id: b.domain, label: i === 0 ? `${b.name} (you)` : b.name, color: SERIES[i], values: runs.map((r) => { const k = metricsFor(r.answers, b.domain); return k.answered ? k.visibility : null; }) }))}
            />
          ) : (
            <HBars items={brands.map((b) => ({ label: b.domain === you ? `${b.name} (you)` : b.name, value: metricsFor(answers, b.domain).visibility })).sort((a, b) => b.value - a.value)} format={(n) => `${n}%`} />
          )}
        </Tile>
        <Tile className="b-6" title="By engine" sub="Visibility and average position per engine.">
          <EngineBars answers={answers} you={you} metric="visibility" withPosition />
        </Tile>
        <Tile className="b-6" title="By prompt type" sub="Visibility per kind of question, by buying stage.">
          <PromptTypes answers={answers} you={you} brand={brand} />
        </Tile>
      </div>

      <GroupHead title="Citation analysis" sub="The sites and pages engines reference when they answer. Get onto the ones that cite competitors but not you." />
      <TopDomains answers={answers} brands={brands} />
      <TopUrls answers={answers} brands={brands} />
    </div>
  );
}

function EngineBars({ answers, you, metric, withPosition }: { answers: Answer[]; you: string; metric: "visibility" | "citationRate"; withPosition?: boolean }) {
  const engines = AI_ENGINES.filter((e) => answers.some((a) => a.engine === e.id && a.answered));
  return (
    <div className="list-rows">
      {engines.map((e) => {
        const k = metricsFor(answers.filter((a) => a.engine === e.id), you);
        return (
          <div className="list-row" key={e.id}>
            <span className="row" style={{ gap: 6, width: 150 }}><span className="dot" style={{ background: e.color }} />{e.label}</span>
            <Meter value={k[metric]} color={e.color} />
            <span className="mono small" style={{ width: 40, textAlign: "right" }}>{k[metric]}%</span>
            {withPosition && <span className="muted small" style={{ width: 40, textAlign: "right" }}>{k.avgPosition == null ? "" : `#${k.avgPosition}`}</span>}
          </div>
        );
      })}
    </div>
  );
}

function PromptTypes({ answers, you, brand }: { answers: Answer[]; you: string; brand: string }) {
  const types = useMemo(() => {
    const by = new Map<PromptType, Answer[]>();
    for (const a of answers) {
      const t = classifyPrompt(a.prompt, brand);
      by.set(t, [...(by.get(t) ?? []), a]);
    }
    return [...by].map(([t, xs]) => ({ t, m: metricsFor(xs, you) })).sort((a, b) => Object.keys(PROMPT_TYPES).indexOf(a.t) - Object.keys(PROMPT_TYPES).indexOf(b.t));
  }, [answers, brand, you]);
  return (
    <div className="list-rows">
      {types.map(({ t, m }) => (
        <div className="list-row" key={t}>
          <span style={{ width: 150 }}>
            {PROMPT_TYPES[t].label} <span className="muted small">{STAGES[PROMPT_TYPES[t].stage]}</span>
          </span>
          <Meter value={m.visibility} />
          <span className="mono small" style={{ width: 40, textAlign: "right" }}>{m.visibility}%</span>
          <span className="muted small" style={{ width: 70, textAlign: "right" }}>{m.answered} answers</span>
        </div>
      ))}
    </div>
  );
}

function ShareOfVoice({ answers, previous, brands }: { answers: Answer[]; previous?: Answer[]; brands: Brand[] }) {
  const you = brands[0].domain;
  const rows = brands.map((b) => ({ b, m: metricsFor(answers, b.domain), p: previous ? metricsFor(previous, b.domain) : null })).sort((a, b) => b.m.shareOfVoice - a.m.shareOfVoice);
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th>Company</th>
            <th style={{ width: "36%" }}>Share of voice</th>
            <th style={{ textAlign: "right" }}>Visibility</th>
            <th style={{ textAlign: "right" }}>Position</th>
            <th style={{ textAlign: "right" }}>Sentiment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ b, m, p }) => (
            <tr key={b.domain} className={b.domain === you ? "row-you" : ""}>
              <td>
                <span className="domain-cell">
                  <DomainMark domain={b.domain} />
                  <span>
                    <b>{b.name}</b> {b.domain === you && <span className="badge accent">you</span>}
                  </span>
                </span>
              </td>
              <td style={{ verticalAlign: "middle" }}>
                <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                  <Meter value={m.shareOfVoice} color={b.domain === you ? "var(--accent)" : "var(--text-3)"} />
                  <span className="small mono">{m.shareOfVoice}%</span>
                  {p && p.answered > 0 && <span className="small"><Delta value={m.shareOfVoice - p.shareOfVoice} /></span>}
                </div>
              </td>
              <td style={{ textAlign: "right" }}>{m.visibility}%</td>
              <td style={{ textAlign: "right" }}>{m.avgPosition == null ? "–" : `#${m.avgPosition}`}</td>
              <td style={{ textAlign: "right" }}>{m.sentiment ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Sentiment({
  runs,
  you,
  brand,
  x,
  engineSeries,
}: {
  runs: RunAnswers[];
  you: string;
  brand: string;
  x: string[];
  engineSeries: (f: (xs: Answer[]) => number | null) => { id: string; label: string; color: string; values: (number | null)[] }[];
}) {
  const answers = runs.at(-1)!.answers;
  const m = metricsFor(answers, you);
  const quotes = answers
    .flatMap((a) => {
      const me = a.brands?.find((b) => b.domain === you && b.mentioned && b.quote);
      return me ? [{ a, me }] : [];
    })
    .sort((p, q) => ({ negative: 0, mixed: 1, neutral: 2, positive: 3 })[p.me.sentiment ?? "neutral"] - ({ negative: 0, mixed: 1, neutral: 2, positive: 3 })[q.me.sentiment ?? "neutral"]);
  const [all, setAll] = useState(false);
  return (
    <>
      <div className="bento">
        <Tile className="b-5" title="Sentiment score" sub={`How answers describe ${brand}: 100 positive, 50 neutral or mixed, 0 negative.`}>
          <Gauge value={m.sentiment} label="Sentiment score" sub="average over answers that name you" format={(n) => String(n)} bands={SENT_BANDS} />
          <Distribution
            ariaLabel="Mentions by sentiment"
            parts={(["positive", "neutral", "mixed", "negative"] as Sentiment[]).map((s) => ({ label: s[0].toUpperCase() + s.slice(1), value: m.sentiments[s], color: SENT_COLOR[s] }))}
          />
        </Tile>
        <Tile className="b-7" title={runs.length > 1 ? "Sentiment over time" : "Sentiment by engine"} sub={runs.length > 1 ? "Per engine, each run." : "Run the check again to see the trend."}>
          {runs.length > 1 ? (
            <LineChart ariaLabel="Sentiment per engine per run" x={x} yDomain={[0, 100]} series={engineSeries((xs) => metricsFor(xs, you).sentiment)} />
          ) : (
            <HBars items={AI_ENGINES.map((e) => ({ label: e.label, value: metricsFor(answers.filter((a) => a.engine === e.id), you).sentiment ?? -1 })).filter((i) => i.value >= 0)} />
          )}
        </Tile>
      </div>
      <Tile title="What answers say about you" sub="The sentence naming you in each answer, least favourable first. Fix wrong facts at the source the answer cites.">
        {quotes.length ? (
          <>
            <div className="list-rows">
              {(all ? quotes : quotes.slice(0, 6)).map(({ a, me }) => (
                <div className="list-row" key={`${a.engine}|${a.prompt}`} style={{ alignItems: "flex-start" }}>
                  <span style={{ width: 90 }}><SentimentBadge s={me.sentiment} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small">“{me.quote}”</div>
                    <div className="muted small">{AI_ENGINES.find((e) => e.id === a.engine)?.label} · {a.prompt}</div>
                  </div>
                </div>
              ))}
            </div>
            {quotes.length > 6 && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${quotes.length}`}</button>}
          </>
        ) : (
          <p className="muted small">No answer names you yet.</p>
        )}
      </Tile>
    </>
  );
}

export function TopDomains({ answers, brands, title = "Top domains" }: { answers: Answer[]; brands: Brand[]; title?: string }) {
  const you = brands[0].domain;
  const rows = useMemo(() => citationTable(answers, you, brands.slice(1).map((b) => b.domain), brands), [answers, you, brands]);
  const total = rows.reduce((s, r) => s + r.answers, 0);
  const t = useSearchPage(rows, (r) => `${r.domain} ${SOURCE_TYPES[r.type].label}`, 8);
  return (
    <Tile title={title} sub="Sites most often referenced in the answers, with the brands named alongside.">
      <SearchBox value={t.q} onChange={t.setQ} placeholder="Search by domain" />
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Channel type</th>
              <th>Brands named alongside</th>
              <th style={{ textAlign: "right" }}>Citations</th>
              <th style={{ width: 120 }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.domain}>
                <td><DomainCell domain={r.domain} url={r.urls[0]?.url} title={r.urls[0]?.title} /></td>
                <td><ChannelBadge type={r.type} /></td>
                <td className="small">
                  {Object.entries(r.withBrands).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([d, n]) => `${d === you ? "you" : nameOf(d)} ${n}`).join(" · ") || <span className="muted">none</span>}
                </td>
                <td className="mono" style={{ textAlign: "right" }}>{r.answers}</td>
                <td style={{ verticalAlign: "middle" }}><Meter value={total ? (r.answers / total) * 100 : 0} color={r.type === "you" ? "var(--accent)" : "var(--text-3)"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={t.page} pages={t.pages} total={t.total} onPage={t.setPage} />
    </Tile>
  );
}

export function TopUrls({ answers, brands, title = "Top URLs", sub = "Pages most often referenced in the answers, what kind of page each is and who the answer names." }: { answers: Answer[]; brands: Brand[]; title?: string; sub?: string }) {
  const rows = useMemo(() => urlTable(answers, brands), [answers, brands]);
  const t = useSearchPage(rows, (r) => `${r.url} ${r.title}`, 8);
  return (
    <Tile title={title} sub={sub}>
      <SearchBox value={t.q} onChange={t.setQ} placeholder="Search by URL or title" />
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>URL</th>
              <th>Content type</th>
              <th>Channel type</th>
              <th style={{ textAlign: "right" }}>Citations</th>
              <th>Engines</th>
              <th>Brand mentioned</th>
              <th>Competitors mentioned</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.url}>
                <td style={{ maxWidth: 340 }}><DomainCell domain={r.domain} url={r.url} title={r.title} sub={r.url.replace(/^https?:\/\/(www\.)?/, "")} /></td>
                <td><ContentBadge type={r.content} /></td>
                <td><ChannelBadge type={r.channel} /></td>
                <td className="mono" style={{ textAlign: "right" }}>{r.citations}</td>
                <td><EngineDots engines={r.engines} /></td>
                <td className="small">{r.withYou ? <span className="badge gain">Yes · {r.withYou}/{r.citations}</span> : <span className="badge">No</span>}</td>
                <td className="small">{r.competitors.map(nameOf).join(", ") || <span className="muted">none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={t.page} pages={t.pages} total={t.total} onPage={t.setPage} />
    </Tile>
  );
}
