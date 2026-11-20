"use client";

import { useEffect, useMemo, useState } from "react";
import { classifyPrompt, FACTORS, PROMPT_TYPES, type FactorId, type PageScore, type Simulation } from "@/lib/aeo";
import type { Observation } from "@/lib/ai-visibility";
import { fromGap, type PromptContext } from "@/lib/fix-prompts";
import type { Project } from "@/lib/project";
import { postResearch } from "@/lib/research-client";
import { AI_ENGINES, type AiEngine } from "@/lib/research-types";
import { scoreColor } from "../ui";
import { ErrorBox } from "../research/common";
import { CollatedPrompt, FixPromptButton, PickBox, useFixPicker } from "../FixPrompt";
import { Meter, Section, TypeBadge } from "./shared";

// "Simulate agents": read your page and the cited pages the way one engine's crawler does, score them against
// the prompt, and show what to change. Works without a run (then there are no cited pages to compare with).

const FACTOR_ORDER = Object.keys(FACTORS) as FactorId[];

export default function Simulator({
  project,
  brand,
  observations,
  llm,
  initial,
}: {
  project: Project;
  brand: string;
  observations: Observation[];
  llm: boolean;
  initial: { prompt: string; engine?: AiEngine; nonce: number } | null;
}) {
  const [prompt, setPrompt] = useState(project.prompts[0] ?? "");
  const [engine, setEngine] = useState<AiEngine>("chatgpt");
  const [yourUrl, setYourUrl] = useState("");
  const [explain, setExplain] = useState(llm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sim, setSim] = useState<Simulation | null>(null);

  const obs = observations.find((o) => o.prompt === prompt && o.engine === engine && o.answered);
  const cited = obs?.sources.map((s) => s.url) ?? [];

  const run = async (p = prompt, e = engine) => {
    setBusy(true);
    setError(null);
    setSim(null);
    try {
      const o = observations.find((x) => x.prompt === p && x.engine === e && x.answered);
      setSim(
        await postResearch<Simulation>("/api/aeo/simulate", {
          prompt: p,
          engine: e,
          domain: project.domain,
          brand,
          competitors: project.competitors,
          cited: o?.sources.map((s) => s.url) ?? [],
          yourUrl: yourUrl.trim() || undefined,
          explain: llm && explain,
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!initial) return;
    /* eslint-disable react-hooks/set-state-in-effect -- opened from an answer or an opportunity */
    setPrompt(initial.prompt);
    if (initial.engine) setEngine(initial.engine);
    /* eslint-enable react-hooks/set-state-in-effect */
    void run(initial.prompt, initial.engine ?? engine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.nonce]);

  return (
    <Section
      title="Simulate agents"
      sub={
        <>
          See a prompt the way an engine&apos;s crawler does: MetaInfo fetches your best-matching page and the pages the engine cited with that crawler&apos;s user agent and
          robots.txt rules, reads them without JavaScript, and scores how well each answers the prompt. Free: no DataForSEO request.
        </>
      }
    >
      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="pb-field" style={{ flex: 2, minWidth: 240 }}>
          <span>Prompt</span>
          <input className="input" list="aeo-prompts" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What is the best …?" />
          <datalist id="aeo-prompts">{project.prompts.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="pb-field" style={{ minWidth: 160 }}>
          <span>Engine</span>
          <select className="select" value={engine} onChange={(e) => setEngine(e.target.value as AiEngine)}>
            {AI_ENGINES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </label>
        <label className="pb-field" style={{ flex: 1, minWidth: 200 }}>
          <span>Your page (optional)</span>
          <input className="input" value={yourUrl} onChange={(e) => setYourUrl(e.target.value)} placeholder={`https://${project.domain || "example.com"}/…`} />
        </label>
        <button className="btn btn-primary" disabled={busy || !prompt.trim() || !project.domain} onClick={() => run()}>
          {busy ? "Reading pages…" : "Simulate"}
        </button>
      </div>
      <div className="row small muted" style={{ marginTop: 8, flexWrap: "wrap" }}>
        {prompt && <TypeBadge type={classifyPrompt(prompt, brand)} />}
        <span>{obs ? `Compares with the ${cited.length} pages ${AI_ENGINES.find((e) => e.id === engine)?.label} cited in your last run.` : "No run for this prompt and engine yet: scores your page on its own."}</span>
        {llm && (
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={explain} onChange={(e) => setExplain(e.currentTarget.checked)} /> Explain with Claude
          </label>
        )}
      </div>
      <ErrorBox error={error} onRetry={() => run()} />
      {sim && <SimulationView sim={sim} domain={project.domain} />}
    </Section>
  );
}

function SimulationView({ sim, domain }: { sim: Simulation; domain: string }) {
  const picker = useFixPicker();
  const fixes = useMemo(() => sim.gaps.map(fromGap), [sim]);
  const ctx = useMemo<PromptContext>(
    () => ({ site: sim.you?.url ?? `https://${domain}`, source: `simulation of how ${sim.agent.crawler} reads pages for the prompt “${sim.prompt}”` }),
    [sim, domain],
  );
  const pages: { label: string; p: PageScore; mine?: boolean }[] = [
    ...(sim.you ? [{ label: "Your page", p: sim.you, mine: true }] : []),
    ...sim.cited.map((p, i) => ({ label: `Cited ${i + 1}`, p })),
  ];
  return (
    <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
      <div className="notice small">
        <b>{sim.agent.crawler}</b>
        {sim.agent.fetcher !== sim.agent.crawler && <> and <b>{sim.agent.fetcher}</b></>} · {sim.agent.note} {PROMPT_TYPES[sim.type].hint}
      </div>

      {sim.notes.map((n) => (
        <div className="notice small" key={n}>{n}</div>
      ))}

      {!sim.you && <div className="notice" style={{ background: "var(--fail-soft)" }}>No page on your site could be read for this prompt. Check the URL, or that your sitemap lists the page.</div>}

      {sim.llm && "error" in sim.llm && <div className="notice small">Claude couldn&apos;t explain this one: {sim.llm.error}</div>}
      {sim.llm && !("error" in sim.llm) && (
        <div className="card card-pad" style={{ background: "var(--surface-2)" }}>
          <div className="task-title">{sim.llm.verdict}</div>
          <div className="two-col" style={{ marginTop: 10 }}>
            <div>
              <div className="small muted" style={{ fontWeight: 600, marginBottom: 4 }}>Why they won</div>
              <ul className="insight-steps" style={{ paddingLeft: 18 }}>{sim.llm.whyTheyWon.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
            <div>
              <div className="small muted" style={{ fontWeight: 600, marginBottom: 4 }}>What to change</div>
              <ol className="insight-steps">{sim.llm.changes.map((c) => <li key={c.what}><b>{c.what}</b> <span className="muted">{c.why}</span></li>)}</ol>
            </div>
          </div>
          {sim.llm.suggestedAnswer && (
            <>
              <div className="small muted" style={{ fontWeight: 600, margin: "12px 0 4px" }}>A quotable answer for the top of your page (check every fact)</div>
              <div className="answer">{sim.llm.suggestedAnswer}</div>
            </>
          )}
        </div>
      )}

      {sim.gaps.length > 0 && (
        <div>
          <h3 className="section-title">{sim.gaps.some((g) => g.them > 0) ? "Where the cited pages beat yours" : "What to fix on your page"}</h3>
          <CollatedPrompt fixes={fixes} ctx={ctx} picker={picker} />
          <div className="list-rows">
            {sim.gaps.map((g, i) => (
              <div className="list-row" key={g.factor} style={{ alignItems: "flex-start" }}>
                <PickBox id={fixes[i].id} title={FACTORS[g.factor].label} picker={picker} />
                <span style={{ width: 150, fontWeight: 600 }}>{FACTORS[g.factor].label}</span>
                <span className="mono small" style={{ width: 90 }}>
                  you {g.you}
                  {g.them > 0 ? ` · them ${g.them}` : ""}
                </span>
                <span style={{ flex: 1 }}>
                  {g.fix}
                  <FixPromptButton fix={fixes[i]} ctx={ctx} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {pages.length > 0 && (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Factor</th>
                {pages.map((x) => (
                  <th key={x.p.url} style={{ minWidth: 130 }}>
                    {x.label} {x.mine && <span className="badge accent">you</span>}
                    <div className="small muted" style={{ fontWeight: 400, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <a href={x.p.url} target="_blank" rel="noreferrer">{x.p.url.replace(/^https?:\/\/(www\.)?/, "")}</a>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>Overall</b></td>
                {pages.map((x) => <td key={x.p.url}><b style={{ color: scoreColor(x.p.total) }}>{x.p.total}</b></td>)}
              </tr>
              {FACTOR_ORDER.map((f) => (
                <tr key={f}>
                  <td title={FACTORS[f].tip}>{FACTORS[f].label}</td>
                  {pages.map((x) => (
                    <td key={x.p.url}>
                      <div className="row" style={{ gap: 6 }}>
                        <Meter value={x.p.factors[f]} color={scoreColor(x.p.factors[f])} />
                        <span className="mono small">{x.p.factors[f]}</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="muted small">Read as crawler</td>
                {pages.map((x) => (
                  <td key={x.p.url} className="small muted">
                    HTTP {x.p.status}
                    {x.p.format === "markdown" && <span className="badge accent" style={{ marginLeft: 4 }} title="This site serves Markdown to this crawler instead of HTML">Markdown</span>}
                    {x.p.blockedByRobots && <span className="badge sev-critical" style={{ marginLeft: 4 }}>robots.txt blocks</span>} · {x.p.words} words
                    {x.p.updated && <> · {x.p.updated.slice(0, 10)}</>}
                    {x.p.schemaTypes.length > 0 && <div>{x.p.schemaTypes.slice(0, 4).join(", ")}</div>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {sim.you?.bestSection && (
        <div>
          <div className="small muted" style={{ fontWeight: 600, marginBottom: 4 }}>
            Your best passage for this prompt ({sim.you.bestSection.position}% down the page{sim.you.bestSection.heading ? `, under “${sim.you.bestSection.heading}”` : ""})
          </div>
          <div className="answer small">{sim.you.bestSection.text}</div>
        </div>
      )}
      {sim.candidates.length > 1 && (
        <p className="muted small">
          Pages considered: {sim.candidates.map((c) => `${c.url.replace(/^https?:\/\/(www\.)?/, "")} (${c.score})`).join(", ")}. Set “Your page” to pick another.
        </p>
      )}
    </div>
  );
}
