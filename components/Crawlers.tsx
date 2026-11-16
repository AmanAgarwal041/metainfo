"use client";

import Link from "next/link";
import { useProject } from "@/lib/project";
import { hostMatches } from "@/lib/traffic";
import { useTraffic } from "@/lib/traffic-client";
import { PLATFORM_META, type CrawlerAccess, type Report } from "@/lib/types";
import { CodeBlock, hostOf } from "./ui";

/** robots.txt tokens that no crawler sends as a user agent: their visits show up as the main crawler's. */
const TOKEN_ONLY = new Set(["google-extended", "applebot-extended"]);
const DAYS = 30;

const PURPOSE: Record<CrawlerAccess["purpose"], string> = {
  search: "Search index",
  user: "Live fetch for users",
  training: "Model training",
};

function Verdict({ ok, label }: { ok: boolean | null | undefined; label?: string }) {
  if (ok == null) return <span className="na">-</span>;
  return <span className={ok ? "yes" : "no"}>{label ?? (ok ? "Allowed" : "Blocked")}</span>;
}

export default function Crawlers({ report }: { report: Report }) {
  const { robots, sitemap, llms } = report;
  // Real visits from the project's traffic collector, when this audit is of the project's site.
  const [project] = useProject();
  const ours = !!project.id && hostMatches(hostOf(report.finalUrl || report.url), project.domain);
  const traffic = useTraffic(ours ? project.id : null, DAYS);
  const seen = traffic.state === "ready" && traffic.site.lastEventAt ? traffic.stats : null;
  const visits = (id: string) => seen?.agents.filter((a) => a.agent === id).reduce((v, a) => ({ hits: v.hits + a.hits, errors: v.errors + a.errors }), { hits: 0, errors: 0 });
  if (report.crawlers.length === 0) {
    return (
      <div className="card empty">
        Crawler access, robots.txt, sitemaps and llms.txt need a live URL. Pasted HTML has none. Scan the URL instead.
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="card card-pad">
        <h3 className="section-title">Crawler access matrix</h3>
        <p className="section-sub">
          Two checks per crawler: what <code>robots.txt</code> allows for this exact URL, and the HTTP status the server or CDN
          returned when we requested the page with that crawler&apos;s user agent. Blocking <i>training</i> crawlers doesn&apos;t remove
          you from AI answers. Blocking <i>search</i> and <i>live-fetch</i> crawlers does.
        </p>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Crawler</th>
                <th>Used for</th>
                <th>Platform</th>
                <th>robots.txt</th>
                <th>Server response</th>
                {seen && <th>Real visits ({DAYS} days)</th>}
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {report.crawlers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b>
                    <div className="muted small">{c.operator}</div>
                  </td>
                  <td>{PURPOSE[c.purpose]}</td>
                  <td>
                    {c.platform ? (
                      <span className="badge">
                        <span className="dot" style={{ background: PLATFORM_META[c.platform].color }} />
                        {PLATFORM_META[c.platform].short}
                      </span>
                    ) : (
                      <span className="muted small">Other AI</span>
                    )}
                  </td>
                  <td>
                    <Verdict ok={c.robotsAllowed} />
                    {c.robotsRule && <div className="muted small mono">{c.robotsRule}</div>}
                    {!c.robotsRule && c.robotsGroup && <div className="muted small">group: {c.robotsGroup}</div>}
                  </td>
                  <td>
                    {c.edgeInconclusive ? (
                      <span className="muted" title="The server also rejected our Googlebot user agent, so it likely verifies crawler IPs.">
                        HTTP {c.edgeStatus} <span className="small">(inconclusive)</span>
                      </span>
                    ) : c.edgeStatus != null ? (
                      <Verdict ok={!(c.edgeStatus === 401 || c.edgeStatus === 403 || c.edgeStatus === 429 || c.edgeStatus >= 500)} label={`HTTP ${c.edgeStatus}`} />
                    ) : c.edgeError ? (
                      <span className="muted small">{c.edgeError}</span>
                    ) : (
                      <span className="na" title="Training crawlers aren't probed">-</span>
                    )}
                  </td>
                  {seen && (
                    <td>
                      {TOKEN_ONLY.has(c.id) ? (
                        <span className="na" title="A robots.txt token only: this crawler visits as Googlebot or Applebot">-</span>
                      ) : (
                        (() => {
                          const v = visits(c.id)!;
                          if (!v.hits) return <span className="muted small">None</span>;
                          return (
                            <>
                              <b className="mono">{v.hits.toLocaleString()}</b>
                              {v.errors > 0 && <div className="no small">{v.errors.toLocaleString()} got errors</div>}
                            </>
                          );
                        })()
                      )}
                    </td>
                  )}
                  <td>
                    <Verdict ok={c.allowed} label={c.allowed ? "✓ Can access" : "✕ Blocked"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.crawlers.some((c) => c.edgeInconclusive) && (
          <div className="notice" style={{ marginTop: 12 }}>
            This server rejected even our <b>Googlebot</b> probe, so it verifies crawlers by IP address and turns away look-alike
            user agents. The real crawlers may well get through. The robots.txt column is still authoritative. Check your CDN
            bot analytics to confirm the AI crawlers are served.
          </div>
        )}
        {seen ? (
          <p className="muted small" style={{ marginTop: 10 }}>
            Real visits are page loads your <Link href="/traffic">traffic collector</Link> reported for {traffic.state === "ready" ? traffic.site.domain : "this site"}, across the whole
            site. A crawler with visits that got errors is being blocked even if robots.txt allows it.
          </p>
        ) : ours && (traffic.state === "none" || (traffic.state === "ready" && !traffic.site.lastEventAt)) ? (
          <p className="muted small" style={{ marginTop: 10 }}>
            These are probes. <Link href="/traffic">Connect a traffic collector</Link> to add each crawler&apos;s real visits to this table.
          </p>
        ) : null}
        <p className="muted small" style={{ marginTop: 10 }}>
          Probes send only the crawler&apos;s user-agent string from our server. CDNs that verify bots by IP (Cloudflare, Akamai) may
          treat the real crawler differently. Confirm in your CDN&apos;s bot analytics.
        </p>
      </div>

      <div className="two-col">
        <div className="card card-pad">
          <h3 className="section-title">robots.txt</h3>
          {robots?.found ? (
            <>
              <p className="section-sub">
                {robots.agents.length} user-agent groups · {robots.sitemaps.length} sitemap line(s) · {robots.bytes} bytes
              </p>
              {robots.contentSignals.length > 0 && (
                <div className="notice small" style={{ marginBottom: 10 }}>
                  <b>Content signals</b> (contentsignals.org): {robots.contentSignals.map((c) => <code key={c}>{c}</code>)}. This declares how
                  AI systems may use your content: <code>search</code> for search results, <code>ai-input</code> for grounding AI answers,
                  and <code>ai-train</code> for model training.
                </div>
              )}
              {robots.warnings.length > 0 && (
                <ul className="small" style={{ color: "var(--warn)", paddingLeft: 18 }}>
                  {robots.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <CodeBlock code={robots.body ?? ""} />
            </>
          ) : (
            <p className="muted">
              Not found ({robots?.status ?? "network error"}). A generated version is in <b>Generated files</b>.
            </p>
          )}
        </div>
        <div className="card card-pad stack">
          <div>
            <h3 className="section-title">Sitemap</h3>
            {sitemap?.found ? (
              <div className="small">
                <p>
                  <b>{sitemap.urlCount.toLocaleString()}</b> URLs in fetched files{sitemap.partial ? " (first 1 MB of each file)" : ""} · {sitemap.lastmodCount.toLocaleString()} with lastmod
                  {sitemap.latestLastmod && <> · latest {sitemap.latestLastmod}</>}
                </p>
                <p>
                  This page listed:{" "}
                  <Verdict ok={sitemap.containsPage} label={sitemap.containsPage == null ? "unknown" : sitemap.containsPage ? "Yes" : "No"} />
                  {" · "}Declared in robots.txt: <Verdict ok={sitemap.declaredInRobots} label={sitemap.declaredInRobots ? "Yes" : "No"} />
                </p>
              </div>
            ) : (
              <p className="muted small">No valid sitemap found.</p>
            )}
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="t">
                <tbody>
                  {sitemap?.sources.map((s) => (
                    <tr key={s.url}>
                      <td className="break small">{s.url}</td>
                      <td className="small">{s.status ?? "-"}</td>
                      <td className="small">{s.kind}</td>
                      <td className="small">{s.urlCount || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sitemap?.issues.map((i) => (
              <div key={i} className="small" style={{ color: "var(--warn)" }}>
                {i}
              </div>
            ))}
          </div>
          <div>
            <h3 className="section-title">llms.txt</h3>
            {llms?.found ? (
              <div className="small">
                <p>
                  <b>{llms.title}</b> · {llms.sections.length} sections · {llms.linkCount} links
                </p>
                {llms.summary && <p className="muted">{llms.summary}</p>}
                {llms.issues.map((i) => (
                  <div key={i} style={{ color: "var(--warn)" }}>
                    {i}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">
                Not found{llms?.status ? ` (HTTP ${llms.status})` : ""}. {llms?.issues[0]} A draft generated from your page is in{" "}
                <b>Generated files</b>.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
