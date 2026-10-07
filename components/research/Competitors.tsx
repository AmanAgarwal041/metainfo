"use client";

import { useState } from "react";
import { scanMany, type PageScan } from "@/lib/engine";
import { useProject } from "@/lib/project";
import { fmtNum, research } from "@/lib/research-client";
import type { CompetitorResearch, CompetitorRow } from "@/lib/research-types";
import { PLATFORM_META, PLATFORMS, type Report } from "@/lib/types";
import { hostOf, scoreColor } from "../ui";
import { CostNote, ErrorBox, PageHeader, ProjectBar, ProviderNotice, SortTable, Spinner, useResearchStatus, type Column } from "./common";

function OrganicCompetitors() {
  const [project, update] = useProject();
  const [data, setData] = useState<CompetitorResearch | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await research<CompetitorResearch>("competitors", { domain: project.domain, loc: project.location }));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const columns: Column<CompetitorRow>[] = [
    { key: "domain", label: "Domain", sort: (r) => r.domain, render: (r) => <a href={`https://${r.domain}`} target="_blank" rel="noreferrer">{r.domain}</a> },
    { key: "common", label: "Common keywords", align: "right", sort: (r) => r.commonKeywords, render: (r) => <b>{fmtNum(r.commonKeywords)}</b> },
    { key: "avg", label: "Avg. position", align: "right", sort: (r) => r.avgPosition, render: (r) => r.avgPosition ?? "-" },
    { key: "kw", label: "Their keywords", align: "right", sort: (r) => r.organic.keywords, render: (r) => fmtNum(r.organic.keywords) },
    { key: "top3", label: "Top 3", align: "right", sort: (r) => r.organic.pos1 + r.organic.pos2_3, render: (r) => fmtNum(r.organic.pos1 + r.organic.pos2_3) },
    { key: "traffic", label: "Est. traffic", align: "right", sort: (r) => r.organic.traffic, render: (r) => fmtNum(r.organic.traffic), title: "Estimated monthly organic visits" },
    {
      key: "add",
      label: "",
      align: "right",
      render: (r) =>
        project.competitors.includes(r.domain) ? (
          <span className="badge accent">tracked</span>
        ) : (
          <button className="btn btn-sm" disabled={project.competitors.length >= 5} onClick={() => update({ competitors: [...project.competitors, r.domain] })}>
            + Track
          </button>
        ),
    },
  ];

  return (
    <div className="card card-pad">
      <div className="row">
        <div>
          <h3 className="section-title">Organic competitors</h3>
          <p className="section-sub" style={{ marginBottom: 0 }}>Domains that rank for the same Google keywords as you, by overlap.</p>
        </div>
        <span className="spacer" />
        <button className="btn btn-primary" disabled={!project.domain || loading} onClick={run}>
          {loading ? "Finding…" : "Find competitors"}
        </button>
      </div>
      <div style={{ marginTop: 14 }} className="stack">
        {loading && <Spinner label="Finding domains that compete with yours…" />}
        <ErrorBox error={error} onRetry={run} />
        {data && !loading && (
          <>
            {data.overview && (
              <div className="stat-tiles">
                <div className="stat">
                  <div className="v">{fmtNum(data.overview.keywords)}</div>
                  <div className="l">{data.domain}: ranking keywords</div>
                </div>
                <div className="stat">
                  <div className="v">{fmtNum(data.overview.traffic)}</div>
                  <div className="l">Est. monthly organic traffic</div>
                </div>
                <div className="stat">
                  <div className="v">{fmtNum(data.overview.pos1 + data.overview.pos2_3)}</div>
                  <div className="l">Keywords in top 3</div>
                </div>
                <div className="stat">
                  <div className="v">{fmtNum(data.overview.pos4_10)}</div>
                  <div className="l">Keywords at #4-10</div>
                </div>
              </div>
            )}
            <div>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="spacer" />
                <CostNote cost={data.cost} cached={data.cached} />
              </div>
              <SortTable rows={data.competitors} columns={columns} rowKey={(r) => r.domain} initialSort={{ key: "common", dir: "desc" }} empty="No competitors found for this market." />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const METRICS: { label: string; value: (r: Report) => string | number; score?: (r: Report) => number; better?: "high" | "low" }[] = [
  { label: "Overall score", value: (r) => r.summary.overall, score: (r) => r.summary.overall, better: "high" },
  ...PLATFORMS.map((p) => ({
    label: PLATFORM_META[p].label,
    value: (r: Report) => r.scores.find((s) => s.platform === p)?.score ?? 0,
    score: (r: Report) => r.scores.find((s) => s.platform === p)?.score ?? 0,
    better: "high" as const,
  })),
  { label: "Words (server-rendered)", value: (r) => r.page.wordCount.toLocaleString(), better: "high" },
  { label: "Structured data types", value: (r) => [...new Set(r.page.jsonLd.flatMap((b) => b.types))].join(", ") || "none" },
  { label: "AI crawlers blocked", value: (r) => r.crawlers.filter((c) => !c.allowed && c.purpose !== "training").length, better: "low" },
  { label: "llms.txt", value: (r) => (r.llms?.found ? "yes" : "no") },
  { label: "Sitemap URLs", value: (r) => (r.sitemap?.found ? r.sitemap.urlCount.toLocaleString() : "none") },
  { label: "Time to first byte", value: (r) => (r.ttfbMs != null ? `${r.ttfbMs} ms` : "-") },
  { label: "HTML size", value: (r) => `${Math.round(r.page.htmlBytes / 1024)} KB` },
  { label: "Failed / warnings", value: (r) => `${r.summary.failed} / ${r.summary.warnings}` },
];

function AuditComparison() {
  const [project] = useProject();
  const [scans, setScans] = useState<PageScan[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const sites = [project.domain, ...project.competitors].filter(Boolean);

  const run = async () => {
    setScans(null);
    setProgress(`0/${sites.length}`);
    const res = await scanMany(
      sites.map((d) => `https://${d}/`),
      (done) => setProgress(`${done}/${sites.length}`),
    );
    setScans(res);
    setProgress(null);
  };

  const mine = scans?.[0]?.report;
  const ok = scans?.filter((s) => s.report) ?? [];
  // Checks at least one competitor passes while you fail or warn.
  const theyDo = mine
    ? mine.checks
        .filter((c) => c.status === "fail" || c.status === "warn")
        .map((c) => ({
          check: c,
          passers: ok.slice(1).filter((s) => s.report!.checks.find((x) => x.id === c.id)?.status === "pass").map((s) => hostOf(s.url)),
        }))
        .filter((x) => x.passers.length > 0)
        .sort((a, b) => b.passers.length - a.passers.length)
    : [];

  return (
    <div className="card card-pad">
      <div className="row">
        <div>
          <h3 className="section-title">
            Audit comparison <span className="badge gain">free</span>
          </h3>
          <p className="section-sub" style={{ marginBottom: 0 }}>
            Runs the full SEO and AI-visibility audit on your homepage and each competitor&apos;s, side by side.
          </p>
        </div>
        <span className="spacer" />
        <button className="btn btn-primary" disabled={sites.length < 2 || !!progress} onClick={run}>
          {progress ? `Scanning ${progress}…` : "Compare sites"}
        </button>
      </div>
      {sites.length < 2 && <p className="muted small" style={{ marginTop: 10 }}>Set your site and at least one competitor above.</p>}
      {scans && (
        <div className="stack" style={{ marginTop: 16 }}>
          {scans
            .filter((s) => s.error)
            .map((s) => (
              <div key={s.url} className="error-box">
                {s.url}: {s.error}
              </div>
            ))}
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th />
                  {scans.map((s, i) => (
                    <th key={s.url}>
                      {hostOf(s.url)} {i === 0 && <span className="badge accent">you</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m) => {
                  const nums = ok.map((s) => m.score?.(s.report!) ?? null).filter((n): n is number => n != null);
                  const best = nums.length ? Math.max(...nums) : null;
                  return (
                    <tr key={m.label}>
                      <td className="muted">{m.label}</td>
                      {scans.map((s) => (
                        <td key={s.url} style={{ fontWeight: m.score ? 700 : 500, color: m.score && s.report ? scoreColor(m.score(s.report)) : undefined }}>
                          {s.report ? m.value(s.report) : <span className="na">error</span>}
                          {m.score && s.report && best != null && m.score(s.report) === best && ok.length > 1 && <span className="small"> ★</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {mine && (
            <div>
              <h3 className="section-title">They do it, you don&apos;t ({theyDo.length})</h3>
              <p className="section-sub">Checks at least one competitor passes while your homepage fails or warns. The easiest wins to copy.</p>
              {theyDo.length === 0 ? (
                <p className="muted">Nothing. You match or beat every competitor on every check.</p>
              ) : (
                <div className="card">
                  {theyDo.map(({ check, passers }) => (
                    <div className="task" key={check.id}>
                      <div>
                        <span className="task-title">{check.title}</span>
                        <div className="task-rec">
                          You: {check.finding}
                        </div>
                        <div className="task-meta">
                          <span className={`badge sev-${check.severity}`}>{check.severity}</span>
                          {passers.map((p) => (
                            <span key={p} className="badge gain">✓ {p}</span>
                          ))}
                        </div>
                      </div>
                      <a className="btn btn-sm" href={`/audit?url=${encodeURIComponent(scans[0].url)}`}>
                        Open audit
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Competitors() {
  const status = useResearchStatus();
  return (
    <main className="shell">
      <PageHeader
        title="Competitor analysis"
        sub="See who you compete with in Google, how much organic traffic they get, and exactly which SEO and AI-visibility checks they pass that you don't."
      />
      <ProjectBar />
      <div className="stack" style={{ marginTop: 16 }}>
        {status?.dataforseo ? (
          <OrganicCompetitors />
        ) : (
          status && <ProviderNotice unlocks="organic competitor discovery and traffic estimates" free={<>The audit comparison below is free and works now.</>} />
        )}
        <AuditComparison />
      </div>
    </main>
  );
}
