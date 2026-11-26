"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { analyzeAnswer, opportunities, type Answer, type BrandResult, type Opportunity } from "@/lib/aeo";
import { loadActions, saveActions, trackAction, type AeoAction, type ActionStatus, type RunAnswers } from "@/lib/aeo-actions";
import type { PromptContext } from "@/lib/fix-prompts";
import { loadRuns, saveRun, type AiRun, type Observation } from "@/lib/ai-visibility";
import { loadSites, siteForDomain, type TrackedSite } from "@/lib/history";
import { useProject } from "@/lib/project";
import { postResearch, research } from "@/lib/research-client";
import { AI_ENGINES, type AiAnswer, type AiEngine } from "@/lib/research-types";
import { IconCheck } from "../icons";
import { EmptyState, PageHead } from "../kit";
import PromptManager from "../aeo/PromptManager";
import { PromptTable } from "../aeo/Results";
import Dashboard from "../aeo/Dashboard";
import CitationsView from "../aeo/CitationsView";
import Actions from "../aeo/Actions";
import Impact from "../aeo/Impact";
import SignalsDashboard from "../aeo/SignalsDashboard";
import { fromGsc, fromInsight, fromSimulation, loadSims, saveSim, type SavedSimulation, type Suggestion } from "@/lib/aeo-signals";
import { gscNote, useGscOpportunities } from "@/lib/aeo-gsc";
import { useTraffic } from "@/lib/traffic-client";
import { AI_KINDS } from "@/lib/traffic";
import { trafficInsights } from "@/lib/traffic-insights";
import { brandResults, brandsOf, Highlight, SentimentBadge } from "../aeo/shared";
import PromptReport from "../aeo/PromptReport";
import Simulator from "../aeo/Simulator";
import EngineCompare from "../aeo/EngineCompare";
import { scoreColor } from "../ui";
import { ErrorBox, ProviderNotice, useResearchStatus } from "./common";

const TRAFFIC_DAYS = 30;
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

type Tab = "overview" | "prompts" | "by-prompt" | "compare" | "citations" | "actions" | "impact" | "simulate" | "setup";

export default function AiVisibility() {
  const [project, update] = useProject();
  const status = useResearchStatus();
  const [runs, setRuns] = useState<AiRun[]>([]);
  const [site, setSite] = useState<TrackedSite | null>(null);
  const [engines, setEngines] = useState<Set<AiEngine>>(new Set(["google", "chatgpt", "perplexity", "claude", "gemini"]));
  const [judge, setJudge] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [fatal, setFatal] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [viewing, setViewing] = useState<Observation | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [simulate, setSimulate] = useState<{ prompt: string; engine?: AiEngine; nonce: number } | null>(null);
  const [report, setReport] = useState<{ prompt: string; nonce: number } | null>(null);
  const [compare, setCompare] = useState<{ prompt: string; nonce: number } | null>(null);
  const [actions, setActions] = useState<AeoAction[]>([]);
  const [sims, setSims] = useState<SavedSimulation[]>([]);
  const traffic = useTraffic(project.id || null, TRAFFIC_DAYS);
  const gsc = useGscOpportunities(project.id);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- browser-stored runs and audits for the active project */
    setRuns(project.id ? loadRuns(project.id) : []);
    setActions(project.id ? loadActions(project.id) : []);
    setSims(project.id ? loadSims(project.id) : []);
    setSite(siteForDomain(loadSites(), project.domain));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [project.id, project.domain]);

  const brand = project.brand || project.name;
  const brands = useMemo(() => brandsOf(project, brand), [project, brand]);
  const last = runs.at(-1);
  const observations = useMemo(() => (last?.observations ?? []).map((o) => ({ ...o, brands: brandResults(o, brands) })), [last, brands]);
  const answerList: Answer[] = observations;
  const prev = runs.at(-2);
  const previous = useMemo<Answer[]>(() => (prev?.observations ?? []).map((o) => ({ ...o, brands: brandResults(o, brands) })), [prev, brands]);
  const history = useMemo<RunAnswers[]>(() => runs.map((r) => ({ at: r.at, answers: r.observations.map((o) => ({ ...o, brands: brandResults(o, brands) })) })), [runs, brands]);
  const statusKnown = traffic.state === "ready" && (traffic.stats.agents.length ? traffic.stats.agents.some((a) => a.unknownStatus < a.hits) : traffic.site.lastVia !== "next");
  const suggestions = useMemo<Suggestion[]>(() => {
    const order = { high: 0, medium: 1, low: 2 };
    return [
      ...opportunities(answerList, brands, brand).map((o) => ({ ...o, source: "answers" as const })),
      ...sims.map(fromSimulation).filter((x): x is Suggestion => !!x),
      ...(traffic.state === "ready" ? trafficInsights(traffic.stats, traffic.site.domain, statusKnown).map((i) => fromInsight(i, traffic.site.domain)).filter((x): x is Suggestion => !!x) : []),
      ...(gsc?.connected ? gsc.opportunities.slice(0, 15).map((o) => fromGsc(o, gsc.days)) : []),
    ].sort((a, b) => order[a.priority] - order[b.priority]);
  }, [answerList, brands, brand, sims, traffic, statusKnown, gsc]);
  const trafficNow = traffic.state === "ready" ? { at: new Date().toISOString(), days: TRAFFIC_DAYS, aiCrawls: AI_KINDS.reduce((n, k) => n + (traffic.stats.totals[k] ?? 0), 0), aiReferrals: traffic.stats.daily.reduce((n, d) => n + d.aiReferrals, 0) } : undefined;
  const ctx = useMemo<PromptContext>(() => ({ site: project.domain ? `https://${project.domain}` : brand, source: `AI visibility run (brand: ${brand})` }), [project.domain, brand]);
  const track = (os: (Opportunity | Suggestion)[], status: ActionStatus = "todo") => {
    const latest = history.at(-1) ?? null;
    if (!project.id) return;
    const have = new Set(actions.map((a) => a.id));
    const added = os.map((o) => ({ ...trackAction(o, latest, project.domain, "source" in o && o.source === "traffic" ? trafficNow : undefined), status })).filter((a) => !have.has(a.id));
    setActions(saveActions(project.id, [...actions, ...added]));
  };
  const updateAction = (id: string, patch: Partial<AeoAction>) => {
    setActions(saveActions(project.id, actions.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a))));
  };
  const trackedIds = useMemo(() => new Set(actions.map((a) => a.id)), [actions]);
  const engineList = AI_ENGINES.filter((e) => engines.has(e.id));
  const calls = project.prompts.length * engineList.length;
  const llm = !!status?.llm;

  const run = async () => {
    setConfirm(false);
    setFatal(null);
    const jobs = project.prompts.flatMap((prompt) => engineList.map((e) => ({ prompt, engine: e.id })));
    setProgress({ done: 0, total: jobs.length });
    const out: Observation[] = [];
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
            let br: BrandResult[] = analyzeAnswer(a.text, a.sources, brands, j.prompt);
            if (judge && llm && a.text) {
              br = await postResearch<BrandResult[]>("/api/aeo/judge", { text: a.text, sources: a.sources, brands, prompt: j.prompt }).catch(() => br);
            }
            out.push({
              prompt: j.prompt,
              engine: j.engine,
              model: a.model,
              answered: a.answered,
              you: { mentioned: br[0].mentioned, cited: br[0].cited },
              competitors: Object.fromEntries(br.slice(1).map((b) => [b.domain, { mentioned: b.mentioned, cited: b.cited }])),
              sources: a.sources,
              excerpt: a.text.slice(0, 1500),
              brands: br,
            });
          } catch (e) {
            const code = (e as { code?: unknown }).code;
            if (code === 40100 || code === 40210 || code === "token" || code === "not-configured") {
              stop = true;
              setFatal(e);
            }
            out.push({ prompt: j.prompt, engine: j.engine, model: "", answered: false, error: e instanceof Error ? e.message : String(e), you: { mentioned: false, cited: false }, competitors: {}, sources: [], excerpt: "" });
          }
          setProgress({ done: ++done, total: jobs.length });
        }
      }),
    );
    if (out.some((o) => !o.error)) {
      setRuns(saveRun(project.id, { id: Math.random().toString(36).slice(2, 10), at: new Date().toISOString(), cost: Math.round(cost * 10000) / 10000, observations: out }));
      setAnswers(texts);
      setTab("overview");
    }
    setProgress(null);
  };

  const openSim = (prompt: string, engine?: AiEngine) => {
    setSimulate({ prompt, engine, nonce: Date.now() });
    setTab("simulate");
  };
  const openReport = (prompt: string) => {
    setReport({ prompt, nonce: Date.now() });
    setTab("by-prompt");
  };
  const openCompare = (prompt: string) => {
    setCompare({ prompt, nonce: Date.now() });
    setTab("compare");
  };
  const active: Tab = tab ?? (last ? "overview" : "setup");
  const terms = [brand, project.domain, ...project.aliases, ...brands.slice(1).map((b) => b.name)];

  return (
    <main className="shell">
      <PageHead
        title="AI visibility"
        sub={`How ChatGPT, Claude, Perplexity, Gemini and Google AI Overviews answer the questions your buyers ask: whether they name ${brand || "you"}, in what position and tone, which sources they trust, and what to change.`}
        actions={
          status?.dataforseo ? (
            <button className="btn btn-primary" disabled={!calls || !project.domain || !!progress} onClick={() => setConfirm(true)}>
              {progress ? `Asking ${progress.done}/${progress.total}` : "Run check"}
            </button>
          ) : null
        }
      />
      <div className="stack">
        {confirm && (
          <div className="card card-pad row" role="alertdialog" aria-label="Confirm AI visibility check">
            <div style={{ flex: 1, minWidth: 240 }}>
              <b>Ask {engineList.length} engines {project.prompts.length} prompts ({calls} answers)?</b>
              <div className="muted small">
                Each answer is a paid DataForSEO request{judge && llm ? ", plus one Claude request to judge it" : ""}; the exact DataForSEO cost is shown when the run finishes. Repeats within 12 hours are free.
              </div>
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

        <div className="tabs" role="tablist">
          {(
            [
              ["overview", "Dashboard"],
              ["prompts", "Prompts"],
              ["by-prompt", "By prompt"],
              ["compare", "Compare engines"],
              ["citations", "Citations"],
              ["actions", `Recommendations${actions.some((a) => a.status === "todo" || a.status === "doing") ? ` ${actions.filter((a) => a.status === "todo" || a.status === "doing").length}` : ""}`],
              ["impact", "Impact"],
              ["simulate", "Simulate agents"],
              ["setup", `Setup · ${project.prompts.length} prompts`],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} className="tab" role="tab" aria-selected={active === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {active === "setup" ? (
          <>
            <section className="card card-pad">
              <h2 className="section-title">AI readiness <span className="badge gain">free</span></h2>
              <p className="section-sub">What AI engines need before they can cite you, from your latest audit.</p>
              <Readiness site={site} />
            </section>

            {status && !status.dataforseo && (
              <ProviderNotice
                unlocks="AI answer monitoring"
                free={<>Answers come from DataForSEO&apos;s AI Optimization API (live ChatGPT, Claude, Gemini and Perplexity responses with web search) and Google AI Overviews. You can set up prompts and simulate agents now.</>}
              />
            )}

            <PromptManager project={project} brand={brand} update={update} />

            <section className="card card-pad">
              <div className="row" style={{ flexWrap: "wrap" }}>
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
                <span className="spacer" />
                {llm ? (
                  <label className="row small" style={{ gap: 6 }} title="Claude confirms which brands each answer really means and judges the tone. One extra Claude request per answer.">
                    <input type="checkbox" checked={judge} onChange={(e) => setJudge(e.currentTarget.checked)} /> Judge sentiment with Claude
                  </label>
                ) : (
                  <span className="small muted" title="Set ANTHROPIC_API_KEY on the server to judge sentiment with Claude and to get written explanations in Simulate agents.">Sentiment: word lists (set ANTHROPIC_API_KEY for Claude)</span>
                )}
              </div>
            </section>

          </>
        ) : active === "compare" ? (
          <EngineCompare
            project={project}
            brand={brand}
            brands={brands}
            observations={observations}
            runAt={last?.at ?? null}
            live={!!status?.dataforseo}
            judge={judge && llm}
            initial={compare}
            onSimulation={(x) => setSims(saveSim(project.id, x))}
            onOpenSimulator={openSim}
          />
        ) : active === "simulate" ? (
          <Simulator project={project} brand={brand} observations={observations} llm={llm} initial={simulate} onResult={(x) => setSims(saveSim(project.id, x))} />
        ) : !last && active === "overview" ? (
          <SignalsDashboard traffic={traffic} days={TRAFFIC_DAYS} domain={project.domain} brand={brand} prompts={project.prompts} sims={sims} answersTracked={false} onSimulate={openSim} />
        ) : !last && active === "actions" ? (
          <Actions actions={actions} suggestions={suggestions} latest={null} runs={history} you={project.domain} ctx={ctx} onTrack={track} onUpdate={updateAction} trafficNow={trafficNow} gsc={gscNote(gsc)} />
        ) : !last && active === "impact" ? (
          <Impact runs={history} brands={brands} actions={actions} projectId={project.id} domain={project.domain} />
        ) : !last ? (
          <div className="card">
            <EmptyState
              title="No runs yet"
              body={
                status?.dataforseo
                  ? "Run a check to see which engines name and cite you, in what position and tone, and who they recommend instead. Or simulate agents on a prompt for free."
                  : "This view compares what AI answers say, which needs DataForSEO. The Dashboard, Recommendations and Impact tabs work from your traffic collector, Search Console and agent simulations."
              }
              action={status?.dataforseo && project.prompts.length ? { label: "Run check", onClick: () => setConfirm(true) } : { label: "Simulate agents", onClick: () => setTab("simulate") }}
            />
          </div>
        ) : (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              Last run {fmt(last.at)}: {last.observations.length} answers, ${last.cost.toFixed(3)}.
              {observations.some((o) => o.brands?.some((b) => b.judgedBy === "llm")) ? " Sentiment judged by Claude." : " Sentiment from word lists."}
            </p>
            {active === "overview" && (
              <>
                <Dashboard runs={history} brands={brands} brand={brand} />
                <SignalsDashboard traffic={traffic} days={TRAFFIC_DAYS} domain={project.domain} brand={brand} prompts={project.prompts} sims={sims} answersTracked onSimulate={openSim} />
              </>
            )}
            {active === "prompts" && (
              <section className="card card-pad">
                <PromptTable observations={observations} previous={previous} brand={brand} brands={brands} onOpen={setViewing} onReport={openReport} onCompare={openCompare} />
              </section>
            )}
            {active === "by-prompt" && (
              <section className="card card-pad">
                <PromptReport answers={answerList} previous={previous} brands={brands} brand={brand} domain={project.domain} initial={report} onSimulate={openSim} tracked={trackedIds} onTrack={(o) => track([o])} />
              </section>
            )}
            {active === "citations" && <CitationsView runs={history} brands={brands} />}
            {active === "actions" && <Actions actions={actions} suggestions={suggestions} latest={history.at(-1) ?? null} runs={history} you={project.domain} ctx={ctx} onTrack={track} onUpdate={updateAction} trafficNow={trafficNow} gsc={gscNote(gsc)} />}
            {active === "impact" && <Impact runs={history} brands={brands} actions={actions} projectId={project.id} domain={project.domain} />}

            {viewing && active === "prompts" && (
              <section className="card card-pad">
                <div className="panel-head">
                  <div>
                    <h2 className="section-title">{AI_ENGINES.find((e) => e.id === viewing.engine)?.label} on “{viewing.prompt}”</h2>
                    <p className="section-sub" style={{ marginBottom: 0 }}>Model: {viewing.model}. Highlighted: your brand and competitors.</p>
                  </div>
                  <span className="spacer" />
                  <button className="btn btn-sm btn-primary" onClick={() => openSim(viewing.prompt, viewing.engine)}>Simulate agents</button>
                  <button className="btn btn-sm" onClick={() => setViewing(null)}>Close</button>
                </div>
                {viewing.brands && (
                  <div className="list-rows" style={{ margin: "10px 0" }}>
                    {viewing.brands.filter((b) => b.mentioned || b.cited).sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).map((b) => (
                      <div className="list-row" key={b.domain} style={{ alignItems: "flex-start" }}>
                        <span className="mono small" style={{ width: 28 }}>{b.position ? `#${b.position}` : "–"}</span>
                        <span style={{ width: 140 }}>
                          <b>{brands.find((x) => x.domain === b.domain)?.name}</b> {b.domain === project.domain && <span className="badge accent">you</span>}
                        </span>
                        <span style={{ width: 150 }} className="row">
                          <SentimentBadge s={b.sentiment} /> {b.cited && <span className="badge gain">cited</span>}
                        </span>
                        <span className="muted small" style={{ flex: 1 }}>{b.quote}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(answers[`${viewing.engine}|${viewing.prompt}`] ?? viewing.excerpt) ? (
                  <div className="answer">
                    <Highlight text={answers[`${viewing.engine}|${viewing.prompt}`] ?? viewing.excerpt} terms={terms} />
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
