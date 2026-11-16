"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAccount } from "@/lib/account";
import { useProject } from "@/lib/project";
import { flushSync } from "@/lib/sync";
import { AI_KINDS, KIND_META, agentMeta, sourceMeta, type CollectorSite, type Kind, type TrafficStats } from "@/lib/traffic";
import { COLLECTOR_RAW, COLLECTOR_REPO, HOSTED_ENDPOINT, disconnectCollector, issueCollectorToken, loadTraffic, type TrafficView } from "@/lib/traffic-client";
import { LineChart } from "./charts";
import { IconArrow } from "./icons";
import { EmptyState, Kpi, PageHead } from "./kit";
import { CodeBlock, CopyButton } from "./ui";

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
        </div>
      </main>
    );
  }
  if (!project.id || !project.domain) {
    return (
      <main className="shell">
        <PageHead title="Traffic" />
        <div className="card">
          <EmptyState title="Add your site first" body="Traffic is collected per project. Create a project with your site's domain." action={{ href: "/settings#projects", label: "Set up a project" }} />
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
    } catch (e) {
      setError((e as Error).message);
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
          live && (
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
          )
        }
      />
      <div className="stack">
        {error && <div className="notice" style={{ background: "var(--fail-soft)" }}>{error}</div>}
        {!data && !error && <span className="spinner" />}

        {token && site && <TokenCard token={token} site={site} />}

        {data && !site && <Connect admin={admin} busy={busy} onIssue={issue} />}

        {site && !live && !token && (
          <div className="card card-pad">
            <h3 className="section-title">Waiting for the first page load</h3>
            <p className="section-sub">
              The collector token ending in <code>{site.tokenHint}</code> was created {ago(site.createdAt)}, but nothing has been reported yet. Install the collector
              below, then open any page on {domain}. Events arrive within a few seconds.
            </p>
            <button className="btn btn-sm" onClick={load}>Check again</button>
          </div>
        )}

        {site && !live && <Setup site={site} token={token} />}

        {live && data?.stats && <Report stats={data.stats} site={site!} />}

        {site && (
          <CollectorCard
            site={site}
            admin={admin}
            busy={busy}
            showSetup={live}
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

// ------------------------------------------------------------------ setup

function Connect({ admin, busy, onIssue }: { admin: boolean; busy: boolean; onIssue: () => void }) {
  return (
    <div className="card card-pad">
      <h3 className="section-title">Connect your site</h3>
      <p className="section-sub">
        The audit&apos;s crawler matrix shows which bots <i>could</i> reach your pages. A collector shows which ones actually do, what they read, and whether they got
        an error, plus the people who clicked through from ChatGPT, Perplexity, Claude or Gemini.
      </p>
      <ul className="plain-list small" style={{ margin: "0 0 14px" }}>
        <li>It runs in front of your site (a Cloudflare Worker route, Pages middleware, or a Next.js proxy) and never changes or delays a response.</li>
        <li>
          It sends the path, status, user agent, the referring page and <code>utm_source</code>. Never IP addresses, cookies or other query parameters. MetaInfo keeps
          only hourly counts.
        </li>
        <li>Your own MetaInfo audits aren&apos;t counted.</li>
      </ul>
      {admin ? (
        <button className="btn btn-primary" disabled={busy} onClick={onIssue}>
          {busy ? "Creating…" : "Create a collector token"}
        </button>
      ) : (
        <p className="muted small">Ask an admin of this workspace to create the collector token.</p>
      )}
    </div>
  );
}

/** The three values every collector needs. MetaInfo only accepts events when all three match, which routes them to this workspace's site. */
function secretsFor(site: CollectorSite, token: string | null) {
  return [
    { name: "METAINFO_TOKEN", value: token, placeholder: `mtr_…${site.tokenHint}`, note: "Secret. Lets a collector report for this site only; it can't read anything." },
    { name: "METAINFO_ORG", value: site.workspaceId, placeholder: site.workspaceId, note: "This workspace. Events for another workspace's token are refused." },
    { name: "METAINFO_SITE", value: site.siteUrl, placeholder: site.siteUrl, note: "This site. Requests to other hosts (previews, staging) aren't reported." },
  ];
}

function Secrets({ site, token }: { site: CollectorSite; token: string | null }) {
  return (
    <div className="table-wrap">
      <table className="t">
        <tbody>
          {secretsFor(site, token).map((x) => (
            <tr key={x.name}>
              <td className="mono small" style={{ whiteSpace: "nowrap" }}><b>{x.name}</b></td>
              <td style={{ width: "100%" }}>
                <code className="mono small" style={{ wordBreak: "break-all" }}>{x.value ?? x.placeholder}</code>
                {!x.value && <span className="muted small"> (shown once when created; replace the token if you lost it)</span>}
                <div className="muted small">{x.note}</div>
              </td>
              <td>{x.value && <CopyButton text={x.value} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TokenCard({ token, site }: { token: string; site: CollectorSite }) {
  return (
    <div className="card card-pad" style={{ borderColor: "var(--accent)" }}>
      <h3 className="section-title">Your collector settings for {site.domain}</h3>
      <p className="section-sub">
        Add these three as secrets wherever the collector runs. Copy the token now: it won&apos;t be shown again.
      </p>
      <Secrets site={site} token={token} />
    </div>
  );
}

type Platform = "worker" | "pages" | "wrap" | "next";
const PLATFORMS: { id: Platform; label: string; hint: string }[] = [
  { id: "worker", label: "Cloudflare (any host)", hint: "Your DNS is on Cloudflare (orange cloud). The site can be hosted anywhere: Vercel, AWS, a VPS, WordPress…" },
  { id: "pages", label: "Cloudflare Pages", hint: "Your site is deployed on Cloudflare Pages." },
  { id: "wrap", label: "Site on Workers", hint: "Your site is itself a Cloudflare Worker (Workers assets, OpenNext, Astro, Remix, Hono…). A route runs one worker, so wrap yours." },
  { id: "next", label: "Next.js / Vercel", hint: "Any Next.js app: Vercel, Netlify, Cloudflare (next-on-pages) or self-hosted. Pages your app renders are reported without a status (the proxy runs first), so crawler errors on them won't show." },
];

function Setup({ site, token }: { site: CollectorSite; token: string | null }) {
  const [platform, setPlatform] = useState<Platform>("worker");
  const domain = site.domain;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const endpoint = `${origin}/api/traffic/events`;
  const selfHosted = endpoint !== HOSTED_ENDPOINT;
  const secrets = secretsFor(site, token);
  const envFile = [...secrets.map((x) => `${x.name}=${x.value ?? x.placeholder}`), ...(selfHosted ? [`METAINFO_ENDPOINT=${endpoint}`] : [])].join("\n");
  const wranglerSecrets = [
    ...secrets.map((x) => `npx wrangler secret put ${x.name}`.padEnd(42) + `# ${x.value ?? x.placeholder}`),
    ...(selfHosted ? [`npx wrangler secret put METAINFO_ENDPOINT`.padEnd(42) + `# ${endpoint}`] : []),
  ].join("\n");
  const fetchFiles = (files: string[]) => `mkdir -p lib/metainfo && cd lib/metainfo\ncurl -fsSLO "${COLLECTOR_RAW}/{${["core", ...files].join(",")}}.ts"`;
  const names = (
    <>
      <code>METAINFO_TOKEN</code>, <code>METAINFO_ORG</code> and <code>METAINFO_SITE</code>
      {selfHosted ? <> (plus <code>METAINFO_ENDPOINT</code>)</> : null}
    </>
  );

  const steps: Record<Platform, { title: string; code?: string; body?: ReactNode }[]> = {
    worker: [
      {
        title: "Deploy the collector worker",
        body: (
          <>
            One click: <a href={`https://deploy.workers.cloudflare.com/?url=${COLLECTOR_REPO}/tree/main/collector`} target="_blank" rel="noreferrer">Deploy to Cloudflare</a>{" "}
            (it asks for {names}). Or by hand:
          </>
        ),
        code: `git clone --depth 1 ${COLLECTOR_REPO}.git && cd metainfo/collector\nnpm install\nnpx wrangler deploy\n${wranglerSecrets}`,
      },
      {
        title: "Put it in front of your site",
        body: (
          <>
            Cloudflare dashboard → Workers &amp; Pages → <b>metainfo-collector</b> → Settings → Domains &amp; Routes → Add route <code>{`${domain}/*`}</code> (and{" "}
            <code>{`www.${domain}/*`}</code> if you use it). Every request still goes to your origin untouched; if the worker ever fails, Cloudflare skips it.
          </>
        ),
      },
    ],
    pages: [
      { title: "Add the collector files (outside functions/, where every file becomes a route)", code: fetchFiles(["pages"]) },
      { title: "Create functions/_middleware.ts", code: `export { onRequest } from "../lib/metainfo/pages";` },
      { title: "Add the secrets and redeploy", body: <>Pages project → Settings → Variables and Secrets → add {names} as type Secret:</>, code: envFile },
    ],
    wrap: [
      { title: "Add the collector files", code: fetchFiles(["wrap"]) },
      {
        title: "Wrap your worker's handler",
        code: `import { withMetainfo } from "./lib/metainfo/wrap";\n\nexport default withMetainfo({\n  async fetch(request, env, ctx) {\n    // your existing handler\n  },\n});`,
      },
      { title: "Add the secrets and deploy", code: `${wranglerSecrets}\nnpx wrangler deploy` },
    ],
    next: [
      { title: "Add the collector files", code: fetchFiles(["next"]) },
      {
        title: "Report from proxy.ts (middleware.ts before Next.js 16)",
        code: `import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";\nimport { reportToMetainfo } from "./lib/metainfo/next";\n\nexport function proxy(request: NextRequest, event: NextFetchEvent) {\n  // In an existing proxy, wrap each response you return the same way.\n  return reportToMetainfo(request, event, NextResponse.next());\n}\n\nexport const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };`,
      },
      { title: "Set the environment variables (Vercel: Project → Settings → Environment Variables, as Sensitive) and redeploy", code: envFile },
    ],
  };

  return (
    <div className="card card-pad">
      <h3 className="section-title">Install the collector</h3>
      {!token && (
        <div style={{ marginBottom: 14 }}>
          <Secrets site={site} token={null} />
        </div>
      )}
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        {PLATFORMS.map((p) => (
          <button key={p.id} className="tab" role="tab" aria-selected={platform === p.id} onClick={() => setPlatform(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="section-sub">{PLATFORMS.find((p) => p.id === platform)!.hint}</p>
      <ol className="stack" style={{ paddingLeft: 18, margin: 0 }}>
        {steps[platform].map((s) => (
          <li key={s.title}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{s.title}</div>
            {s.body && <p className="small" style={{ margin: "0 0 8px" }}>{s.body}</p>}
            {s.code && <CodeBlock code={s.code} />}
          </li>
        ))}
        <li>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Check it</div>
          <p className="small" style={{ margin: "0 0 8px" }}>Pretend to be an AI crawler, then refresh this page:</p>
          <CodeBlock code={`curl -s -o /dev/null -A "Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)" https://${domain}/`} />
        </li>
      </ol>
      <p className="muted small" style={{ marginTop: 12 }}>
        Other platforms (Netlify, Deno, Node) can use <a href={`${COLLECTOR_REPO}/tree/main/collector`} target="_blank" rel="noreferrer">core.ts</a> directly:{" "}
        <code>createCollector({"{ token, org, site, via }"})</code>, then <code>observe(request, status, waitUntil)</code> once the response is known.
      </p>
    </div>
  );
}

function CollectorCard(props: {
  site: CollectorSite;
  domain: string;
  admin: boolean;
  busy: boolean;
  showSetup: boolean;
  confirming: boolean;
  onReplace: () => void;
  onDisconnect: () => void;
  onCancel: () => void;
}) {
  const { site, admin, busy, confirming } = props;
  const [open, setOpen] = useState(false);
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
          {props.showSetup && <button className="btn btn-sm btn-ghost" onClick={() => setOpen((o) => !o)}>{open ? "Hide setup" : "Setup instructions"}</button>}
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
      {open && <Setup site={site} token={null} />}
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
        errors (a WAF or bot protection blocking GPTBot, say), use the Cloudflare Worker route instead.
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
        return <p className="muted"><Link href="/login?returnTo=/dashboard">Sign in</Link> and connect a collector to see which crawlers actually visit your site, and who clicks through from AI answers.</p>;
      case "loading":
        return <span className="spinner" />;
      case "error":
        return <p className="muted">{view.error}</p>;
      case "none":
        return <p className="muted">The audit shows which crawlers <i>could</i> reach your pages. <Link href="/traffic">Connect a collector</Link> to see which ones actually do, what they read, and whether they get errors.</p>;
    }
    if (!view.site.lastEventAt) return <p className="muted">The collector is set up but hasn&apos;t reported yet. <Link href="/traffic">Check the setup</Link>.</p>;
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
