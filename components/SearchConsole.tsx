"use client";

// Google Search Console: your real Google clicks, impressions, CTR and
// positions, compared with the previous period, plus opportunities and URL
// inspection. Search Console is connected once per workspace by an admin
// (stored server-side), or read with the server's service account; servers
// without accounts fall back to a per-browser cookie. See lib/server/gsc-auth.ts.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { matchSite, OPPORTUNITY_LABELS, type GscOpportunity, type GscSite, type KeyRow, type OpportunityKind } from "@/lib/gsc-analysis";
import { getToken as clerkToken } from "@clerk/nextjs";
import { useAccount } from "@/lib/account";
import type { Inspection } from "@/lib/server/gsc";
import type { GscStatus } from "@/lib/server/gsc-auth";
import type { GscReport } from "@/lib/server/gsc-report";
import { useProject } from "@/lib/project";
import { fmtNum, getToken, ResearchError, toCsv } from "@/lib/research-client";
import { Distribution, LineChart } from "./charts";
import { Delta, EmptyState, Kpi, PageHead } from "./kit";
import { ErrorBox } from "./research/common";
import { download } from "./ui";

// ---------------------------------------------------------------- client API

class GscClientError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

async function gsc<T>(path: string, body?: unknown, method?: string): Promise<T> {
  // The workspace's connection is found from the Clerk session; the research token unlocks the server's service account.
  const session = await clerkToken().catch(() => null);
  const res = await fetch(`/api/gsc/${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      "x-research-token": getToken(),
      ...(session ? { authorization: `Bearer ${session}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const out = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status})` }));
  if (!res.ok || out.error) throw new GscClientError(out.error ?? `HTTP ${res.status}`, out.code);
  return out as T;
}

const EVENT = "metainfo:gsc";
const notify = () => window.dispatchEvent(new Event(EVENT));

const UNKNOWN: GscStatus = {
  mode: "none",
  connected: false,
  oauthConfigured: false,
  accounts: false,
  signedIn: false,
  role: null,
  canManage: false,
  account: null,
  connectedBy: null,
  connectedAt: null,
  lastError: null,
  serviceAccount: null,
  serviceAccountLocked: false,
  property: null,
};

/** The workspace's (or this browser's) Search Console setup and the project's saved property. Refreshes after connect/disconnect, sign-in changes or a new access token. */
export function useGscStatus(projectId?: string): GscStatus | null {
  const account = useAccount();
  const scope = `${account.loaded}:${account.workspace?.id ?? ""}`;
  const [s, setS] = useState<{ key: string; status: GscStatus } | null>(null);
  const key = `${scope}:${projectId ?? ""}`;
  useEffect(() => {
    let live = true;
    const load = () =>
      gsc<GscStatus>(`status${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`)
        .then((x) => live && setS({ key, status: x }))
        .catch(() => live && setS({ key, status: UNKNOWN }));
    load();
    window.addEventListener(EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(EVENT, load);
    };
  }, [key, projectId]);
  return s?.key === key ? s.status : null;
}

/** Ask the server for Google's consent URL (it binds the workspace into a sealed state cookie) and go there. */
export async function connectGsc(returnTo: "/search-console" | "/settings" = "/search-console"): Promise<void> {
  const { url } = await gsc<{ url: string }>("connect", { return: returnTo });
  window.location.assign(url);
}

export async function disconnectGsc() {
  await gsc("disconnect", {}).catch(() => null);
  notify();
}

/** Who the connection belongs to, for display. */
function connectionLabel(s: GscStatus, workspace?: string): string {
  if (s.mode === "org") return `Connected for ${workspace ?? "this workspace"}${s.account ? ` as ${s.account}` : ""}`;
  if (s.mode === "service-account") return `Service account ${s.serviceAccount}`;
  if (s.mode === "browser") return "Connected in this browser";
  return "Not connected";
}

// ---------------------------------------------------------------- formatting

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");
const siteLabel = (s: string) => (s.startsWith("sc-domain:") ? `${s.slice(10)} (domain)` : shortUrl(s).replace(/\/$/, ""));

// Search Console reports countries as ISO alpha-3; names come from Intl via alpha-2.
const A3 =
  "usa:US,gbr:GB,can:CA,aus:AU,ind:IN,deu:DE,fra:FR,esp:ES,ita:IT,nld:NL,bel:BE,che:CH,aut:AT,swe:SE,nor:NO,dnk:DK,fin:FI,irl:IE,prt:PT,pol:PL,cze:CZ,rou:RO,grc:GR,tur:TR,rus:RU,ukr:UA,isr:IL,are:AE,sau:SA,egy:EG,zaf:ZA,nga:NG,ken:KE,bra:BR,mex:MX,arg:AR,col:CO,chl:CL,per:PE,jpn:JP,kor:KR,chn:CN,hkg:HK,twn:TW,sgp:SG,mys:MY,idn:ID,tha:TH,vnm:VN,phl:PH,pak:PK,bgd:BD,nzl:NZ,hun:HU,lka:LK,npl:NP";
const A3_TO_A2 = new Map(A3.split(",").map((p) => p.split(":") as [string, string]));
const COUNTRY_OPTIONS = [...A3_TO_A2.keys()];
let regionNames: Intl.DisplayNames | null = null;
function countryName(a3: string): string {
  const a2 = A3_TO_A2.get(a3);
  if (!a2) return a3.toUpperCase();
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(a2) ?? a3.toUpperCase();
  } catch {
    return a3.toUpperCase();
  }
}

const RANGES: { days: number; label: string }[] = [
  { days: 7, label: "7 days" },
  { days: 28, label: "28 days" },
  { days: 90, label: "3 months" },
  { days: 180, label: "6 months" },
  { days: 480, label: "16 months" },
];
const TYPES = [
  { id: "web", label: "Web" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "news", label: "News" },
  { id: "discover", label: "Discover" },
];
const DEVICES = [
  { id: "", label: "All devices" },
  { id: "DESKTOP", label: "Desktop" },
  { id: "MOBILE", label: "Mobile" },
  { id: "TABLET", label: "Tablet" },
];

const FLASH: Record<string, string> = {
  connected: "Google Search Console connected.",
  denied: "Google sign-in was cancelled, so nothing was connected.",
  state: "The sign-in link expired or didn't match this browser. Try connecting again.",
  google: "Google didn't complete the sign-in. Try again; if it keeps failing, check the OAuth client's redirect URI.",
  config: "Google rejected this server's OAuth client. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
  "not-configured": "Search Console OAuth isn't configured on this server.",
  "sign-in": "Sign in to connect Search Console for your team.",
};

// ---------------------------------------------------------------- page

export default function SearchConsole() {
  const [project] = useProject();
  const account = useAccount();
  const status = useGscStatus(project.id || undefined);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sites, setSites] = useState<{ via: string; list: GscSite[]; error?: unknown } | null>(null);
  const [picked, setPicked] = useState("");
  const [days, setDays] = useState(28);
  const [country, setCountry] = useState("");
  const [device, setDevice] = useState("");
  const [searchType, setSearchType] = useState("web");
  const [result, setResult] = useState<{ key: string; report?: GscReport; error?: unknown } | null>(null);
  const [nonce, setNonce] = useState(0);

  // ?connected=1 / ?gsc_error=... from the OAuth callback.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const err = q.get("gsc_error");
    if (!err && !q.get("connected")) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the callback's query after mount
    setFlash(err ? { ok: false, msg: FLASH[err] ?? FLASH.google } : { ok: true, msg: FLASH.connected });
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const via = status?.connected ? status.mode : null;
  useEffect(() => {
    if (!via) return;
    let live = true;
    gsc<{ via: string; sites: GscSite[] }>("sites")
      .then((r) => live && setSites({ via: r.via, list: r.sites }))
      .catch((e) => live && setSites({ via, list: [], error: e }));
    return () => {
      live = false;
    };
  }, [via, nonce]);

  const list = sites && sites.via === via ? sites.list : [];
  const has = (u: string | null | undefined): u is string => Boolean(u && list.some((s) => s.siteUrl === u));
  // This session's pick, then the workspace's saved property for the project, then the one matching its domain.
  const site = (has(picked) ? picked : "") || (has(status?.property) ? status.property : "") || matchSite(list, project.domain)?.siteUrl || list[0]?.siteUrl || "";
  const pickSite = (u: string) => {
    setPicked(u);
    if (status?.mode === "org" && project.id) gsc("property", { projectId: project.id, site: u }, "PUT").catch(() => null);
  };
  const key = site ? JSON.stringify({ site, days, country, device, searchType, nonce }) : "";

  useEffect(() => {
    if (!key) return;
    let live = true;
    const p = JSON.parse(key);
    gsc<GscReport>("report", { site: p.site, days: p.days, country: p.country || undefined, device: p.device || undefined, search_type: p.searchType })
      .then((report) => live && setResult({ key, report }))
      .catch((error) => {
        if (!live) return;
        setResult({ key, error });
        if (error instanceof GscClientError && ["not-connected", "reconnect", "sign-in", "token"].includes(error.code ?? "")) notify();
      });
    return () => {
      live = false;
    };
  }, [key]);

  const loading = Boolean(key) && result?.key !== key;
  const report = result?.key === key ? result.report : undefined;
  const reportError = result?.key === key ? result.error : undefined;
  const stale = loading && result?.report;
  const shown = report ?? (stale ? result!.report : undefined);

  const disconnect = async () => {
    await disconnectGsc();
    setSites(null);
    setResult(null);
  };

  const head = (
    <PageHead
      title="Search Console"
      sub={
        <>
          Your real Google clicks, impressions, click-through and positions{project.domain ? ` for ${project.domain}` : ""}, straight from Google Search Console, with the queries and pages worth working on next.
        </>
      }
      actions={
        via && list.length > 0 ? (
          <>
            <select className="select" style={{ height: 34, maxWidth: 280 }} aria-label="Search Console property" value={site} onChange={(e) => pickSite(e.target.value)}>
              {list.map((s) => (
                <option key={s.siteUrl} value={s.siteUrl}>
                  {siteLabel(s.siteUrl)}
                </option>
              ))}
            </select>
            {status?.connected && status.mode !== "service-account" && status.canManage && (
              <button className="btn" onClick={disconnect}>
                Disconnect
              </button>
            )}
          </>
        ) : status?.connected && status.mode !== "service-account" && status.canManage ? (
          <button className="btn" onClick={disconnect}>
            Disconnect
          </button>
        ) : null
      }
    />
  );

  const flashBox = flash && (
    <div className={flash.ok ? "notice" : "error-box"} role="status" style={{ marginTop: 0 }}>
      {flash.msg}
    </div>
  );

  if (!status) {
    return (
      <main className="shell gsc-page">
        {head}
        <div className="card card-pad row">
          <span className="spinner" /> Checking Search Console setup
        </div>
      </main>
    );
  }

  if (!via) {
    return (
      <main className="shell gsc-page">
        {head}
        <div className="stack">
          {flashBox}
          <ConnectPanel status={status} workspace={account.workspace?.name} onToken={() => notify()} />
        </div>
      </main>
    );
  }

  return (
    <main className="shell gsc-page">
      {head}
      <div className="stack">
        {flashBox}
        <div className="row small muted">
          <span className={`badge ${via === "service-account" ? "accent" : "gain"}`}>{connectionLabel(status, account.workspace?.name)}</span>
          {status.mode === "org" && list.length > 1 && <span>The property you pick is saved for everyone in the workspace.</span>}
          {project.domain && list.length > 0 && !matchSite(list, project.domain) && <span>No property matches {project.domain}; showing {siteLabel(site)}.</span>}
          {shown && (
            <span>
              {day(shown.range.startDate)} to {day(shown.range.endDate)}
              {shown.previousRange ? `, compared with ${day(shown.previousRange.startDate)} to ${day(shown.previousRange.endDate)}` : ", no earlier period inside Search Console's 16 months"}
            </span>
          )}
        </div>

        {sites?.error ? <ErrorBox error={sites.error} onRetry={() => setNonce((n) => n + 1)} /> : null}
        {sites && !sites.error && list.length === 0 && (
          <EmptyState
            title="No Search Console properties"
            body={
              via === "service-account"
                ? `The service account ${status.serviceAccount} can't read any property yet. In Search Console, open Settings > Users and permissions and add it as a user.`
                : "This Google account has no verified Search Console properties. Add and verify your site at search.google.com/search-console, or connect another account."
            }
          />
        )}

        {site && (
          <div className="card card-pad gsc-filters">
            <div className="segmented" role="group" aria-label="Date range">
              {RANGES.map((r) => (
                <button key={r.days} aria-pressed={days === r.days} onClick={() => setDays(r.days)}>
                  {r.label}
                </button>
              ))}
            </div>
            <select className="select" aria-label="Search type" value={searchType} onChange={(e) => setSearchType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <select className="select" aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">All countries</option>
              {[...new Set([...(shown?.countries.map((c) => c.key) ?? []), ...COUNTRY_OPTIONS])].map((c) => (
                <option key={c} value={c}>
                  {countryName(c)}
                </option>
              ))}
            </select>
            <select className="select" aria-label="Device" value={device} onChange={(e) => setDevice(e.target.value)}>
              {DEVICES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            <span className="spacer" />
            {loading && (
              <span className="row small muted" style={{ gap: 6 }}>
                <span className="spinner" /> Loading from Google
              </span>
            )}
            {shown && !loading && (
              <button className="btn btn-sm btn-ghost" onClick={() => setNonce((n) => n + 1)}>
                Refresh
              </button>
            )}
          </div>
        )}

        {reportError ? <ErrorBox error={reportError instanceof GscClientError && reportError.code === "token" ? new ResearchError(reportError.message, "token") : reportError} onRetry={() => setNonce((n) => n + 1)} /> : null}
        {shown && <ReportView report={shown} dim={Boolean(stale)} />}
        {site && <Inspector site={site} />}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- not configured / not connected

function ConnectButton({ returnTo, label = "Connect Google Search Console", small }: { returnTo?: "/search-console" | "/settings"; label?: string; small?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <>
      <button
        className={`btn btn-primary${small ? " btn-sm" : ""}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            await connectGsc(returnTo);
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening Google" : label}
      </button>
      {err && <span className="small" style={{ color: "var(--fail)" }}>{err}</span>}
    </>
  );
}

function ConnectPanel({ status, workspace, onToken }: { status: GscStatus; workspace?: string; onToken: () => void }) {
  const tokenBox = status.serviceAccountLocked && (
    <>
      <ErrorBox error={new ResearchError("token", "token")} onRetry={onToken} />
      <p className="small muted">This server can also read Search Console with its service account. Enter its RESEARCH_TOKEN to use it.</p>
    </>
  );
  if (!status.oauthConfigured) {
    if (status.serviceAccountLocked) return <>{tokenBox}</>;
    return (
      <div className="card card-pad">
        <EmptyState
          title="Search Console isn't set up on this server"
          body={
            <>
              Add one of these to the server&apos;s environment, then reload. <b>OAuth</b> (an admin connects Google once for the whole workspace):{" "}
              <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> from a Google Cloud OAuth client (Web application) with the Search Console API enabled, and{" "}
              <code>{typeof window === "undefined" ? "" : window.location.origin}/api/gsc/callback</code> as an authorised redirect URI. Optionally <code>GSC_COOKIE_SECRET</code> to encrypt the
              stored connection. <b>Service account</b> (self-hosting and MCP): <code>GSC_SERVICE_ACCOUNT_JSON</code> with the key file&apos;s JSON, and add the service account&apos;s email as a
              user on your property in Search Console.
            </>
          }
        />
      </div>
    );
  }
  if (status.accounts && !status.signedIn) {
    return (
      <>
        <div className="card card-pad gsc-connect">
          <div style={{ flex: 1, minWidth: 260 }}>
            <h2 className="section-title">Sign in to connect for your team</h2>
            <p className="section-sub" style={{ marginBottom: 0 }}>
              Search Console is connected once per workspace: an admin signs in with Google and everyone in the workspace sees the same real clicks, impressions and positions. The
              connection is stored on the server; nobody&apos;s browser ever holds the Google token.
            </p>
          </div>
          <Link className="btn btn-primary" href="/login">
            Sign in
          </Link>
        </div>
        {tokenBox}
      </>
    );
  }
  const name = workspace ?? "this workspace";
  if (status.lastError) {
    return (
      <div className="card card-pad gsc-connect">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 className="section-title">Reconnect Search Console</h2>
          <p className="section-sub" style={{ marginBottom: 0 }}>
            The Google connection for {name}
            {status.account ? ` (${status.account})` : ""} stopped working: {status.lastError}
            {status.canManage ? "" : " Ask an admin to reconnect it."}
          </p>
        </div>
        {status.canManage && <ConnectButton label="Reconnect" />}
      </div>
    );
  }
  if (status.signedIn && !status.canManage) {
    return (
      <>
        <div className="card card-pad">
          <h2 className="section-title">Search Console isn&apos;t connected for {name}</h2>
          <p className="section-sub" style={{ marginBottom: 0 }}>Ask an admin of the workspace to connect it in Settings or here. Once they do, everyone in the workspace sees the data.</p>
        </div>
        {tokenBox}
      </>
    );
  }
  return (
    <>
      <div className="card card-pad gsc-connect">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 className="section-title">Connect Google Search Console{status.signedIn ? ` for ${name}` : ""}</h2>
          <p className="section-sub" style={{ marginBottom: 0 }}>
            See the clicks, impressions and positions Google itself records for your site, not estimates. MetaInfo asks for read-only access.{" "}
            {status.signedIn
              ? "The connection is stored on the server for the whole workspace, so every member sees the same data; admins can disconnect it at any time."
              : "The connection is kept in an encrypted cookie in this browser; you can disconnect at any time."}
          </p>
        </div>
        <ConnectButton />
      </div>
      {tokenBox}
    </>
  );
}

// ---------------------------------------------------------------- report

function pctChange(cur: number, prev: number | null | undefined): number {
  if (prev == null || !prev) return 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** Weekly buckets for long ranges, so the chart stays readable. */
function bucket(daily: GscReport["daily"], days: number) {
  if (days <= 90) return daily.map((d) => ({ label: day(d.date), clicks: d.clicks, impressions: d.impressions, ctr: d.ctr, position: d.position }));
  const out: { label: string; clicks: number; impressions: number; ctr: number; position: number; w: number }[] = [];
  daily.forEach((d, i) => {
    if (i % 7 === 0) out.push({ label: `Wk of ${day(d.date)}`, clicks: 0, impressions: 0, ctr: 0, position: 0, w: 0 });
    const b = out[out.length - 1];
    b.clicks += d.clicks;
    b.impressions += d.impressions;
    b.position += d.position * d.impressions;
    b.w += d.impressions;
  });
  return out.map((b) => ({ ...b, ctr: b.impressions ? b.clicks / b.impressions : 0, position: b.w ? Math.round((b.position / b.w) * 10) / 10 : 0 }));
}

function ReportView({ report, dim }: { report: GscReport; dim: boolean }) {
  const [metric, setMetric] = useState<"clicks" | "impressions" | "ctr">("clicks");
  const t = report.totals;
  const p = report.previous;
  const series = useMemo(() => bucket(report.daily, report.days), [report.daily, report.days]);
  const hasPosition = report.searchType !== "discover" && t.position > 0;

  return (
    <div className="stack" style={{ opacity: dim ? 0.6 : 1, transition: "opacity 150ms" }}>
      {report.unavailable.length > 0 && <div className="notice">Search Console doesn&apos;t report {report.unavailable.join(", ")} for {report.searchType} results.</div>}
      <div className="kpi-row">
        <Kpi label="Clicks" value={fmtNum(t.clicks)} foot={p ? <Delta value={pctChange(t.clicks, p.clicks)} suffix="%" /> : "no previous period"} />
        <Kpi label="Impressions" value={fmtNum(t.impressions)} foot={p ? <Delta value={pctChange(t.impressions, p.impressions)} suffix="%" /> : "no previous period"} />
        <Kpi label="Average CTR" value={pct(t.ctr)} foot={p ? <Delta value={Math.round((t.ctr - p.ctr) * 1000) / 10} suffix=" pts" /> : "no previous period"} />
        <Kpi
          label="Average position"
          value={hasPosition ? t.position : "n/a"}
          foot={p && hasPosition && p.position ? <Delta value={Math.round((t.position - p.position) * 10) / 10} goodWhenUp={false} /> : hasPosition ? "no previous period" : "not reported"}
        />
      </div>

      {series.length > 1 && (
        <div className="bento">
          <div className={`card card-pad ${hasPosition ? "b-7" : "b-12"}`}>
            <div className="panel-head">
              <h2 className="section-title">Performance</h2>
              <span className="spacer" />
              <div className="segmented" role="group" aria-label="Metric">
                {(["clicks", "impressions", "ctr"] as const).map((m) => (
                  <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>
                    {m === "ctr" ? "CTR" : m[0].toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <LineChart
              key={metric}
              ariaLabel={`${metric} per ${report.days > 90 ? "week" : "day"}`}
              x={series.map((s) => s.label)}
              series={[
                {
                  id: metric,
                  label: metric === "ctr" ? "CTR (%)" : metric[0].toUpperCase() + metric.slice(1),
                  color: metric === "clicks" ? "var(--series-1)" : metric === "impressions" ? "var(--series-7)" : "var(--series-3)",
                  values: series.map((s) => (metric === "ctr" ? Math.round(s.ctr * 1000) / 10 : s[metric])),
                },
              ]}
              format={metric === "ctr" ? (n) => `${n}%` : fmtNum}
            />
          </div>
          {hasPosition && (
            <div className="card card-pad b-5">
              <div className="panel-head">
                <h2 className="section-title">Average position</h2>
              </div>
              <LineChart ariaLabel="Average position over time" invert x={series.map((s) => s.label)} series={[{ id: "position", label: "Average position", color: "var(--series-2)", values: series.map((s) => s.position || null) }]} />
            </div>
          )}
        </div>
      )}

      <Opportunities items={report.opportunities} />

      {report.queries.length > 0 && <RowsTable title="Top queries" noun="query" rows={report.queries} hasPrev={Boolean(p)} site={report.site} kind="query" />}
      {report.pages.length > 0 && <RowsTable title="Top pages" noun="page" rows={report.pages} hasPrev={Boolean(p)} site={report.site} kind="page" />}

      {(report.countries.length > 0 || report.devices.length > 0) && (
        <div className="bento">
          <div className="card card-pad b-6">
            <h2 className="section-title">Countries</h2>
            <p className="section-sub">Clicks by country.</p>
            <Breakdown rows={report.countries} label={countryName} />
          </div>
          <div className="card card-pad b-6">
            <h2 className="section-title">Devices</h2>
            <p className="section-sub">Clicks by device.</p>
            <Breakdown rows={report.devices} label={(k) => k[0] + k.slice(1).toLowerCase()} />
          </div>
        </div>
      )}

      {report.appearance.length > 0 && (
        <div className="card card-pad">
          <h2 className="section-title">Search appearance</h2>
          <p className="section-sub">Rich results and other result types your pages appeared as.</p>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Appearance</th>
                  <th className="num">Clicks</th>
                  <th className="num">Impressions</th>
                  <th className="num">CTR</th>
                  <th className="num">Position</th>
                </tr>
              </thead>
              <tbody>
                {report.appearance.map((a) => (
                  <tr key={a.key}>
                    <td>{a.key.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</td>
                    <td className="num">{a.clicks.toLocaleString()}</td>
                    <td className="num">{a.impressions.toLocaleString()}</td>
                    <td className="num">{pct(a.ctr)}</td>
                    <td className="num">{a.position || "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Breakdown({ rows, label }: { rows: GscReport["countries"]; label: (k: string) => string }) {
  const sorted = [...rows].sort((a, b) => b.clicks - a.clicks);
  const top = sorted.slice(0, 6);
  const rest = sorted.slice(6).reduce((n, r) => n + r.clicks, 0);
  const parts = top.map((r, i) => ({ label: label(r.key), value: r.clicks, color: `var(--series-${i + 1})` }));
  if (rest > 0) parts.push({ label: "Other", value: rest, color: "var(--surface-3)" });
  if (!rows.length) return <p className="muted small">No data.</p>;
  return <Distribution parts={parts} ariaLabel="Clicks by segment" />;
}

const KIND_ORDER: OpportunityKind[] = ["striking-distance", "low-ctr", "cannibalisation", "declining", "answer-first"];
const KIND_HELP: Record<OpportunityKind, string> = {
  "striking-distance": "Queries at positions 4 to 20 with real demand: small improvements move them onto the part of page one that gets clicked.",
  "low-ctr": "Queries where you already rank in the top 5 but get far fewer clicks than that position usually earns: fix the title and description.",
  cannibalisation: "Queries where two or more of your pages split the impressions, so neither ranks as well as one would.",
  declining: "Queries and pages that lost the most clicks compared with the previous period.",
  "answer-first": "Questions and comparisons, the searches AI Overviews answer: lead with a direct answer to get cited.",
};

function Opportunities({ items }: { items: GscOpportunity[] }) {
  const [kind, setKind] = useState<OpportunityKind | null>(null);
  const [all, setAll] = useState(false);
  const groups = KIND_ORDER.map((k) => {
    const list = items.filter((o) => o.kind === k);
    return { kind: k, list, gain: list.reduce((n, o) => n + (o.estGain ?? 0), 0) };
  });
  const active = kind ?? groups.find((g) => g.list.length)?.kind ?? "striking-distance";
  const current = groups.find((g) => g.kind === active)!;
  const shown = all ? current.list : current.list.slice(0, 8);

  return (
    <div className="card card-pad">
      <div className="panel-head">
        <div>
          <h2 className="section-title">Opportunities</h2>
          <p className="section-sub" style={{ marginBottom: 0 }}>
            Ranked by estimated extra clicks over the same period. Estimates use a typical click-through curve by position, so treat them as a guide to order, not a forecast.
          </p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="muted small">No clear opportunities in this period. Try a longer date range, or remove filters.</p>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Opportunity types">
            {groups.map((g) => (
              <button
                key={g.kind}
                role="tab"
                className="tab"
                aria-selected={g.kind === active}
                onClick={() => {
                  setKind(g.kind);
                  setAll(false);
                }}
              >
                {OPPORTUNITY_LABELS[g.kind]}
                <span className="count">{g.list.length}</span>
              </button>
            ))}
          </div>
          <p className="small muted" style={{ marginBottom: 10 }}>
            {KIND_HELP[active]}
            {current.gain > 0 && <> About <b style={{ color: "var(--text)" }}>{current.gain.toLocaleString()}</b> extra clicks in total.</>}
          </p>
          {current.list.length === 0 ? (
            <p className="muted small">None found in this period.</p>
          ) : (
            <div className="gsc-opps">
              {shown.map((o) => (
                <details key={o.id} className="gsc-opp">
                  <summary>
                    <span className="gsc-opp-title">{o.title}</span>
                    <span className="gsc-opp-meta small muted">
                      {o.impressions.toLocaleString()} impr. · {o.clicks.toLocaleString()} clicks{o.position ? ` · pos ${o.position}` : ""}
                    </span>
                    {o.estGain != null && o.estGain > 0 && <span className="badge gain">+{o.estGain.toLocaleString()} clicks</span>}
                  </summary>
                  <div className="gsc-opp-body">
                    <p className="small">{o.why}</p>
                    {o.pages && (
                      <ul className="gsc-pages small">
                        {o.pages.map((pg) => (
                          <li key={pg.page}>
                            <a href={pg.page} target="_blank" rel="noreferrer noopener" className="break">
                              {shortUrl(pg.page)}
                            </a>{" "}
                            <span className="muted">
                              {pg.share}% of impressions · pos {pg.position} · {pg.clicks} clicks
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <ol className="gsc-steps small">
                      {o.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                    {o.query && (
                      <div className="row" style={{ marginTop: 8 }}>
                        <Link className="btn btn-sm" href={`/serp?q=${encodeURIComponent(o.query)}`}>
                          See the SERP
                        </Link>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
          {current.list.length > 8 && (
            <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${current.list.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

type SortKey = "clicks" | "impressions" | "ctr" | "position" | "change";

function RowsTable({ title, noun, rows, hasPrev, site, kind }: { title: string; noun: string; rows: KeyRow[]; hasPrev: boolean; site: string; kind: "query" | "page" }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState<SortKey>("clicks");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? rows.filter((r) => r.key.toLowerCase().includes(needle)) : rows;
    const val = (r: KeyRow) => (sort === "change" ? r.clicks - (r.prevClicks ?? 0) : sort === "position" ? -r.position : r[sort]);
    return [...list].sort((a, b) => val(b) - val(a));
  }, [rows, q, sort]);
  const shown = all ? filtered : filtered.slice(0, 25);
  const head = (k: SortKey, label: string) => (
    <th className="num">
      <button className="gsc-sort" aria-pressed={sort === k} onClick={() => setSort(k)}>
        {label}
        {sort === k ? " ↓" : ""}
      </button>
    </th>
  );
  const exportCsv = () =>
    download(
      `search-console-${kind === "query" ? "queries" : "pages"}-${siteLabel(site).replace(/[^\w.-]+/g, "_")}.csv`,
      toCsv(filtered.map((r) => ({ [noun]: r.key, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, previous_clicks: r.prevClicks ?? "", previous_position: r.prevPosition ?? "" }))),
      "text/csv",
    );

  return (
    <div className="card card-pad">
      <div className="panel-head">
        <div>
          <h2 className="section-title">
            {title} <span className="muted small">({rows.length.toLocaleString()})</span>
          </h2>
        </div>
        <span className="spacer" />
        <input className="input" style={{ height: 30, width: 220 }} placeholder={`Search ${kind === "query" ? "queries" : "pages"}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${title.toLowerCase()}`} />
        <button className="btn btn-sm" onClick={exportCsv}>
          Export CSV
        </button>
      </div>
      <div className="table-wrap">
        <table className="t gsc-table">
          <thead>
            <tr>
              <th>{noun[0].toUpperCase() + noun.slice(1)}</th>
              {head("clicks", "Clicks")}
              {head("impressions", "Impressions")}
              {head("ctr", "CTR")}
              {head("position", "Position")}
              {hasPrev && head("change", "Change")}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key}>
                <td className="break gsc-key">
                  {kind === "page" ? (
                    <a href={r.key} target="_blank" rel="noreferrer noopener">
                      {shortUrl(r.key)}
                    </a>
                  ) : (
                    r.key
                  )}
                </td>
                <td className="num">{r.clicks.toLocaleString()}</td>
                <td className="num">{r.impressions.toLocaleString()}</td>
                <td className="num">{pct(r.ctr)}</td>
                <td className="num">{r.position}</td>
                {hasPrev && (
                  <td className="num gsc-change">
                    {r.prevClicks == null || (r.prevClicks === 0 && r.prevPosition == null) ? (
                      <span className="badge accent">new</span>
                    ) : (
                      <>
                        <Delta value={r.clicks - r.prevClicks} />
                        {r.prevPosition != null && Math.abs(r.position - r.prevPosition) >= 0.5 && (
                          <span className="small muted" title={`Position was ${r.prevPosition}`}>
                            {" "}
                            pos {r.prevPosition} → {r.position}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <p className="muted small" style={{ marginTop: 10 }}>No matches.</p>}
      {filtered.length > 25 && (
        <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} onClick={() => setAll(!all)}>
          {all ? "Show top 25" : `Show all ${filtered.length.toLocaleString()}`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- URL inspection

const VERDICT: Record<string, { label: string; cls: string }> = {
  PASS: { label: "Pass", cls: "gain" },
  PARTIAL: { label: "Partial", cls: "sev-high" },
  FAIL: { label: "Fail", cls: "sev-critical" },
  NEUTRAL: { label: "Excluded", cls: "" },
  VERDICT_UNSPECIFIED: { label: "Unknown", cls: "" },
};
const human = (s: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "n/a");

function Verdict({ v }: { v: string | null | undefined }) {
  const x = VERDICT[v ?? ""] ?? { label: human(v ?? null), cls: "" };
  return <span className={`badge ${x.cls}`}>{x.label}</span>;
}

function Inspector({ site }: { site: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Inspection | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const placeholder = site.startsWith("sc-domain:") ? `https://${site.slice(10)}/` : site;

  const run = async () => {
    const target = url.trim() || placeholder;
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      setRes(await gsc<Inspection>("inspect", { site, url: /^https?:\/\//i.test(target) ? target : `https://${target}` }));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad">
      <h2 className="section-title">URL inspection</h2>
      <p className="section-sub">Ask Google whether a page is indexed, when it was last crawled, and which canonical it chose. The URL must be on {siteLabel(site)}.</p>
      <form
        className="scan-row"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input className="input" style={{ height: 36 }} placeholder={placeholder} value={url} onChange={(e) => setUrl(e.target.value)} aria-label="URL to inspect" />
        <button className="btn btn-primary" style={{ height: 36 }} type="submit" disabled={busy}>
          {busy ? "Inspecting" : "Inspect"}
        </button>
      </form>
      {err ? <ErrorBox error={err} /> : null}
      {res && (
        <div className="gsc-inspect">
          <div className="row" style={{ marginBottom: 12 }}>
            <Verdict v={res.verdict} />
            <b>{human(res.coverageState)}</b>
            <span className="spacer" />
            {res.link && (
              <a className="btn btn-sm btn-ghost" href={res.link} target="_blank" rel="noreferrer noopener">
                Open in Search Console
              </a>
            )}
          </div>
          <dl className="gsc-dl">
            <dt>Indexing allowed</dt>
            <dd>{human(res.indexingState)}</dd>
            <dt>robots.txt</dt>
            <dd>{human(res.robotsTxtState)}</dd>
            <dt>Page fetch</dt>
            <dd>{human(res.pageFetchState)}</dd>
            <dt>Last crawl</dt>
            <dd>{res.lastCrawlTime ? `${new Date(res.lastCrawlTime).toLocaleString()}${res.crawledAs ? ` (${human(res.crawledAs)} crawler)` : ""}` : "Not crawled yet"}</dd>
            <dt>Your canonical</dt>
            <dd className="break">{res.userCanonical ?? <span className="muted">none declared</span>}</dd>
            <dt>Google&apos;s canonical</dt>
            <dd className="break">
              {res.googleCanonical ?? <span className="muted">n/a</span>}
              {res.canonicalMismatch && <span className="badge sev-high" style={{ marginLeft: 6 }}>differs from yours</span>}
            </dd>
            {res.sitemaps.length > 0 && (
              <>
                <dt>Sitemaps</dt>
                <dd className="break">{res.sitemaps.join(", ")}</dd>
              </>
            )}
            {res.referringUrls.length > 0 && (
              <>
                <dt>Found via</dt>
                <dd className="break">{res.referringUrls.map(shortUrl).join(", ")}</dd>
              </>
            )}
            {res.mobile && (
              <>
                <dt>Mobile usability</dt>
                <dd>
                  <Verdict v={res.mobile.verdict} /> {res.mobile.issues.join("; ")}
                </dd>
              </>
            )}
            {res.richResults && (
              <>
                <dt>Rich results</dt>
                <dd>
                  <Verdict v={res.richResults.verdict} />{" "}
                  {res.richResults.items.map((it) => (
                    <span key={it.type} className="small">
                      {" "}
                      {it.type}
                      {it.issues.length ? ` (${it.issues.map((i) => i.message).join("; ")})` : ""}
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Settings panel

/** Compact status + connect/disconnect, for Settings. */
export function GscConnection() {
  const account = useAccount();
  const status = useGscStatus();
  if (!status) return <span className="badge">Checking</span>;
  const usable = status.connected;
  const label = usable
    ? connectionLabel(status, account.workspace?.name)
    : status.lastError
      ? `Needs reconnecting: ${status.lastError}`
      : !status.oauthConfigured
        ? status.serviceAccountLocked
          ? "Service account needs the access token"
          : "Not configured on this server"
        : status.accounts && !status.signedIn
          ? "Sign in to connect for your team"
          : status.canManage
            ? "Not connected"
            : "Not connected: ask an admin to connect it";
  return (
    <div className="row">
      <span className={`badge ${usable ? "gain" : ""}`}>{label}</span>
      {status.oauthConfigured && status.canManage && (status.mode === "none" || status.mode === "service-account" || status.lastError) && (
        <ConnectButton small returnTo="/settings" label={status.lastError ? "Reconnect" : "Connect Google Search Console"} />
      )}
      {status.oauthConfigured && status.accounts && !status.signedIn && (
        <Link className="btn btn-sm btn-primary" href="/login">
          Sign in
        </Link>
      )}
      {(status.mode === "org" || status.mode === "browser") && status.canManage && (
        <button className="btn btn-sm btn-ghost" onClick={disconnectGsc}>
          Disconnect
        </button>
      )}
      <Link className="btn btn-sm btn-ghost" href="/search-console">
        Open Search Console
      </Link>
    </div>
  );
}
