"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { brandOf, loadRuns, matchBrand, rates, saveRun, suggestPrompts, topSources, type AiRun, type Observation } from "@/lib/ai-visibility";
import { loadSites, siteForDomain, type TrackedSite } from "@/lib/history";
import { useProject } from "@/lib/project";
import { research } from "@/lib/research-client";
import { AI_ENGINES, type AiAnswer, type AiEngine } from "@/lib/research-types";
import { LineChart } from "../charts";
import { IconCheck } from "../icons";
import { EmptyState, Kpi, PageHead } from "../kit";
import { scoreColor } from "../ui";
import { ErrorBox, ProviderNotice, useResearchStatus } from "./common";

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const t = terms.filter((x) => x.length >= 2);
  if (!t.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${t.map(esc).join("|")})`, "giu"));
  return <>{parts.map((p, i) => (t.some((x) => x.toLowerCase() === p.toLowerCase()) ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>;
}

function Cell({ o }: { o?: Observation }) {
  if (!o) return <span className="na">.</span>;
  if (o.error) return <span className="na" title={o.error}>error</span>;
  if (!o.answered) return <span className="na">no answer</span>;
  if (o.you.cited) return <span className="badge gain" title="Mentioned and cited"><IconCheck size={11} /> cited</span>;
  if (o.you.mentioned) return <span className="badge accent">mentioned</span>;
  return <span className="badge">absent</span>;
}

function Readiness({ site }: { site: TrackedSite | null }) {
  const last = site?.snapshots.at(-1);
  if (!site || !last) {
    return (
      <p className="muted">
        Audit your site to check whether AI crawlers can reach it, whether it has llms.txt, and how answer-ready the content is.{" "}
        <Link href="/audit">Run an audit</Link>
      </p>
    );
  }
  const blocked = site.latest?.blockedCrawlers ?? [];
  const items = [
    { label: "AI crawlers can reach the site", ok: blocked.length === 0, detail: blocked.length ? `Blocked: ${blocked.join(", ")}` : "No search or live-fetch crawler is blocked" },
    { label: "llms.txt published", ok: !!site.latest?.llms, detail: site.latest?.llms ? "Found at /llms.txt" : "A draft is in the audit's generated files" },
  ];
  const scores = (["chatgpt", "perplexity", "claude", "gemini"] as const).map((p) => ({ p, s: last.scores[p] ?? 0 }));
  return (
    <div className="two-col">
      <ul className="checklist">
        {items.map((i) => (
          <li key={i.label}>
            <span className={`check-dot ${i.ok ? "on" : ""}`} style={!i.ok ? { borderColor: "var(--fail)", color: "var(--fail)" } : undefined}>{i.ok ? <IconCheck size={11} /> : "!"}</span>
            <div>
              <div>{i.label}</div>
              <div className="muted small">{i.detail}</div>
            </div>
          </li>
        ))}
      </ul>
      <div>
        {scores.map(({ p, s }) => (
          <div className="cat-row" key={p} style={{ gridTemplateColumns: "110px 1fr 32px" }}>
            <span className="small" style={{ textTransform: "capitalize" }}>{p === "chatgpt" ? "ChatGPT" : p}</span>
            <div className="bar"><span style={{ width: `${s}%`, background: scoreColor(s) }} /></div>
            <b className="small" style={{ textAlign: "right" }}>{s}</b>
          </div>
        ))}
        <Link className="small" href={`/audit?url=${encodeURIComponent(site.url)}`}>Open the audit for fixes</Link>
      </div>
    </div>
  );
}

export default function AiVisibility() {
  const [project, update] = useProject();
  const status = useResearchStatus();
  const [runs, setRuns] = useState<AiRun[]>([]);
  const [site, setSite] = useState<TrackedSite | null>(null);
  const [engines, setEngines] = useState<Set<AiEngine>>(new Set(["google", "chatgpt", "perplexity", "claude", "gemini"]));
  const [adding, setAdding] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [fatal, setFatal] = useState<unknown>(null);
  const [tab, setTab] = useState<"prompts" | "competitors" | "sources">("prompts");
  const [viewing, setViewing] = useState<Observation | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- browser-stored runs and audits for the active project */
    setRuns(project.id ? loadRuns(project.id) : []);
    setSite(siteForDomain(loadSites(), project.domain));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [project.id, project.domain]);

  const brand = project.brand || brandOf(project.domain);
  const last = runs.at(-1);
  const you = last ? rates(last.observations) : null;
  const engineList = AI_ENGINES.filter((e) => engines.has(e.id));
  const calls = project.prompts.length * engineList.length;

  const run = async () => {
    setConfirm(false);
    setFatal(null);
    const jobs = project.prompts.flatMap((prompt) => engineList.map((e) => ({ prompt, engine: e.id })));
    setProgress({ done: 0, total: jobs.length });
    const observations: Observation[] = [];
    const texts: Record<string, string> = {};
    let next = 0;
    let done = 0;
    let cost = 0;
    let stop = false;
    await Promise.all(
      Array.from({ length: Math.min(4, jobs.length) }, async () => {
        while (next < jobs.length && !stop) {
          const j = jobs[next++];
          try {
            const a = await research<AiAnswer>("ai", { engine: j.engine, prompt: j.prompt, loc: project.location });
            cost += a.cost;
            texts[`${j.engine}|${j.prompt}`] = a.text;
            observations.push({
              prompt: j.prompt,
              engine: j.engine,
              model: a.model,
              answered: a.answered,
              you: matchBrand(a, brand, project.domain),
              competitors: Object.fromEntries(project.competitors.map((c) => [c, matchBrand(a, brandOf(c), c)])),
              sources: a.sources,
              excerpt: a.text.slice(0, 1500),
            });
          } catch (e) {
            const code = (e as { code?: unknown }).code;
            if (code === 40100 || code === 40210 || code === "token" || code === "not-configured") {
              stop = true;
              setFatal(e);
            }
            observations.push({ prompt: j.prompt, engine: j.engine, model: "", answered: false, error: e instanceof Error ? e.message : String(e), you: { mentioned: false, cited: false }, competitors: {}, sources: [], excerpt: "" });
          }
          setProgress({ done: ++done, total: jobs.length });
        }
      }),
    );
    if (observations.some((o) => !o.error)) {
      setRuns(saveRun(project.id, { id: Math.random().toString(36).slice(2, 10), at: new Date().toISOString(), cost: Math.round(cost * 10000) / 10000, observations }));
      setAnswers(texts);
    }
    setProgress(null);
  };

  const competitorRows = useMemo(() => {
    if (!last) return [];
    return [
      { name: brand || project.domain, domain: project.domain, you: true, r: rates(last.observations) },
      ...project.competitors.map((c) => ({ name: brandOf(c), domain: c, you: false, r: rates(last.observations, (o) => o.competitors[c]) })),
    ].sort((a, b) => b.r.mentionRate - a.r.mentionRate);
  }, [last, brand, project.domain, project.competitors]);

  const gaps = last ? last.observations.filter((o) => o.answered && !o.you.mentioned && Object.values(o.competitors).some((m) => m.mentioned)) : [];

  return (
    <main className="shell">
      <PageHead
        title="AI visibility"
        sub={`Whether ChatGPT, Claude, Perplexity, Gemini and Google AI Overviews mention or cite ${brand || "your brand"} when people ask the questions that matter.`}
        actions={
          status?.dataforseo ? (
            <button className="btn btn-primary" disabled={!calls || !project.domain || !!progress} onClick={() => setConfirm(true)}>
              {progress ? `Asking ${progress.done}/${progress.total}` : "Run check"}
            </button>
          ) : null
        }
      />
      <div className="stack">
        <section className="card card-pad">
          <h2 className="section-title">AI readiness <span className="badge gain">free</span></h2>
          <p className="section-sub">What AI engines need before they can cite you, from your latest audit.</p>
          <Readiness site={site} />
        </section>

        {status && !status.dataforseo && (
          <ProviderNotice unlocks="AI answer monitoring" free={<>Answers come from DataForSEO&apos;s AI Optimization API (live ChatGPT, Claude, Gemini and Perplexity responses with web search) and Google AI Overviews. You can set up prompts now.</>} />
        )}

        <section className="card card-pad">
          <div className="panel-head">
            <div>
              <h2 className="section-title">Prompts ({project.prompts.length})</h2>
              <p className="section-sub" style={{ marginBottom: 0 }}>Questions your customers ask AI assistants. Neutral prompts that don&apos;t name your brand measure real visibility.</p>
            </div>
          </div>
          <div className="row" style={{ marginBottom: 12, alignItems: "flex-end" }}>
            <label className="pb-field" style={{ maxWidth: 220 }}>
              <span>Brand name to detect</span>
              <input key={project.id + brand} className="input" defaultValue={brand} onBlur={(e) => update({ brand: e.currentTarget.value })} />
            </label>
            <form
              className="row"
              style={{ flex: 1, minWidth: 260 }}
              onSubmit={(e) => {
                e.preventDefault();
                const list = adding.split("\n").map((s) => s.trim()).filter(Boolean);
                if (list.length) update({ prompts: [...project.prompts, ...list] });
                setAdding("");
              }}
            >
              <input className="input" style={{ flex: 1 }} placeholder="What is the best invoicing tool for freelancers?" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="New prompt" />
              <button className="btn" type="submit" disabled={!adding.trim()}>Add prompt</button>
            </form>
          </div>
          {project.prompts.length === 0 ? (
            <div className="notice">
              No prompts yet.{" "}
              {suggestPrompts(project.keywords, brand, project.competitors).length > 0 ? (
                <button className="btn btn-sm" onClick={() => update({ prompts: suggestPrompts(project.keywords, brand, project.competitors).slice(0, 10) })}>
                  Add suggested prompts
                </button>
              ) : (
                "Track some keywords or add competitors and suggestions will appear here."
              )}
            </div>
          ) : (
            <div className="chips" style={{ marginTop: 0 }}>
              {project.prompts.map((p) => (
                <span key={p} className="chip">
                  {p}
                  <button className="chip-x" aria-label={`Remove ${p}`} onClick={() => update({ prompts: project.prompts.filter((x) => x !== p) })}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 14 }}>
            <span className="small muted">Engines:</span>
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
        </section>

        {confirm && (
          <div className="card card-pad row" role="alertdialog" aria-label="Confirm AI visibility check">
            <div style={{ flex: 1, minWidth: 240 }}>
              <b>Ask {engineList.length} engines {project.prompts.length} prompts ({calls} answers)?</b>
              <div className="muted small">Each answer is a paid DataForSEO request; the exact cost is shown when the run finishes. Repeats within 12 hours are free.</div>
            </div>
            <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={run}>Run check</button>
          </div>
        )}
        {progress && (
          <div className="card card-pad">
            <div className="row small" style={{ marginBottom: 8 }}>
              <span className="spinner" /> Asking engines: {progress.done} of {progress.total}
            </div>
            <div className="progress-bar"><span style={{ width: `${(progress.done / progress.total) * 100}%`, background: "var(--accent)" }} /></div>
          </div>
        )}
        <ErrorBox error={fatal} onRetry={run} />

        {!last ? (
          project.prompts.length > 0 && status?.dataforseo ? (
            <div className="card">
              <EmptyState title="No runs yet" body="Run a check to see which engines mention and cite you, and who they recommend instead." action={{ label: "Run check", onClick: () => setConfirm(true) }} />
            </div>
          ) : null
        ) : (
          <>
            <div className="kpi-row">
              <Kpi label="Mentioned" value={`${you!.mentionRate}%`} foot={`of ${you!.answered} answers on ${fmt(last.at)}`} />
              <Kpi label="Cited as a source" value={`${you!.citationRate}%`} foot="Answers linking to your domain" />
              <Kpi label="Competitor gaps" value={gaps.length} foot="Answers naming a competitor but not you" tone={gaps.length ? "var(--warn)" : undefined} />
              <Kpi label="Run cost" value={`$${last.cost.toFixed(3)}`} foot={`${last.observations.length} requests`} />
            </div>

            {runs.length > 1 && (
              <section className="card card-pad">
                <h2 className="section-title">Mention rate over time</h2>
                <div style={{ marginTop: 10 }}>
                  <LineChart
                    ariaLabel="Mention rate by engine over time"
                    x={runs.map((r) => fmt(r.at))}
                    yDomain={[0, 100]}
                    format={(n) => `${n}%`}
                    series={AI_ENGINES.map((e) => ({
                      id: e.id,
                      label: e.label,
                      color: e.color,
                      values: runs.map((r) => {
                        const x = rates(r.observations.filter((o) => o.engine === e.id));
                        return x.answered ? x.mentionRate : null;
                      }),
                    }))}
                  />
                </div>
              </section>
            )}

            <section className="card card-pad">
              <div className="panel-head">
                <div className="segmented" role="group" aria-label="Results view">
                  {(["prompts", "competitors", "sources"] as const).map((t) => (
                    <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
                      {t === "prompts" ? "Prompts" : t === "competitors" ? "Competitors" : "Cited sources"}
                    </button>
                  ))}
                </div>
              </div>

              {tab === "prompts" && (
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>Prompt</th>
                        {AI_ENGINES.filter((e) => last.observations.some((o) => o.engine === e.id)).map((e) => (
                          <th key={e.id}>
                            <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: e.color }} />{e.label}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...new Set(last.observations.map((o) => o.prompt))].map((p) => (
                        <tr key={p}>
                          <td style={{ maxWidth: 320 }}>{p}</td>
                          {AI_ENGINES.filter((e) => last.observations.some((o) => o.engine === e.id)).map((e) => {
                            const o = last.observations.find((x) => x.prompt === p && x.engine === e.id);
                            return (
                              <td key={e.id}>
                                <button className="btn-ghost" style={{ border: 0, background: "none", padding: 0, cursor: o?.answered ? "pointer" : "default" }} onClick={() => o?.answered && setViewing(o)} aria-label={`View ${e.label} answer`}>
                                  <Cell o={o} />
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {tab === "competitors" && (
                <>
                  <div className="table-wrap">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>Brand</th>
                          <th>Mentioned in</th>
                          <th style={{ width: "36%" }} />
                          <th style={{ textAlign: "right" }}>Cited in</th>
                        </tr>
                      </thead>
                      <tbody>
                        {competitorRows.map((c) => (
                          <tr key={c.domain}>
                            <td>
                              {c.name} <span className="muted small">{c.domain}</span> {c.you && <span className="badge accent">you</span>}
                            </td>
                            <td><b>{c.r.mentionRate}%</b></td>
                            <td style={{ verticalAlign: "middle" }}><div className="bar"><span style={{ width: `${c.r.mentionRate}%`, background: c.you ? "var(--accent)" : "var(--text-3)" }} /></div></td>
                            <td style={{ textAlign: "right" }}>{c.r.citationRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {project.competitors.length === 0 && <p className="muted small" style={{ marginTop: 8 }}>Add competitors in the project to compare share of mentions.</p>}
                  {gaps.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <h3 className="section-title">Where competitors win</h3>
                      <div className="list-rows">
                        {gaps.slice(0, 12).map((o) => (
                          <div className="list-row" key={o.engine + o.prompt}>
                            <span style={{ flex: 1 }}>{o.prompt}</span>
                            <span className="muted small">{AI_ENGINES.find((e) => e.id === o.engine)?.label}</span>
                            <span className="small">{Object.entries(o.competitors).filter(([, m]) => m.mentioned).map(([c]) => brandOf(c)).join(", ")}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {tab === "sources" && (
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>Domain</th>
                        <th style={{ textAlign: "right" }}>Answers citing it</th>
                        <th style={{ textAlign: "right" }}>Prompts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topSources(last.observations).map((s) => {
                        const mine = project.domain && (s.domain === project.domain || s.domain.endsWith(`.${project.domain}`));
                        const comp = project.competitors.find((c) => s.domain === c || s.domain.endsWith(`.${c}`));
                        return (
                          <tr key={s.domain}>
                            <td>
                              {s.domain} {mine && <span className="badge accent">you</span>} {comp && <span className="badge">competitor</span>}
                            </td>
                            <td style={{ textAlign: "right" }}><b>{s.answers}</b></td>
                            <td style={{ textAlign: "right" }}>{s.prompts}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="muted small" style={{ marginTop: 8 }}>Sites cited again and again (review sites, forums, list articles) are where to earn mentions.</p>
                </div>
              )}
            </section>

            {viewing && (
              <section className="card card-pad">
                <div className="panel-head">
                  <div>
                    <h2 className="section-title">{AI_ENGINES.find((e) => e.id === viewing.engine)?.label} on “{viewing.prompt}”</h2>
                    <p className="section-sub" style={{ marginBottom: 0 }}>Model: {viewing.model}. Highlighted: your brand and competitors.</p>
                  </div>
                  <span className="spacer" />
                  <button className="btn btn-sm" onClick={() => setViewing(null)}>Close</button>
                </div>
                {(answers[`${viewing.engine}|${viewing.prompt}`] ?? viewing.excerpt) ? (
                  <div className="answer">
                    <Highlight text={answers[`${viewing.engine}|${viewing.prompt}`] ?? viewing.excerpt} terms={[brand, project.domain, ...project.competitors.map(brandOf)]} />
                  </div>
                ) : (
                  <p className="muted">This engine returned sources without answer text (Google AI Overviews show citations only here).</p>
                )}
                {viewing.sources.length > 0 && (
                  <ul className="plain-list" style={{ marginTop: 12 }}>
                    {viewing.sources.slice(0, 12).map((s) => (
                      <li key={s.url} className={s.domain === project.domain || s.domain.endsWith(`.${project.domain}`) ? "is-mine" : ""}>
                        <a href={s.url} target="_blank" rel="noreferrer">{s.domain}</a> <span className="muted small">{s.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
