"use client";

import Link from "next/link";
import { useState } from "react";
import { AI_KINDS, agentMeta, KIND_META, sourceMeta, type TrafficStats } from "@/lib/traffic";
import { useTraffic } from "@/lib/traffic-client";
import { HBars, LineChart } from "../charts";
import { Delta, Kpi } from "../kit";
import { DomainCell, GroupHead, Pager, SearchBox, Tile, useSearchPage } from "./tables";

// Bot and referral traffic: whether AI answers send people to the site and how often AI crawlers read it, from the
// project's traffic collector (the same data as the Traffic page, focused on AI).

const dayLabel = (d: number) => new Date(d * 86_400_000).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export default function TrafficImpact({ projectId, domain }: { projectId: string; domain: string }) {
  const [days, setDays] = useState(30);
  const view = useTraffic(projectId || null, days);

  if (view.state !== "ready") {
    return (
      <section className="card card-pad">
        {view.state === "loading" ? (
          <p className="row small muted"><span className="spinner" /> Loading traffic…</p>
        ) : view.state === "error" ? (
          <p className="small" style={{ color: "var(--fail)" }}>{view.error}</p>
        ) : (
          <>
            <h2 className="section-title">Connect traffic to see AI referrals and crawls</h2>
            <p className="section-sub" style={{ marginBottom: 12 }}>
              {view.state === "unavailable"
                ? "Traffic lives in a signed-in workspace. Sign in, then add the collector to your site."
                : "Add the collector to your site to see which AI answers send people to you and which pages AI crawlers read."}
            </p>
            <Link className="btn btn-primary" href="/traffic">Set up traffic</Link>
          </>
        )}
      </section>
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 10 }}>
        <div className="segmented" role="group" aria-label="Range">
          {[7, 30, 90].map((d) => (
            <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>
          ))}
        </div>
        <span className="spacer" />
        <Link className="small" href="/traffic">Open Traffic</Link>
      </div>
      <TrafficPanels stats={view.stats} domain={domain} days={days} />
    </div>
  );
}

/** AI referral and crawler KPIs, charts and page tables for one period of traffic stats. */
export function TrafficPanels({ stats, domain, days }: { stats: TrafficStats; domain: string; days: number }) {
  const x = stats.daily.map((d) => dayLabel(d.day));
  const aiSources = stats.sources.filter((s) => sourceMeta(s.source).ai);
  const referrals = stats.daily.reduce((n, d) => n + d.aiReferrals, 0);
  const crawls = AI_KINDS.reduce((n, k) => n + (stats.totals[k] ?? 0), 0);
  const crawlsBefore = AI_KINDS.reduce((n, k) => n + (stats.previous.totals[k] ?? 0), 0);
  const people = stats.totals.human ?? 0;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="kpi-row">
        <Kpi label="AI referrals" value={referrals} foot={<>vs previous {days} days <Delta value={referrals - stats.previous.aiReferrals} /></>} />
        <Kpi label="Share of visits from AI" value={people ? `${Math.round((referrals / people) * 1000) / 10}%` : "–"} foot={`of ${people} visits by people`} />
        <Kpi label="AI crawler hits" value={crawls} foot={<>vs previous {days} days <Delta value={crawls - crawlsBefore} /></>} />
        <Kpi label="AI sources" value={aiSources.length} foot={aiSources.map((s) => sourceMeta(s.source).label).slice(0, 3).join(", ") || "none yet"} />
      </div>

      <div className="bento">
        <div className="b-6 stack" style={{ gap: 16 }}>
          <GroupHead title="Overall AI referral traffic" sub="Visits from people who clicked a link in ChatGPT, Perplexity, Gemini and other AI answers." />
          <Tile title="AI referrals by day">
            <LineChart ariaLabel="AI referral visits per day" x={x} series={[{ id: "ai", label: "AI referrals", color: "var(--series-1)", values: stats.daily.map((d) => d.aiReferrals) }]} />
          </Tile>
          <Tile title="By AI source">
            {aiSources.length ? <HBars items={aiSources.map((s) => ({ label: sourceMeta(s.source).label, value: s.hits }))} /> : <p className="muted small">No visits from AI answers in this period.</p>}
          </Tile>
        </div>
        <div className="b-6 stack" style={{ gap: 16 }}>
          <GroupHead title="AI referral traffic by URL" sub="Which pages people land on from AI answers." />
          <Landings rows={stats.aiLandings} domain={domain} />
        </div>
        <div className="b-6 stack" style={{ gap: 16 }}>
          <GroupHead title="Overall AI bot crawl activity" sub="How often AI crawlers read your site each day." />
          <Tile title="AI bot crawl visits over time">
            <LineChart ariaLabel="AI crawler hits per day by kind" x={x} series={AI_KINDS.map((k) => ({ id: k, label: KIND_META[k].short, color: KIND_META[k].color, values: stats.daily.map((d) => d.counts[k] ?? 0) }))} />
          </Tile>
        </div>
        <div className="b-6 stack" style={{ gap: 16 }}>
          <GroupHead title="AI bot crawl activity by URL" sub="The pages AI crawlers read most, and which crawlers." />
          <Crawled rows={stats.aiPaths} domain={domain} />
        </div>
      </div>
    </div>
  );
}

function Landings({ rows, domain }: { rows: { path: string; source: string; hits: number }[]; domain: string }) {
  const t = useSearchPage(rows, (r) => r.path, 6);
  return (
    <Tile title="Top landing pages">
      <SearchBox value={t.q} onChange={t.setQ} placeholder="Search by URL" />
      {rows.length ? (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>URL</th>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>Sessions</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={`${r.path}|${r.source}`}>
                  <td style={{ maxWidth: 280 }}><DomainCell domain={domain} url={`https://${domain}${r.path}`} sub={r.path} /></td>
                  <td className="small">{sourceMeta(r.source).label}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{r.hits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">No landings from AI answers in this period.</p>
      )}
      <Pager page={t.page} pages={t.pages} total={t.total} onPage={t.setPage} />
    </Tile>
  );
}

function Crawled({ rows, domain }: { rows: { path: string; hits: number; agents: string[] }[]; domain: string }) {
  const t = useSearchPage(rows, (r) => r.path, 6);
  return (
    <Tile title="Top URLs">
      <SearchBox value={t.q} onChange={t.setQ} placeholder="Search by URL" />
      {rows.length ? (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>URL</th>
                <th>Crawlers</th>
                <th style={{ textAlign: "right" }}>Hits</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.path}>
                  <td style={{ maxWidth: 280 }}><DomainCell domain={domain} url={`https://${domain}${r.path}`} sub={r.path} /></td>
                  <td className="small">{r.agents.map((a) => agentMeta(a).name).slice(0, 3).join(", ")}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{r.hits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">No AI crawler hits in this period.</p>
      )}
      <Pager page={t.page} pages={t.pages} total={t.total} onPage={t.setPage} />
    </Tile>
  );
}
