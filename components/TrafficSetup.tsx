"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "@/lib/sync";
import { cloudflareTokenUrl, type CollectorSite } from "@/lib/traffic";
import { COLLECTOR_RAW, HOSTED_ENDPOINT, deployToCloudflare, sendTestVisit, type CloudflareConflict, type CloudflareDeploy } from "@/lib/traffic-client";
import { CodeBlock, CopyButton } from "./ui";

// Connecting a site, as a short timeline: the site, where it runs, connect, first visit. On Cloudflare it's
// clicks only: a pre-filled API token form, then MetaInfo deploys the collector and adds the routes itself.

type Platform = "cloudflare" | "next" | "worker" | "other";

const PLATFORMS: { id: Platform; name: string; sub: string; badge?: string; icon: ReactNode }[] = [
  { id: "cloudflare", name: "Cloudflare", sub: "DNS or Pages on Cloudflare, hosted anywhere", badge: "One click", icon: <CloudIcon /> },
  { id: "next", name: "Vercel / Next.js", sub: "Next.js on Vercel, Netlify or your server", icon: <TriangleIcon /> },
  { id: "worker", name: "Cloudflare Worker", sub: "Your site is itself a Worker", icon: <BoltIcon /> },
  { id: "other", name: "Something else", sub: "Netlify Edge, Deno, Node…", icon: <CodeIcon /> },
];

export interface SetupProps {
  projectId: string;
  domain: string;
  site: CollectorSite | null;
  /** The collector token, when it was just created on this page (it's shown once). */
  token: string | null;
  admin: boolean;
  live: boolean;
  /** Creates (or replaces) the collector token. */
  onIssue: () => Promise<void>;
  /** The collector was deployed by MetaInfo: the site row to show. */
  onSite: (site: CollectorSite) => void;
  onRefresh: () => void;
}

export default function TrafficSetup(props: SetupProps) {
  const { domain, site, live } = props;
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [installed, setInstalled] = useState(false);
  const connected = installed || live;
  const current = !platform ? 1 : !connected ? 2 : live ? 4 : 3;

  return (
    <section className="ol ol-card">
      <header className="ol-head">
        <div className="ol-head-icon"><PulseIcon /></div>
        <div style={{ flex: 1 }}>
          <div className="ol-eyebrow">Traffic</div>
          <h2 className="ol-title">Connect {domain}</h2>
          <p className="ol-desc">See which AI crawlers and search engines really visit, and who clicks through from AI answers.</p>
        </div>
        <Link className="ol-btn ol-btn-ghost" href="/traffic/guide">How it works</Link>
      </header>

      <ol className="ol-timeline">
        <Step n={1} state="done" title="Your site" text={<>Traffic is reported for <b>{domain}</b> and its subdomains.</>} />

        <Step n={2} state={current === 1 ? "active" : "done"} title="Where does it run?" text="Pick where your site is served from.">
          <div className="ol-tiles">
            {PLATFORMS.map((p) => (
              <button key={p.id} type="button" className="ol-tile" aria-pressed={platform === p.id} onClick={() => setPlatform(p.id)}>
                <span className="ol-tile-icon">{p.icon}</span>
                <span className="ol-tile-name">
                  {p.name}
                  {p.badge && <span className="ol-badge">{p.badge}</span>}
                </span>
                <span className="ol-tile-sub">{p.sub}</span>
              </button>
            ))}
          </div>
        </Step>

        <Step n={3} state={current < 2 ? "idle" : current === 2 ? "active" : "done"} title="Connect" text={!platform ? "Comes next." : undefined}>
          {platform === "cloudflare" && <CloudflareConnect {...props} onDone={() => setInstalled(true)} />}
          {platform && platform !== "cloudflare" && <ManualConnect {...props} platform={platform} onDone={() => setInstalled(true)} />}
        </Step>

        <Step
          n={4}
          state={live ? "done" : current === 3 ? "active" : "idle"}
          title="First visit"
          text={live ? "Page loads are arriving. Your report is below." : "MetaInfo waits for the first page load. It shows up within seconds."}
          last
        >
          {current === 3 && site && <Verify {...props} />}
        </Step>
      </ol>
    </section>
  );
}

function Step(props: { n: number; state: "done" | "active" | "idle"; title: string; text?: ReactNode; last?: boolean; children?: ReactNode }) {
  return (
    <li className={`ol-step ol-step-${props.state}`}>
      <div className="ol-rail">
        <span className="ol-dot" aria-hidden>{props.state === "done" ? <CheckIcon /> : props.n}</span>
        {!props.last && <span className="ol-line" />}
      </div>
      <div className="ol-step-card">
        <div className="ol-step-title">
          {props.title}
          <span className="sr-only">{props.state === "done" ? " (done)" : props.state === "active" ? " (current step)" : ""}</span>
        </div>
        {props.text && <p className="ol-help">{props.text}</p>}
        {props.children}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- Cloudflare: clicks only

function CloudflareConnect({ projectId, domain, admin, onSite, onDone }: SetupProps & { onDone: () => void }) {
  const [apiToken, setApiToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<CloudflareConflict[] | null>(null);
  const [done, setDone] = useState<{ deploy: CloudflareDeploy; warning?: string } | null>(null);

  if (!admin) return <p className="ol-help">Ask an admin of this workspace to connect the site.</p>;

  const deploy = async (replace: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await flushSync(); // the server reads the project (and its domain) from the synced workspace
      const r = await deployToCloudflare(projectId, apiToken, replace);
      if ("conflicts" in r) {
        setConflicts(r.conflicts ?? []);
        return;
      }
      setConflicts(null);
      setApiToken("");
      setDone({ deploy: r.deploy, warning: r.warning });
      onSite(r.site);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const d = done.deploy;
    return (
      <div className="ol-panel ol-panel-ok">
        <ul className="ol-checks">
          <li><CheckIcon /> Worker <code>{d.worker}</code> deployed to <b>{d.account}</b>, with its three secrets set</li>
          {d.routes.map((r) => (
            <li key={r.pattern}><CheckIcon /> Route <code>{r.pattern}</code> {r.action === "kept" ? "already in place" : r.action === "replaced" ? "taken over" : "added"}</li>
          ))}
        </ul>
        {done.warning && <p className="ol-warn">{done.warning}</p>}
      </div>
    );
  }

  return (
    <div className="ol-stack">
      <div className="ol-sub">
        <span className="ol-sub-n">a</span>
        <div>
          <div className="ol-sub-title">Create a Cloudflare API token</div>
          <p className="ol-help">
            Opens Cloudflare with the name and permissions filled in (Workers Scripts and Workers Routes: edit, Zone: read). Click <b>Continue to summary</b> →{" "}
            <b>Create Token</b>, then copy it.
          </p>
          <a className="ol-btn ol-btn-outline" href={cloudflareTokenUrl(domain)} target="_blank" rel="noreferrer">
            <CloudIcon /> Create token on Cloudflare <ExternalIcon />
          </a>
        </div>
      </div>
      <div className="ol-sub">
        <span className="ol-sub-n">b</span>
        <div style={{ flex: 1 }}>
          <div className="ol-sub-title">Paste it and deploy</div>
          <p className="ol-help">MetaInfo deploys the collector worker to your account and adds <code>{`${domain}/*`}</code> and <code>{`www.${domain}/*`}</code>. The token is used once and never stored.</p>
          <form
            className="ol-row"
            onSubmit={(e) => {
              e.preventDefault();
              void deploy(false);
            }}
          >
            <input
              className="ol-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Cloudflare API token"
              aria-label="Cloudflare API token"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
            />
            <button className="ol-btn ol-btn-primary" disabled={busy || apiToken.trim().length < 20}>
              {busy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
              {busy ? "Deploying…" : "Deploy collector"}
            </button>
          </form>
        </div>
      </div>
      {error && <p className="ol-error">{error}</p>}
      {conflicts && (
        <div className="ol-panel ol-panel-warn">
          <div className="ol-sub-title">Another worker is on these routes</div>
          <ul className="ol-checks">
            {conflicts.map((c) => (
              <li key={c.pattern}>
                <code>{c.pattern}</code> runs <b>{c.script}</b>
              </li>
            ))}
          </ul>
          <p className="ol-help">
            A route runs one worker. Taking it over stops <b>{conflicts[0]?.script}</b> on these routes. To keep it, add the collector inside that worker instead (pick
            “Cloudflare Worker” above). Nothing has changed yet.
          </p>
          <div className="ol-row">
            <button className="ol-btn ol-btn-danger" disabled={busy} onClick={() => void deploy(true)}>Take over the routes</button>
            <button className="ol-btn ol-btn-ghost" disabled={busy} onClick={() => setConflicts(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- everything else: copy, with the values filled in

function ManualConnect({ site, token, admin, onIssue, onDone, platform }: SetupProps & { platform: Exclude<Platform, "cloudflare">; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    if (!admin) return <p className="ol-help">Ask an admin of this workspace to create the collector settings.</p>;
    return (
      <div className="ol-stack">
        <p className="ol-help">
          {site
            ? `This site already has a collector token (ending in ${site.tokenHint}), shown only when it was created. Create a new one to fill in the steps; the old one stops working.`
            : "MetaInfo creates the three settings the collector needs and fills them into the steps."}
        </p>
        <div className="ol-row">
          <button
            className="ol-btn ol-btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onIssue();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : site ? "Create a new token" : "Create collector settings"}
          </button>
        </div>
        {error && <p className="ol-error">{error}</p>}
      </div>
    );
  }
  if (!site) return null;

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const endpoint = `${origin}/api/traffic/events`;
  const env: [string, string][] = [
    ["METAINFO_TOKEN", token],
    ["METAINFO_ORG", site.workspaceId],
    ["METAINFO_SITE", site.siteUrl],
    ...(endpoint !== HOSTED_ENDPOINT ? ([["METAINFO_ENDPOINT", endpoint]] as [string, string][]) : []),
  ];
  const files = (adapter?: string) => `mkdir -p lib/metainfo && curl -fsSL --output-dir lib/metainfo -O "${COLLECTOR_RAW}/${adapter ? `{core,${adapter}}` : "core"}.ts"`;
  const steps: { title: string; code: string; note?: string }[] =
    platform === "next"
      ? [
          {
            title: "Add the collector and report from your proxy",
            code: `${files("next")}\n\ncat > proxy.ts <<'TS'\nimport { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";\nimport { reportToMetainfo } from "./lib/metainfo/next";\n\nexport function proxy(request: NextRequest, event: NextFetchEvent) {\n  return reportToMetainfo(request, event, NextResponse.next());\n}\n\nexport const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };\nTS`,
            note: "Next.js 15 or older: name the file middleware.ts and the function middleware. Already have one? Wrap what it returns: reportToMetainfo(request, event, response).",
          },
          { title: "Add the settings to Vercel and redeploy", code: `${env.map(([k, v]) => `printf '%s' '${v}' | npx vercel env add ${k} production`).join("\n")}\nnpx vercel deploy --prod`, note: "Elsewhere, set the same variables in your host's settings." },
        ]
      : platform === "worker"
        ? [
            { title: "Add the collector", code: files("wrap") },
            { title: "Wrap your worker's handler", code: `import { withMetainfo } from "./lib/metainfo/wrap";\n\nexport default withMetainfo({\n  async fetch(request, env, ctx) {\n    // your existing handler\n  },\n});` },
            { title: "Set the secrets and deploy", code: `${env.map(([k, v]) => `printf '%s' '${v}' | npx wrangler secret put ${k}`).join("\n")}\nnpx wrangler deploy` },
          ]
        : [
            { title: "Add the collector", code: files() },
            {
              title: "Call it for every page request",
              code: `import { createCollector } from "./lib/metainfo/core";\n\nconst collector = createCollector({\n${env.map(([k, v]) => `  ${k.replace("METAINFO_", "").toLowerCase()}: "${v}",`).join("\n")}\n  via: "custom",\n});\n\n// after your handler has a response:\ncollector.observe(request, response.status, (p) => ctx.waitUntil(p));`,
              note: "Keep the token out of your repository: read it from an environment variable.",
            },
          ];

  return (
    <div className="ol-stack">
      <div className="ol-secrets">
        {env.map(([k, v]) => (
          <div key={k} className="ol-secret">
            <span className="ol-secret-k">{k}</span>
            <code className="ol-secret-v">{v}</code>
            <CopyButton text={v} className="ol-btn ol-btn-ghost ol-btn-xs" />
          </div>
        ))}
        <p className="ol-help" style={{ margin: "6px 0 0" }}>The token is shown once. It can only report traffic for {site.domain}.</p>
      </div>
      {steps.map((s, i) => (
        <div key={s.title} className="ol-sub">
          <span className="ol-sub-n">{String.fromCharCode(97 + i)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ol-sub-title">{s.title}</div>
            <CodeBlock code={s.code} />
            {s.note && <p className="ol-help">{s.note}</p>}
          </div>
        </div>
      ))}
      <div className="ol-row">
        <button className="ol-btn ol-btn-primary" onClick={onDone}>I&apos;ve deployed it</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- first visit

function Verify({ projectId, domain, onRefresh }: SetupProps) {
  const [check, setCheck] = useState<{ busy: boolean; note?: string }>({ busy: false });
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      if (++n > 60) return clearInterval(t); // 5 minutes
      refresh.current();
    }, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="ol-panel">
      <div className="ol-row" style={{ alignItems: "center" }}>
        <span className="spinner" style={{ width: 14, height: 14 }} />
        <span className="ol-help" style={{ margin: 0, flex: 1 }}>Waiting for a page load on {domain}… checking every few seconds.</span>
        <button
          className="ol-btn ol-btn-outline"
          disabled={check.busy}
          onClick={async () => {
            setCheck({ busy: true });
            try {
              const r = await sendTestVisit(projectId);
              setCheck({ busy: false, note: r.ok ? `Visited https://${domain}/ (HTTP ${r.status}). It should appear in a few seconds.` : r.error });
              setTimeout(() => refresh.current(), 6000);
            } catch (e) {
              setCheck({ busy: false, note: (e as Error).message });
            }
          }}
        >
          {check.busy ? "Visiting…" : "Send a test visit"}
        </button>
      </div>
      {check.note && <p className="ol-help" style={{ margin: "8px 0 0" }}>{check.note}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- icons (lucide-style strokes)

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
function CloudIcon() {
  return <Svg><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /></Svg>;
}
function TriangleIcon() {
  return <Svg><path d="M12 3 22 20H2Z" /></Svg>;
}
function BoltIcon() {
  return <Svg><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></Svg>;
}
function CodeIcon() {
  return <Svg><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></Svg>;
}
function CheckIcon() {
  return <Svg size={14}><path d="M20 6 9 17l-5-5" /></Svg>;
}
function ExternalIcon() {
  return <Svg size={14}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Svg>;
}
function PulseIcon() {
  return <Svg><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Svg>;
}
