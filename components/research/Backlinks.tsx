"use client";

import { useState } from "react";
import { useProject } from "@/lib/project";
import { fmtNum, research, toCsv } from "@/lib/research-client";
import type { Anchor, Backlink, BacklinkResearch, BacklinkSummary, LinkGapRow, ReferringDomain } from "@/lib/research-types";
import { download } from "../ui";
import { CostNote, ErrorBox, PageHeader, ProjectBar, ProviderNotice, SortTable, Spinner, useResearchStatus, type Column } from "./common";

/** DataForSEO dates look like "2019-03-01 00:00:00 +00:00", which not every browser parses. */
const date = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s.replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ?([+-]\d\d:\d\d)$/, "$1T$2$3"));
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : d.toLocaleDateString();
};

function SummaryTable({ rows, you }: { rows: BacklinkSummary[]; you: string }) {
  const metrics: { label: string; v: (s: BacklinkSummary) => number | null; fmt?: (n: number) => string }[] = [
    { label: "Domain rank (0–1000)", v: (s) => s.rank },
    { label: "Backlinks", v: (s) => s.backlinks, fmt: fmtNum },
    { label: "Referring domains", v: (s) => s.referringDomains, fmt: fmtNum },
    { label: "Referring IPs", v: (s) => s.referringIps, fmt: fmtNum },
    { label: "Dofollow share", v: (s) => (s.backlinks ? Math.round(((s.backlinks - s.nofollowBacklinks) / s.backlinks) * 100) : null), fmt: (n) => `${n}%` },
    { label: "Broken backlinks", v: (s) => s.brokenBacklinks, fmt: fmtNum },
    { label: "Spam score", v: (s) => s.spamScore },
  ];
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th />
            {rows.map((r) => (
              <th key={r.target}>
                {r.target} {r.target === you && <span className="badge accent">you</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.label}>
              <td className="muted">{m.label}</td>
              {rows.map((r) => {
                const v = m.v(r);
                return (
                  <td key={r.target} style={{ fontWeight: 700 }}>
                    {v == null ? "—" : m.fmt ? m.fmt(v) : v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Backlinks() {
  const status = useResearchStatus();
  const [project] = useProject();
  const [data, setData] = useState<BacklinkResearch | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await research<BacklinkResearch>("backlinks", { target: project.domain, competitors: project.competitors.join(",") }));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const domainCols: Column<ReferringDomain>[] = [
    { key: "d", label: "Referring domain", sort: (r) => r.domain, render: (r) => <a href={`https://${r.domain}`} target="_blank" rel="noreferrer">{r.domain}</a> },
    { key: "rank", label: "Rank", align: "right", sort: (r) => r.rank, render: (r) => r.rank ?? "—" },
    { key: "bl", label: "Backlinks", align: "right", sort: (r) => r.backlinks, render: (r) => fmtNum(r.backlinks) },
    { key: "fs", label: "First seen", sort: (r) => r.firstSeen, render: (r) => date(r.firstSeen) },
  ];
  const anchorCols: Column<Anchor>[] = [
    { key: "a", label: "Anchor text", sort: (r) => r.anchor, render: (r) => r.anchor || <i className="muted">(empty / image)</i> },
    { key: "rd", label: "Ref. domains", align: "right", sort: (r) => r.referringDomains, render: (r) => fmtNum(r.referringDomains) },
    { key: "bl", label: "Backlinks", align: "right", sort: (r) => r.backlinks, render: (r) => fmtNum(r.backlinks) },
  ];
  const linkCols: Column<Backlink>[] = [
    {
      key: "from",
      label: "From",
      sort: (r) => r.domainFrom,
      render: (r) => (
        <div style={{ maxWidth: 360 }}>
          <a href={r.urlFrom} target="_blank" rel="noreferrer" className="break small">{r.urlFrom}</a>
        </div>
      ),
    },
    { key: "anchor", label: "Anchor", render: (r) => <span className="small">{r.anchor || <i className="muted">(none)</i>}</span> },
    { key: "to", label: "To", render: (r) => <span className="break small muted">{r.urlTo.replace(/^https?:\/\//, "")}</span> },
    { key: "follow", label: "Type", align: "center", sort: (r) => Number(r.dofollow), render: (r) => (r.dofollow ? <span className="badge gain">dofollow</span> : <span className="badge">nofollow</span>) },
    { key: "rank", label: "DR", align: "right", sort: (r) => r.domainRank, render: (r) => r.domainRank ?? "—", title: "Linking domain's rank" },
    { key: "fs", label: "First seen", sort: (r) => r.firstSeen, render: (r) => <span className="small">{date(r.firstSeen)} {r.isNew && <span className="badge gain">new</span>}{r.isLost && <span className="badge sev-critical">lost</span>}</span> },
  ];
  const gapCols = (comps: string[]): Column<LinkGapRow>[] => [
    { key: "d", label: "Domain", sort: (r) => r.domain, render: (r) => <a href={`https://${r.domain}`} target="_blank" rel="noreferrer">{r.domain}</a> },
    { key: "rank", label: "Rank", align: "right", sort: (r) => r.rank, render: (r) => r.rank ?? "—" },
    { key: "n", label: "Links to # competitors", align: "center", sort: (r) => Object.keys(r.linksTo).length, render: (r) => Object.keys(r.linksTo).length },
    ...comps.map((c): Column<LinkGapRow> => ({ key: c, label: c, align: "right", sort: (r) => r.linksTo[c] ?? 0, render: (r) => (r.linksTo[c] ? fmtNum(r.linksTo[c]) : <span className="na">—</span>) })),
  ];

  return (
    <main className="shell">
      <PageHeader
        title="Backlinks"
        sub="Your backlink profile next to your competitors': who links to you, with what anchor text, what's new, and which sites link to competitors but not to you."
      />
      <ProjectBar />
      <div className="stack" style={{ marginTop: 16 }}>
        {status && !status.dataforseo && (
          <ProviderNotice
            unlocks="backlink profiles, anchors and the link gap"
            free={
              <>
                No reliable source of backlink data is free. Google Search Console (Links report) lists your own backlinks at no cost. DataForSEO&apos;s Backlinks API may also need enabling in their dashboard.
              </>
            }
          />
        )}
        {status?.dataforseo && (
          <div className="card card-pad row">
            <div>
              <b>{project.domain || "Set your site above"}</b>
              {project.competitors.length > 0 && <span className="muted"> vs {project.competitors.join(", ")}</span>}
            </div>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={!project.domain || loading} onClick={run}>
              {loading ? "Analysing…" : "Analyse backlinks"}
            </button>
          </div>
        )}
        {loading && <Spinner label="Fetching backlink data…" />}
        <ErrorBox error={error} onRetry={run} />
        {data && !loading && (
          <>
            <div className="row">
              {data.warnings.map((w) => (
                <div key={w} className="notice small">{w}</div>
              ))}
              <span className="spacer" />
              <CostNote cost={data.cost} cached={data.cached} />
            </div>
            <div className="card card-pad">
              <h3 className="section-title">Profile comparison</h3>
              <SummaryTable rows={[data.summary, ...data.competitors]} you={data.target} />
            </div>
            {data.linkGap.length > 0 && (
              <div className="card card-pad">
                <div className="row">
                  <div>
                    <h3 className="section-title">Link gap ({data.linkGap.length})</h3>
                    <p className="section-sub" style={{ marginBottom: 0 }}>Sites that link to your competitors but not to you. The warmest outreach targets come first.</p>
                  </div>
                  <span className="spacer" />
                  <button className="btn btn-sm" onClick={() => download("link-gap.csv", toCsv(data.linkGap.map((r) => ({ domain: r.domain, rank: r.rank, ...r.linksTo }))), "text/csv")}>
                    Export CSV
                  </button>
                </div>
                <div style={{ marginTop: 10 }}>
                  <SortTable rows={data.linkGap} columns={gapCols(data.competitors.map((c) => c.target))} rowKey={(r) => r.domain} initialSort={{ key: "n", dir: "desc" }} />
                </div>
              </div>
            )}
            <div className="two-col" style={{ alignItems: "start" }}>
              <div className="card card-pad">
                <h3 className="section-title">Top referring domains</h3>
                <SortTable rows={data.referringDomains} columns={domainCols} rowKey={(r) => r.domain} initialSort={{ key: "rank", dir: "desc" }} pageSize={20} />
              </div>
              <div className="card card-pad">
                <h3 className="section-title">Anchor text</h3>
                <SortTable rows={data.anchors} columns={anchorCols} rowKey={(r) => r.anchor} initialSort={{ key: "rd", dir: "desc" }} pageSize={20} />
              </div>
            </div>
            <div className="card card-pad">
              <div className="row">
                <h3 className="section-title">Newest backlinks (one per domain)</h3>
                <span className="spacer" />
                <button className="btn btn-sm" onClick={() => download("backlinks.csv", toCsv(data.recent.map((r) => ({ from: r.urlFrom, to: r.urlTo, anchor: r.anchor, dofollow: r.dofollow, domain_rank: r.domainRank, first_seen: r.firstSeen }))), "text/csv")}>
                  Export CSV
                </button>
              </div>
              <SortTable rows={data.recent} columns={linkCols} rowKey={(r) => r.urlFrom + r.urlTo} pageSize={25} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
