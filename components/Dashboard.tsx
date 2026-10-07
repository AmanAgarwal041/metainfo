"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadRuns, rates, type AiRun } from "@/lib/ai-visibility";
import { diffSnapshots, loadSites, siteForDomain, type TrackedSite } from "@/lib/history";
import { createProject, useProject, useProjects } from "@/lib/project";
import { rankHistory, rankKey } from "@/lib/rank-history";
import { AI_ENGINES, locationByCode } from "@/lib/research-types";
import { PLATFORM_META, PLATFORMS } from "@/lib/types";
import { LineChart, Distribution } from "./charts";
import { IconArrow, IconCheck } from "./icons";
import { Delta, EmptyState, Kpi, PageHead } from "./kit";
import { useResearchStatus } from "./research/common";
import { scoreColor, SeverityBadge } from "./ui";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function NewProject() {
  const [domain, setDomain] = useState("");
  return (
    <main className="shell">
      <div className="card" style={{ maxWidth: 640, margin: "40px auto" }}>
        <EmptyState
          title="Start with your site"
          body="A project holds your domain, competitors, tracked keywords and AI prompts. Everything you run is saved to it so you can see progress over time."
        />
        <form
          className="scan-row"
          style={{ padding: "0 24px 28px" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (domain.trim()) createProject({ domain });
          }}
        >
          <input className="input" placeholder="yoursite.com" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Your domain" autoFocus />
          <button className="btn btn-primary" type="submit">
            Create project
          </button>
        </form>
      </div>
    </main>
  );
}

export default function Dashboard() {
  const { projects } = useProjects();
  const [project] = useProject();
  const status = useResearchStatus();
  const [sites, setSites] = useState<Record<string, TrackedSite>>({});
  const [runs, setRuns] = useState<AiRun[]>([]);
  const [mcpSeen, setMcpSeen] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate browser-stored history for the active project */
    setSites(loadSites());
    setRuns(project.id ? loadRuns(project.id) : []);
    try {
      setMcpSeen(localStorage.getItem("metainfo:mcp-copied") === "1");
    } catch {
      /* storage blocked */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [project.id]);

  const site = siteForDomain(sites, project.domain);
  const snaps = site?.snapshots ?? [];
  const last = snaps.at(-1);
  const prev = snaps.at(-2);

  const ranks = useMemo(() => {
    if (typeof window === "undefined") return [];
    return project.keywords.map((k) => {
      const h = rankHistory(rankKey(k, project.location, "desktop"));
      const cur = h.at(-1)?.positions[project.domain] ?? null;
      const before = h.at(-2)?.positions[project.domain] ?? null;
      return { keyword: k, pos: cur, change: cur != null && before != null ? before - cur : 0, checked: h.length > 0 };
    });
    // sites changes after mount; recompute then so rank storage is read client-side
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.keywords, project.location, project.domain, sites]);

  if (!projects.length) return <NewProject />;

  const checked = ranks.filter((r) => r.checked);
  const ranking = checked.filter((r) => r.pos != null);
  const avgPos = ranking.length ? Math.round((ranking.reduce((n, r) => n + r.pos!, 0) / ranking.length) * 10) / 10 : null;
  const top10 = ranking.filter((r) => r.pos! <= 10).length;
  const lastRun = runs.at(-1);
  const aiRates = lastRun ? rates(lastRun.observations) : null;
  const aiReady = last ? Math.round(((last.scores.chatgpt ?? 0) + (last.scores.perplexity ?? 0) + (last.scores.claude ?? 0) + (last.scores.gemini ?? 0)) / 4) : null;
  const diff = last && prev ? diffSnapshots(prev, last) : null;

  const steps = [
    { done: !!project.domain, label: "Set your domain", href: "/settings#projects" },
    { done: !!site, label: "Audit your site", href: project.domain ? `/audit?url=${encodeURIComponent(`https://${project.domain}/`)}` : "/audit" },
    { done: project.competitors.length > 0, label: "Add competitors", href: "/competitors" },
    { done: project.keywords.length > 0, label: "Track keywords", href: "/rankings" },
    { done: project.prompts.length > 0, label: "Add AI prompts to monitor", href: "/ai-visibility" },
    { done: !!status?.dataforseo, label: "Connect DataForSEO for volumes, rankings and AI answers", href: "/settings#data" },
    { done: mcpSeen, label: "Connect your AI agent over MCP", href: "/settings#mcp" },
  ];
  const remaining = steps.filter((s) => !s.done).length;

  const buckets = [
    { label: "Top 3", value: ranking.filter((r) => r.pos! <= 3).length, color: "#1c5cab" },
    { label: "4 to 10", value: ranking.filter((r) => r.pos! > 3 && r.pos! <= 10).length, color: "#2a78d6" },
    { label: "11 to 20", value: ranking.filter((r) => r.pos! > 10 && r.pos! <= 20).length, color: "#5598e7" },
    { label: "21 and below", value: ranking.filter((r) => r.pos! > 20).length, color: "#86b6ef" },
    { label: "Not ranking", value: checked.length - ranking.length, color: "var(--surface-3)" },
  ];
  const movers = [...ranking].filter((r) => r.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5);
  const topTasks = site?.latest?.plan.flatMap((p) => p.tasks).slice(0, 5) ?? [];

  return (
    <main className="shell">
      <PageHead
        title={project.name}
        sub={
          <>
            {project.domain || "No domain yet"} <span className="muted">in {locationByCode(project.location).name}</span>
          </>
        }
        actions={
          project.domain ? (
            <Link className="btn btn-primary" href={`/audit?url=${encodeURIComponent(site?.url ?? `https://${project.domain}/`)}`}>
              {site ? "Re-audit site" : "Audit site"}
            </Link>
          ) : null
        }
      />

      <div className="stack">
        <div className="kpi-row">
          <Kpi
            label="Audit score"
            value={last ? last.overall : "n/a"}
            tone={last ? scoreColor(last.overall) : "var(--text-3)"}
            foot={last ? (prev ? <><Delta value={last.overall - prev.overall} /> <span className="muted">since {fmtDate(prev.scannedAt)}</span></> : `First audit on ${fmtDate(last.scannedAt)}`) : "Not audited yet"}
          />
          <Kpi label="AI search readiness" value={aiReady ?? "n/a"} tone={aiReady != null ? scoreColor(aiReady) : "var(--text-3)"} foot="ChatGPT, Perplexity, Claude and Gemini scores" />
          <Kpi label="Average position" value={avgPos ?? "n/a"} foot={checked.length ? `${top10} of ${checked.length} keywords in the top 10` : "No rank checks yet"} />
          <Kpi
            label="AI answer mentions"
            value={aiRates ? `${aiRates.mentionRate}%` : "n/a"}
            foot={aiRates ? `Cited in ${aiRates.citationRate}% of ${aiRates.answered} answers` : "No AI visibility runs yet"}
          />
        </div>

        <div className="bento">
          <section className="card card-pad b-8">
            <div className="panel-head">
              <div>
                <h2 className="section-title">Visibility score over time</h2>
                <p className="section-sub" style={{ marginBottom: 0 }}>Audit scores per platform for {site ? site.key : "your site"}.</p>
              </div>
            </div>
            {snaps.length ? (
              <LineChart
                ariaLabel="Audit scores over time"
                x={snaps.map((s) => fmtDate(s.scannedAt))}
                yDomain={[0, 100]}
                series={[
                  { id: "overall", label: "Overall", color: "var(--text)", values: snaps.map((s) => s.overall) },
                  ...PLATFORMS.map((p) => ({ id: p, label: PLATFORM_META[p].short, color: PLATFORM_META[p].color, values: snaps.map((s) => s.scores[p] ?? null) })),
                ]}
                initiallyHidden={["bing", "gemini", "social"]}
              />
            ) : (
              <EmptyState title="No audits yet" body="Run the first audit to start the trend line. Every re-audit adds a point." action={{ href: project.domain ? `/audit?url=${encodeURIComponent(`https://${project.domain}/`)}` : "/audit", label: "Audit site" }} />
            )}
            {snaps.length === 1 && <p className="muted small" style={{ marginTop: 8 }}>One audit so far. Re-audit after shipping fixes to draw the trend.</p>}
            {diff && (diff.fixed.length > 0 || diff.regressed.length > 0) && (
              <p className="small" style={{ marginTop: 12 }}>
                {diff.fixed.length > 0 && <span style={{ color: "var(--pass)" }}>Fixed since last audit: {diff.fixed.map((id) => site?.latest?.titles[id] ?? id).join(", ")}. </span>}
                {diff.regressed.length > 0 && <span style={{ color: "var(--fail)" }}>Regressed: {diff.regressed.map((id) => site?.latest?.titles[id] ?? id).join(", ")}.</span>}
              </p>
            )}
          </section>

          <section className="card card-pad b-4">
            {remaining > 0 ? (
              <>
                <h2 className="section-title">Set up {project.name}</h2>
                <p className="section-sub">{steps.length - remaining} of {steps.length} done</p>
                <ul className="checklist">
                  {steps.map((s) => (
                    <li key={s.label}>
                      <span className={`check-dot ${s.done ? "on" : ""}`}>{s.done && <IconCheck size={11} />}</span>
                      {s.done ? <span className="muted">{s.label}</span> : <Link href={s.href}>{s.label}</Link>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h2 className="section-title">Health by area</h2>
                <div style={{ marginTop: 8 }}>
                  {site?.latest?.categories.map((c) => (
                    <div className="cat-row" key={c.category} style={{ gridTemplateColumns: "1fr 80px 32px" }}>
                      <span className="small">{c.label}</span>
                      <div className="bar"><span style={{ width: `${c.score}%`, background: scoreColor(c.score) }} /></div>
                      <b className="small" style={{ textAlign: "right" }}>{c.score}</b>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="card card-pad b-6">
            <div className="panel-head">
              <h2 className="section-title">Next fixes</h2>
              <span className="spacer" />
              {site && (
                <Link className="btn btn-sm btn-ghost" href={`/audit?url=${encodeURIComponent(site.url)}`}>
                  Fix plan <IconArrow size={14} />
                </Link>
              )}
            </div>
            {topTasks.length ? (
              <div className="list-rows">
                {topTasks.map((t) => (
                  <div className="list-row" key={t.checkId}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{t.title}</div>
                      <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.recommendation}</div>
                    </div>
                    <SeverityBadge severity={t.severity} />
                    <span className="badge gain">+{t.totalGain.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">{site ? "Nothing to fix. Every check passes." : "Audit your site to get a prioritised fix list."}</p>
            )}
          </section>

          <section className="card card-pad b-6">
            <div className="panel-head">
              <h2 className="section-title">Rankings</h2>
              <span className="spacer" />
              <Link className="btn btn-sm btn-ghost" href="/rankings">
                Rank tracking <IconArrow size={14} />
              </Link>
            </div>
            {checked.length ? (
              <>
                <Distribution parts={buckets} ariaLabel="Keyword position distribution" />
                {movers.length > 0 && (
                  <div className="list-rows" style={{ marginTop: 14 }}>
                    {movers.map((m) => (
                      <div className="list-row" key={m.keyword}>
                        <span style={{ flex: 1 }}>{m.keyword}</span>
                        <b>#{m.pos}</b>
                        <Delta value={m.change} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="muted">{project.keywords.length ? "Run a rank check to see where you stand." : "Track keywords to see positions and movement here."}</p>
            )}
          </section>

          <section className="card card-pad b-12">
            <div className="panel-head">
              <div>
                <h2 className="section-title">AI answers</h2>
                <p className="section-sub" style={{ marginBottom: 0 }}>
                  How often each engine mentions or cites {project.brand || project.domain} for your prompts{lastRun ? `, as of ${fmtDate(lastRun.at)}` : ""}.
                </p>
              </div>
              <span className="spacer" />
              <Link className="btn btn-sm btn-ghost" href="/ai-visibility">
                AI visibility <IconArrow size={14} />
              </Link>
            </div>
            {lastRun ? (
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>Engine</th>
                      <th>Mentioned</th>
                      <th style={{ width: "40%" }} />
                      <th style={{ textAlign: "right" }}>Cited</th>
                      <th style={{ textAlign: "right" }}>Answers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {AI_ENGINES.map((e) => {
                      const r = rates(lastRun.observations.filter((o) => o.engine === e.id));
                      if (!r.answered) return null;
                      return (
                        <tr key={e.id}>
                          <td>
                            <span className="row" style={{ gap: 8 }}>
                              <span className="dot" style={{ background: e.color }} />
                              {e.label}
                            </span>
                          </td>
                          <td><b>{r.mentionRate}%</b></td>
                          <td style={{ verticalAlign: "middle" }}>
                            <div className="bar"><span style={{ width: `${r.mentionRate}%`, background: "var(--accent)" }} /></div>
                          </td>
                          <td style={{ textAlign: "right" }}>{r.citationRate}%</td>
                          <td style={{ textAlign: "right" }} className="muted">{r.answered}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Add the questions your customers ask, then check whether ChatGPT, Claude, Perplexity, Gemini and Google AI Overviews mention you.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
