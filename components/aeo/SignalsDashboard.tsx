"use client";

import Link from "next/link";
import { FACTORS, PROMPT_TYPES, classifyPrompt } from "@/lib/aeo";
import { coverage, engineSignals, MAJOR_ENGINES, type SavedSimulation } from "@/lib/aeo-signals";
import { AI_ENGINES, type AiEngine } from "@/lib/research-types";
import type { TrafficView } from "@/lib/traffic-client";
import { Gauge } from "../charts";
import { scoreColor } from "../ui";
import { Meter } from "./shared";
import { GroupHead, Tile } from "./tables";
import { TrafficPanels } from "./TrafficImpact";

// The AI visibility dashboard from your own data: which AI engines read the site and send people (the traffic
// collector at your edge), and how ready each prompt's page is to be cited (agent simulations). Works without
// answer tracking; with it, the engine part sits under the answer dashboard.

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const n = (v: number) => v.toLocaleString();

export default function SignalsDashboard({
  traffic,
  days,
  domain,
  brand,
  prompts,
  sims,
  answersTracked,
  onSimulate,
}: {
  traffic: TrafficView;
  days: number;
  domain: string;
  brand: string;
  prompts: string[];
  sims: SavedSimulation[];
  /** True when answer runs exist: show only the parts the answer dashboard doesn't. */
  answersTracked: boolean;
  onSimulate: (prompt: string, engine?: AiEngine) => void;
}) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      {!answersTracked && (
        <div className="card card-pad notice-card">
          <b>Built from your own data.</b>{" "}
          <span className="muted">
            Your traffic collector shows which AI engines read {domain || "your site"} and send people. Agent simulations score how ready each prompt&apos;s page is to be cited. Tracking what the answers actually say (named, position, sentiment, competitors) needs DataForSEO.{" "}
            <Link href="/settings#data">Connect it</Link>
          </span>
        </div>
      )}
      <EngineSection traffic={traffic} days={days} domain={domain} full={!answersTracked} />
      {!answersTracked && <Readiness sims={sims} prompts={prompts} brand={brand} onSimulate={onSimulate} />}
    </div>
  );
}

function EngineSection({ traffic, days, domain, full }: { traffic: TrafficView; days: number; domain: string; full: boolean }) {
  if (traffic.state !== "ready") {
    return (
      <Tile title="AI engines and your site" sub="From the traffic collector at your site's edge.">
        {traffic.state === "loading" ? (
          <p className="row small muted"><span className="spinner" /> Loading traffic…</p>
        ) : traffic.state === "error" ? (
          <p className="small" style={{ color: "var(--fail)" }}>{traffic.error}</p>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            {traffic.state === "unavailable" ? "Sign in to see the traffic your collector reports for this workspace. " : "This project has no traffic collector yet. "}
            <Link href="/traffic">{traffic.state === "unavailable" ? "Open Traffic" : "Set one up"}</Link> to see which AI engines read your site and send people.
          </p>
        )}
      </Tile>
    );
  }
  const signals = engineSignals(traffic.stats);
  const cov = coverage(signals);
  const shown = signals.filter((s) => MAJOR_ENGINES.includes(s.id) || s.answerCrawls || s.referrals || s.trainingCrawls);
  return (
    <>
      <GroupHead title="AI engines and your site" sub={`Last ${days} days, from the traffic collector on ${traffic.site.domain}.`} />
      <div className="bento">
        <Tile className="b-5" title="AI engine coverage" sub="Of ChatGPT, Claude, Perplexity, Gemini and Copilot: the share whose crawlers read your site for answers or that send you visitors.">
          <Gauge value={cov.pct} label="AI engine coverage" sub={`${cov.reached.length} of ${MAJOR_ENGINES.length} engines reach you`} />
          {cov.missing.length > 0 && <p className="small muted" style={{ textAlign: "center", margin: 0 }}>Not seen: {cov.missing.join(", ")}</p>}
        </Tile>
        <Tile className="b-7" title="By engine" sub="Answer crawls let an engine quote you; referrals are people clicking through from its answers.">
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Engine</th>
                  <th style={{ textAlign: "right" }}>Answer crawls</th>
                  <th style={{ textAlign: "right" }}>Live fetches</th>
                  <th style={{ textAlign: "right" }}>Training</th>
                  <th style={{ textAlign: "right" }}>Referrals</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id}>
                    <td><span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><span className="dot" style={{ background: s.color }} />{s.label}</span></td>
                    <td className="mono" style={{ textAlign: "right" }}>{n(s.answerCrawls)}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{n(s.liveFetches)}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{n(s.trainingCrawls)}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{n(s.referrals)}</td>
                    <td>
                      {s.referrals > 0 ? (
                        <span className="badge gain">Reads and sends</span>
                      ) : s.answerCrawls > 0 ? (
                        <span className="badge sev-high">Reads, sends no one</span>
                      ) : (
                        <span className="badge sev-critical">Not seen</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tile>
      </div>
      {full && <TrafficPanels stats={traffic.stats} domain={domain || traffic.site.domain} days={days} />}
    </>
  );
}

function Readiness({ sims, prompts, brand, onSimulate }: { sims: SavedSimulation[]; prompts: string[]; brand: string; onSimulate: (prompt: string, engine?: AiEngine) => void }) {
  const rows = [...sims].sort((a, b) => (a.you?.total ?? 0) - (b.you?.total ?? 0));
  const scored = sims.filter((s) => s.you);
  const avg = scored.length ? Math.round(scored.reduce((t, s) => t + s.you!.total, 0) / scored.length) : null;
  const untested = prompts.filter((p) => !sims.some((s) => s.prompt === p));
  return (
    <>
      <GroupHead title="Citation readiness" sub="How well your best page answers each prompt, as each engine's crawler reads it, next to the pages engines cite. Run Simulate agents on a prompt to add it." />
      <div className="bento">
        <Tile className="b-5" title="Average readiness" sub="Your page's score across simulated prompts, out of 100.">
          <Gauge value={avg} label="Average readiness" sub={`${scored.length} simulated ${scored.length === 1 ? "prompt" : "prompts"} with a page of yours`} format={(v) => String(v)} />
        </Tile>
        <Tile className="b-7" title="Prompts not simulated yet" sub="Simulations are free: they read the pages, they don't ask the engines.">
          {untested.length ? (
            <div className="list-rows">
              {untested.slice(0, 6).map((p) => (
                <div className="list-row" key={p}>
                  <span style={{ flex: 1 }} className="small">{p} <span className="badge">{PROMPT_TYPES[classifyPrompt(p, brand)].label}</span></span>
                  <button className="btn btn-sm" onClick={() => onSimulate(p)}>Simulate</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">Every prompt has been simulated at least once.</p>
          )}
        </Tile>
      </div>
      {rows.length > 0 && (
        <Tile title="By prompt and engine" sub="Weakest first. Each row becomes a suggestion in Recommendations.">
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th>Engine</th>
                  <th style={{ width: 150 }}>Your page</th>
                  <th style={{ textAlign: "right" }}>Best cited</th>
                  <th>Biggest gap</th>
                  <th>Simulated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const best = s.cited.length ? Math.max(...s.cited.map((c) => c.total)) : null;
                  const gap = [...s.gaps].sort((a, b) => b.them - b.you - (a.them - a.you))[0];
                  return (
                    <tr key={`${s.engine}|${s.prompt}`}>
                      <td className="small" style={{ maxWidth: 300 }}>{s.prompt}</td>
                      <td className="small">{AI_ENGINES.find((e) => e.id === s.engine)?.label}</td>
                      <td style={{ verticalAlign: "middle" }}>
                        {s.you ? (
                          <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                            <Meter value={s.you.total} color={scoreColor(s.you.total)} />
                            <b className="mono small">{s.you.total}</b>
                          </span>
                        ) : (
                          <span className="badge sev-critical">no page</span>
                        )}
                      </td>
                      <td className="mono small" style={{ textAlign: "right" }}>{best ?? "–"}</td>
                      <td className="small">{gap ? FACTORS[gap.factor].label : <span className="muted">none</span>}</td>
                      <td className="small muted">{fmt(s.at)}</td>
                      <td><button className="btn btn-sm" onClick={() => onSimulate(s.prompt, s.engine)}>Re-run</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Tile>
      )}
    </>
  );
}
