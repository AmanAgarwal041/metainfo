"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAccount } from "@/lib/account";
import { useProject } from "@/lib/project";
import { flushSync } from "@/lib/sync";
import TrafficInsights from "@/components/TrafficInsights";
import { AI_KINDS, KIND_META, agentMeta, sourceMeta, type CollectorSite, type Kind, type TrafficStats } from "@/lib/traffic";
import { disconnectCollector, issueCollectorToken, loadTraffic, type TrafficView } from "@/lib/traffic-client";
import { LineChart } from "./charts";
import { IconArrow } from "./icons";
import { EmptyState, Kpi, PageHead } from "./kit";
import TrafficSetup from "./TrafficSetup";

const RANGES = [7, 30, 90] as const;
const KINDS: Kind[] = ["human", "ai_search", "ai_user", "ai_training", "search", "preview", "bot"];
const VIA: Record<string, string> = {
  "cloudflare-worker": "Cloudflare Worker route",
  "cloudflare-pages": "Cloudflare Pages middleware",
  "cloudflare-worker-wrap": "Worker wrapper",
  next: "Next.js proxy",
};

const n = (v: number) => v.toLocaleString();
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : "0%");
/** Counts are hourly, so "last seen" is an hour, not a moment. */
function seenAt(hour: number): string {
  const h = Math.floor(Date.now() / 3_600_000) - hour;
  if (h <= 0) return "This hour";
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}
/** A round top for a count axis (the chart's default domain is made for 0-100 scores). */
function countDomain(series: { values: (number | null)[] }[]): [number, number] {
  const max = Math.max(0, ...series.flatMap((x) => x.values.map((v) => v ?? 0)));
  if (max <= 4) return [0, 4];
  const step = 10 ** Math.floor(Math.log10(max));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((v) => v >= max) ?? 10 * step;
  return [0, nice];
}
const dayLabel = (day: number) => new Date(day * 86_400_000).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129_600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

export default function Traffic() {
  const account = useAccount();
  const [project] = useProject();

  if (!account.loaded) return <main className="shell"><span className="spinner" /></main>;
  if (!account.authenticated) {
    return (
      <main className="shell">
        <PageHead title="Traffic" />
        <div className="card">
          <EmptyState
            title="Sign in to see who really visits your site"
            body="A small collector at your site's edge reports page loads: people, AI crawlers and search engines. The numbers are kept in your workspace, so this page needs an account. Every other tool works without one."
            action={account.enabled ? { href: "/login?returnTo=/traffic", label: "Sign in" } : undefined}
          />
          <p className="small muted" style={{ textAlign: "center", margin: "0 0 20px" }}>
            <Link href="/traffic/guide">How setup works</Link>, start to finish.
          </p>
        </div>
      </main>
    );
  }
  if (!project.id || !project.domain) {
    return (
      <main className="shell">
        <PageHead title="Traffic" />
        <div className="stack">
        <div className="card">
          <EmptyState title="Add your site first" body="Traffic is collected per project. Create a project with your site's domain." action={{ href: "/settings#projects", label: "Set up a project" }} />
        </div>
        </div>
      </main>
    );
  }
  return <ProjectTraffic key={project.id} projectId={project.id} domain={project.domain} admin={account.workspace?.role !== "member"} />;
}

function ProjectTraffic({ projectId, domain, admin }: { projectId: string; domain: string; admin: boolean }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [data, setData] = useState<{ site: CollectorSite | null; stats?: TrafficStats } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const load = useCallback(() => {
    loadTraffic(projectId, days).then(
      (d) => {
        setError(null);
        setData(d);
      },
      (e: Error) => setError(e.message),
    );
  }, [projectId, days]);
  useEffect(load, [load]);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      await flushSync(); // the server reads the project (and its domain) from the synced workspace
      const r = await issueCollectorToken(projectId);
      setToken(r.token);
      setData((d) => ({ ...d, site: r.site }));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectCollector(projectId);
      setToken(null);
      setData({ site: null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmDisconnect(false);
    }
  };

  const site = data?.site ?? null;
  const live = !!site?.lastEventAt;

  return (
    <main className="shell">
      <PageHead
        title="Traffic"
        sub={<>Who actually visits <b>{domain}</b>: people, AI crawlers and search engines, reported by a collector at your site&apos;s edge.</>}
        actions={
          live ? (
            <>
              <div className="segmented" role="group" aria-label="Range">
                {RANGES.map((r) => (
                  <button key={r} aria-pressed={days === r} onClick={() => setDays(r)}>
                    {r} days
                  </button>
                ))}
              </div>
              <button className="btn btn-sm" onClick={load}>Refresh</button>
            </>
          ) : null
        }
      />
      <div className="stack">
        {error && <div className="notice" style={{ background: "var(--fail-soft)" }}>{error}</div>}
        {!data && !error && <span className="spinner" />}

        {data && (!live || setupOpen) && (
          <TrafficSetup
            projectId={projectId}
            domain={domain}
            site={site}
            token={token}
            admin={admin}
            live={live}
            onIssue={issue}
            onSite={(next) => setData((d) => ({ ...d, site: next }))}
            onRefresh={load}
          />
        )}

        {live && data?.stats && <Report stats={data.stats} site={site!} />}

        {site && (
          <CollectorCard
            site={site}
            admin={admin}
            busy={busy}
            showSetup={live}
            setupOpen={setupOpen}
            onToggleSetup={() => setSetupOpen((o) => !o)}
            domain={domain}
            onReplace={issue}
            confirming={confirmDisconnect}
            onDisconnect={() => (confirmDisconnect ? void disconnect() : setConfirmDisconnect(true))}
            onCancel={() => setConfirmDisconnect(false)}
          />
        )}
      </div>
    </main>
  );
}

// ------------------------------------------------------------------ collector

function CollectorCard(props: {
  site: CollectorSite;
  domain: string;
  admin: boolean;
  busy: boolean;
  showSetup: boolean;
  setupOpen: boolean;
  onToggleSetup: () => void;
  confirming: boolean;
  onReplace: () => void;
  onDisconnect: () => void;
  onCancel: () => void;
}) {
  const { site, admin, busy, confirming } = props;
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="panel-head">
          <div>
            <h3 className="section-title">Collector</h3>
            <p className="section-sub" style={{ margin: 0 }}>
              Token ending in <code>{site.tokenHint}</code>
              {site.lastEventAt ? <> · last report {ago(site.lastEventAt)}{site.lastVia ? <> via {VIA[site.lastVia] ?? site.lastVia}</> : null}</> : " · no reports yet"}
            </p>
          </div>
          <div className="spacer" />
          {props.showSetup && <button className="btn btn-sm btn-ghost" onClick={props.onToggleSetup}>{props.setupOpen ? "Hide setup" : "Reinstall or move"}</button>}
          {admin && (
            <>
              <button className="btn btn-sm" disabled={busy} onClick={props.onReplace} title="The current token stops working at once">Replace token</button>
              {confirming ? (
                <>
                  <button className="btn btn-sm" style={{ color: "var(--fail)" }} disabled={busy} onClick={props.onDisconnect}>Delete all traffic data</button>
                  <button className="btn btn-sm btn-ghost" onClick={props.onCancel}>Cancel</button>
                </>
              ) : (
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={props.onDisconnect}>Disconnect</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ report

function Report({ stats, site }: { stats: TrafficStats; site: CollectorSite }) {
  const t = stats.totals;
  const ai = AI_KINDS.reduce((s, k) => s + t[k], 0);
  const all = KINDS.reduce((s, k) => s + t[k], 0);
  const aiReferrals = stats.daily.reduce((s, d) => s + d.aiReferrals, 0);
  // The Next.js proxy reports status 0 (it runs before the page renders).
  const statusKnown = stats.agents.length ? stats.agents.some((a) => a.unknownStatus < a.hits) : site.lastVia !== "next";
  const aiAgents = stats.agents.filter((a) => AI_KINDS.includes(a.kind));
  const reportSeries = [
    ...KINDS.map((k) => ({ id: k, label: KIND_META[k].short, color: KIND_META[k].color, values: stats.daily.map((d) => d.counts[k] ?? 0) })),
    { id: "ai-referrals", label: "From AI answers", color: "var(--text-2)", values: stats.daily.map((d) => d.aiReferrals) },
  ];

  return (
    <>
      <div className="kpi-row">
        <Kpi label="People" value={n(t.human)} foot={`${pct(t.human, all)} of page loads`} />
        <Kpi label="AI crawlers" value={n(ai)} foot={`${pct(ai, all)} · ${aiAgents.length} different ${aiAgents.length === 1 ? "crawler" : "crawlers"}`} />
        <Kpi label="Search engines" value={n(t.search)} foot={`${pct(t.search, all)} of page loads`} />
        <Kpi label="Visits from AI answers" value={n(aiReferrals)} foot={`${pct(aiReferrals, t.human)} of people`} />
      </div>

      <TrafficInsights stats={stats} domain={site.domain} statusKnown={statusKnown} />

      <div className="card card-pad">
        <h3 className="section-title">Page loads by visitor</h3>
        <LineChart
          ariaLabel="Page loads per day by type of visitor"
          x={stats.daily.map((d) => dayLabel(d.day))}
          series={reportSeries}
          yDomain={countDomain(reportSeries.filter((x) => !["human", "bot", "preview"].includes(x.id)))}
          format={n}
          initiallyHidden={["human", "bot", "preview"]}
        />
      </div>

      <div className="bento">
        <div className="card card-pad b-7">
          <h3 className="section-title">Crawlers and bots</h3>
          <p className="section-sub">Recognised by user agent, so a scraper can pretend to be a known crawler.</p>
          {stats.agents.length === 0 ? (
            <p className="muted">No crawler visited in this period.</p>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Crawler</th>
                    <th>Type</th>
                    <th style={{ textAlign: "right" }}>Page loads</th>
                    {statusKnown && <th style={{ textAlign: "right" }}>Errors</th>}
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.agents.slice(0, 40).map((a) => {
                    const m = agentMeta(a.agent);
                    return (
                      <tr key={`${a.kind}:${a.agent}`}>
                        <td>
                          <b>{m.name}</b>
                          <div className="muted small">{m.operator}</div>
                        </td>
                        <td>
                          <span className="badge"><span className="dot" style={{ background: KIND_META[a.kind].color }} />{KIND_META[a.kind].short}</span>
                        </td>
                        <td style={{ textAlign: "right" }} className="mono">{n(a.hits)}</td>
                        {statusKnown && (
                          <td style={{ textAlign: "right" }} className={a.errors ? "no" : "muted"}>
                            {a.errors ? `${n(a.errors)} (${pct(a.errors, a.hits - a.unknownStatus)})` : "0"}
                          </td>
                        )}
                        <td className="small">{seenAt(a.lastHour)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card card-pad b-5">
          <h3 className="section-title">Where people came from</h3>
          {stats.sources.length === 0 ? (
            <p className="muted">No visits from people in this period.</p>
          ) : (
            <div className="list-rows">
              {stats.sources.slice(0, 15).map((s) => {
                const m = sourceMeta(s.source);
                return (
                  <div className="list-row" key={s.source}>
                    <span>{m.label}</span>
                    {m.ai && <span className="badge accent">AI answer</span>}
                    <span className="spacer" />
                    <span className="mono small">{n(s.hits)}</span>
                    <span className="muted small" style={{ width: 48, textAlign: "right" }}>{pct(s.hits, t.human)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Failures stats={stats} statusKnown={statusKnown} via={site.lastVia} domain={site.domain} />

      <div className="bento">
        <div className="card card-pad b-6">
          <h3 className="section-title">Pages AI crawlers read</h3>
          <PathList rows={stats.aiPaths.map((p) => ({ path: p.path, hits: p.hits, note: p.agents.map((a) => agentMeta(a).name).join(", ") }))} empty="No AI crawler visited in this period." />
        </div>
        <div className="card card-pad b-6">
          <h3 className="section-title">Where people from AI answers landed</h3>
          <PathList rows={stats.aiLandings.map((p) => ({ path: p.path, hits: p.hits, note: sourceMeta(p.source).label }))} empty="No clicks from ChatGPT, Perplexity, Claude, Gemini or Copilot yet." />
        </div>
      </div>
    </>
  );
}

function Failures({ stats, statusKnown, via, domain }: { stats: TrafficStats; statusKnown: boolean; via: string | null; domain: string }) {
  if (!statusKnown) {
    return (
      <div className="notice small">
        {via === "next" ? "The Next.js proxy runs before your pages render, so it can't see response statuses." : "Statuses weren't reported."} To see which crawlers get
        errors (a WAF or bot protection blocking GPTBot, say), use the Cloudflare Worker route instead (it also works in front of Cloudflare Pages).
      </div>
    );
  }
  if (!stats.failures.length) {
    return <div className="notice small">No AI or search crawler got an error in this period.</div>;
  }
  return (
    <div className="card card-pad">
      <h3 className="section-title">Crawlers that got errors</h3>
      <p className="section-sub">
        A 403 or 429 for a crawler your robots.txt allows usually means a firewall, CDN bot protection or a rate limit is blocking it. Compare with the{" "}
        <Link href={`/audit?url=${encodeURIComponent(domain)}&tab=crawlers`}>crawler access matrix</Link>.
      </p>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Crawler</th>
              <th>Status</th>
              <th>Path</th>
              <th style={{ textAlign: "right" }}>Times</th>
            </tr>
          </thead>
          <tbody>
            {stats.failures.map((f) => (
              <tr key={`${f.agent}:${f.status}:${f.path}`}>
                <td><b>{agentMeta(f.agent).name}</b> <span className="muted small">{KIND_META[f.kind].short}</span></td>
                <td className="no">HTTP {f.status}</td>
                <td className="mono small" style={{ wordBreak: "break-all" }}>{f.path}</td>
                <td style={{ textAlign: "right" }} className="mono">{n(f.hits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PathList({ rows, empty }: { rows: { path: string; hits: number; note?: string }[]; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="list-rows">
      {rows.slice(0, 15).map((r) => (
        <div className="list-row" key={`${r.path}:${r.note}`} style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div className="mono small" style={{ wordBreak: "break-all" }}>{r.path}</div>
            {r.note && <div className="muted small">{r.note}</div>}
          </div>
          <span className="spacer" />
          <span className="mono small">{n(r.hits)}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- dashboard

/** The dashboard's Traffic panel: the last 30 days at a glance, next to the audit, rankings and AI answers. */
export function TrafficOverview({ view }: { view: TrafficView }) {
  if (view.state === "unavailable" && !view.canSignIn) return null; // this server has no accounts
  const head = (sub: ReactNode) => (
    <div className="panel-head">
      <div>
        <h2 className="section-title">Traffic</h2>
        <p className="section-sub" style={{ marginBottom: 0 }}>{sub}</p>
      </div>
      <span className="spacer" />
      <Link className="btn btn-sm btn-ghost" href="/traffic">
        Traffic <IconArrow size={14} />
      </Link>
    </div>
  );
  const body = (() => {
    switch (view.state) {
      case "unavailable":
        return <p className="muted"><Link href="/login?returnTo=/dashboard">Sign in</Link> and connect a collector to see which crawlers actually visit your site, and who clicks through from AI answers. <Link href="/traffic/guide">How it works</Link>.</p>;
      case "loading":
        return <span className="spinner" />;
      case "error":
        return <p className="muted">{view.error}</p>;
      case "none":
        return <p className="muted">The audit shows which crawlers <i>could</i> reach your pages. <Link href="/traffic">Connect a collector</Link> to see which ones actually do, what they read, and whether they get errors. It takes about five minutes: <Link href="/traffic/guide">see how</Link>.</p>;
    }
    if (!view.site.lastEventAt) return <p className="muted">The collector is set up but hasn&apos;t reported yet. <Link href="/traffic">Check the setup</Link> or the <Link href="/traffic/guide#trouble">troubleshooting guide</Link>.</p>;
    const { stats } = view;
    const t = stats.totals;
    const ai = AI_KINDS.reduce((sum, k) => sum + t[k], 0);
    const all = KINDS.reduce((sum, k) => sum + t[k], 0);
    const refs = stats.daily.reduce((sum, d) => sum + d.aiReferrals, 0);
    const crawlers = stats.agents.filter((a) => AI_KINDS.includes(a.kind) || a.kind === "search").slice(0, 6);
    const overviewSeries = [
      ...(["ai_search", "ai_user", "ai_training", "search"] as Kind[]).map((k) => ({ id: k, label: KIND_META[k].short, color: KIND_META[k].color, values: stats.daily.map((d) => d.counts[k] ?? 0) })),
      { id: "ai-referrals", label: "From AI answers", color: "var(--text-2)", values: stats.daily.map((d) => d.aiReferrals) },
    ];
    return (
      <>
        <div className="kpi-row" style={{ marginBottom: 16 }}>
          <Kpi label="People" value={n(t.human)} foot={`${pct(t.human, all)} of page loads`} />
          <Kpi label="AI crawlers" value={n(ai)} foot={`${pct(ai, all)} of page loads`} />
          <Kpi label="Search engines" value={n(t.search)} foot={`${pct(t.search, all)} of page loads`} />
          <Kpi label="From AI answers" value={n(refs)} foot={`${pct(refs, t.human)} of people`} />
        </div>
        <div className="bento">
          <div className="b-8">
            <LineChart
              ariaLabel="AI crawler and search engine page loads per day"
              height={180}
              x={stats.daily.map((d) => dayLabel(d.day))}
              series={overviewSeries}
              yDomain={countDomain(overviewSeries)}
              format={n}
            />
          </div>
          <div className="b-4">
            {crawlers.length ? (
              <div className="list-rows">
                {crawlers.map((a) => (
                  <div className="list-row" key={`${a.kind}:${a.agent}`}>
                    <span className="dot" style={{ background: KIND_META[a.kind].color }} />
                    <span>{agentMeta(a.agent).name}</span>
                    <span className="spacer" />
                    {a.errors > 0 && <span className="no small">{n(a.errors)} errors</span>}
                    <span className="mono small">{n(a.hits)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">No AI or search crawler visited in the last {stats.days} days.</p>
            )}
            {stats.failures.length > 0 && (
              <p className="small" style={{ marginTop: 10 }}>
                <span className="no">{agentMeta(stats.failures[0].agent).name} got HTTP {stats.failures[0].status}</span> on <code>{stats.failures[0].path}</code>
                {stats.failures.length > 1 ? ` and ${stats.failures.length - 1} more` : ""}. <Link href="/traffic">See errors</Link>
              </p>
            )}
          </div>
        </div>
      </>
    );
  })();
  return (
    <section className="card card-pad b-12">
      {head(view.state === "ready" && view.site.lastEventAt ? `Real page loads on ${view.site.domain} over the last ${view.stats.days} days, from your collector.` : "Who actually visits your site.")}
      {body}
    </section>
  );
}
