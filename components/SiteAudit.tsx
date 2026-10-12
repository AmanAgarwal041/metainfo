"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useProject } from "@/lib/project";
import { toCsv } from "@/lib/research-client";
import { auditPages, crawlSite, verifyJsPages, loadCrawlHistory, saveCrawl, summarize, type CrawlSnapshot, type PageAudit, type SiteFinding, type SiteSummary } from "@/lib/site-audit";
import { Distribution } from "./charts";
import { EmptyState, Kpi, PageHead } from "./kit";
import { SortTable, useResearchStatus, type Column } from "./research/common";
import { download, scoreColor, SeverityBadge } from "./ui";

const LIMITS = [25, 50, 100, 200];

function FindingRow({ f }: { f: SiteFinding }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="check">
      <button className="check-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`status-icon ${f.severity === "critical" || f.severity === "high" ? "s-fail" : "s-warn"}`}>!</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="check-title">{f.title}</span>
            <SeverityBadge severity={f.severity} />
            <span className="badge">{f.pages.length} {f.pages.length === 1 ? "page" : "pages"}</span>
          </div>
          <div className="check-finding">{f.detail}</div>
        </div>
        <span className="muted" aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="check-body">
          <div>
            <div className="label">How to fix</div>
            {f.fix}
          </div>
          <div>
            <div className="label">Affected pages</div>
            <ul className="plain-list">
              {f.pages.slice(0, 40).map((p, i) => (
                <li key={p.url + i}>
                  <Link href={`/audit?url=${encodeURIComponent(p.url)}`} className="break">{p.url}</Link>
                  {p.note && <span className="muted small"> {p.note}</span>}
                </li>
              ))}
            </ul>
            {f.pages.length > 40 && <p className="muted small">and {f.pages.length - 40} more (in the CSV export)</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SiteAudit() {
  const [project] = useProject();
  const status = useResearchStatus();
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(50);
  const [maxDepth, setMaxDepth] = useState(4);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [audits, setAudits] = useState<PageAudit[]>([]);
  const [history, setHistory] = useState<CrawlSnapshot[]>([]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- defaults from the stored project */
    if (project.domain) setUrl((u) => u || `https://${project.domain}/`);
    if (project.id) setHistory(loadCrawlHistory(project.id));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [project.domain, project.id]);

  const run = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setSummary(null);
    setAudits([]);
    try {
      setPhase(status?.scraper ? "Crawling with Scrapling" : "Crawling");
      const result = await crawlSite(url.trim(), maxPages, maxDepth, setPhase);
      if (!result.pages.length && !result.errors.length) throw new Error("Nothing was crawled. Is the site reachable, and does robots.txt allow crawling?");
      const t0 = performance.now();
      const pageAudits = await auditPages(result, (d, t) => setPhase(`Auditing pages ${d}/${t} with the WASM engine`));
      const analyzeMs = performance.now() - t0;
      if (status?.scraper) await verifyJsPages(result, pageAudits, setPhase);
      const s = summarize(result, pageAudits, analyzeMs);
      setAudits(pageAudits);
      setSummary(s);
      if (project.id) setHistory(saveCrawl(project.id, s));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase(null);
    }
  };

  const pageCols: Column<PageAudit>[] = [
    { key: "url", label: "Page", sort: (a) => a.page.url, render: (a) => <Link className="break small" href={`/audit?url=${encodeURIComponent(a.page.url)}`}>{a.page.url.replace(/^https?:\/\/(www\.)?/, "")}</Link> },
    { key: "status", label: "Status", align: "center", sort: (a) => a.page.status, render: (a) => <span className={a.page.status >= 400 ? "no" : a.page.status >= 300 ? "" : "yes"}>{a.page.status}</span> },
    { key: "score", label: "Score", align: "right", sort: (a) => a.report?.summary.overall ?? -1, render: (a) => (a.report ? <b style={{ color: scoreColor(a.report.summary.overall) }}>{a.report.summary.overall}</b> : <span className="na">-</span>) },
    { key: "issues", label: "Issues", align: "right", sort: (a) => (a.report ? a.report.summary.failed + a.report.summary.warnings : -1), render: (a) => (a.report ? a.report.summary.failed + a.report.summary.warnings : "") },
    { key: "words", label: "Words", align: "right", sort: (a) => a.report?.page.wordCount ?? -1, render: (a) => a.report?.page.wordCount.toLocaleString() ?? "" },
    { key: "title", label: "Title", sort: (a) => a.report?.page.title ?? "", render: (a) => <span className="small">{a.report?.page.title ?? ""}</span> },
    { key: "depth", label: "Depth", align: "center", sort: (a) => a.page.depth, render: (a) => a.page.depth },
    { key: "ms", label: "Time", align: "right", sort: (a) => a.page.ms, render: (a) => <span className="muted small">{a.page.ms != null ? `${a.page.ms} ms` : "-"}</span> },
  ];

  const exportCsv = () => {
    if (!summary) return;
    const rows = summary.findings.flatMap((f) => f.pages.map((p) => ({ finding: f.title, severity: f.severity, url: p.url, note: p.note ?? "", fix: f.fix })));
    download("site-audit-findings.csv", toCsv(rows), "text/csv");
  };

  return (
    <main className="shell">
      <PageHead
        title="Site crawl"
        sub={
          <>
            Crawl a whole site, audit every page with the WASM engine, and get site-wide fixes: broken links, duplicates, sitemap gaps, thin and
            orphaned pages, and issues to fix once in your template.{" "}
            {status && (status.scraper ? <span className="badge gain">Scrapling crawler</span> : <span className="badge">built-in crawler</span>)}
          </>
        }
      />
      <div className="stack">
        <form className="card scan-box" style={{ maxWidth: "none", margin: 0 }} onSubmit={run}>
          <div className="scan-row">
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yoursite.com/" aria-label="Start URL" />
            <select className="select" style={{ height: 42 }} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} aria-label="Maximum pages">
              {LIMITS.map((l) => <option key={l} value={l}>{l} pages</option>)}
            </select>
            <select className="select" style={{ height: 42 }} value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} aria-label="Maximum depth">
              {[2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d} clicks deep</option>)}
            </select>
            <button className="btn btn-primary" type="submit" disabled={!!phase}>{phase ? "Crawling" : "Crawl site"}</button>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Same host only, robots.txt obeyed, identified as MetaInfoBot. {status?.scraper ? "Crawled server-side by the Scrapling service." : "Without a Scrapling service, pages are fetched one by one through this app (slower)."}
          </p>
          {error && <div className="error-box">{error}</div>}
        </form>

        {phase && (
          <div className="card card-pad row small" aria-live="polite">
            <span className="spinner" /> {phase}
          </div>
        )}

        {!summary && !phase && (
          <div className="card">
            <EmptyState title="No crawl yet" body="Start with your homepage. Bigger crawls find more site-wide problems but take longer." />
            {history.length > 0 && (
              <div className="card-pad">
                <div className="field-label" style={{ marginBottom: 6 }}>Previous crawls</div>
                <div className="list-rows">
                  {[...history].reverse().slice(0, 5).map((h) => (
                    <div className="list-row" key={h.at}>
                      <span style={{ flex: 1 }}>{new Date(h.at).toLocaleString()}</span>
                      <span>{h.pages} pages</span>
                      <b style={{ color: h.avgScore != null ? scoreColor(h.avgScore) : undefined }}>{h.avgScore ?? "-"}</b>
                      <span className="muted small">{h.findings} findings, {h.broken} broken</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {summary && (
          <>
            <div className="kpi-row">
              <Kpi label="Average page score" value={summary.avgScore ?? "n/a"} tone={summary.avgScore != null ? scoreColor(summary.avgScore) : undefined} foot={`${summary.htmlPages} HTML pages audited`} />
              <Kpi label="Pages crawled" value={summary.pagesCrawled} foot={`${(summary.crawlMs / 1000).toFixed(1)} s crawl, ${(summary.analyzeMs / 1000).toFixed(1)} s analysis (${summary.engine === "scrapling" ? "Scrapling" : "built-in"})`} />
              <Kpi label="Broken internal links" value={summary.broken} tone={summary.broken ? "var(--fail)" : "var(--pass)"} foot="4xx/5xx or unreachable" />
              <Kpi label="Site-wide findings" value={summary.findings.length} foot={`${summary.templateIssues.length} template issues`} />
            </div>

            <section className="card card-pad">
              <h2 className="section-title">Page scores</h2>
              <div style={{ marginTop: 10 }}>
                <Distribution
                  ariaLabel="Pages by score"
                  parts={[
                    { label: "80 and above", value: summary.scoreBuckets.good, color: "var(--pass)" },
                    { label: "55 to 79", value: summary.scoreBuckets.ok, color: "var(--warn)" },
                    { label: "Below 55", value: summary.scoreBuckets.poor, color: "var(--fail)" },
                  ]}
                />
              </div>
            </section>

            <section>
              <div className="row" style={{ marginBottom: 8 }}>
                <h2 className="section-title">Optimisation suggestions</h2>
                <span className="muted small">Ranked by severity and how many pages are affected</span>
                <span className="spacer" />
                <button className="btn btn-sm" onClick={exportCsv}>Export CSV</button>
              </div>
              {summary.findings.length ? (
                <div className="check-list">
                  {summary.findings.map((f) => <FindingRow key={f.id} f={f} />)}
                </div>
              ) : (
                <div className="card empty">No site-wide problems found in the crawled pages.</div>
              )}
            </section>

            {summary.templateIssues.length > 0 && (
              <section className="card card-pad">
                <h2 className="section-title">Fix once in your template</h2>
                <p className="section-sub">These checks fail on most pages, so the cause is almost certainly a shared layout or component. One fix improves every page.</p>
                <div className="list-rows">
                  {summary.templateIssues.map((t) => (
                    <div className="list-row" key={t.checkId}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{t.title}</div>
                        <div className="muted small">{t.recommendation}</div>
                      </div>
                      <SeverityBadge severity={t.severity} />
                      <span className="badge">{Math.round(t.share * 100)}% of pages</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {summary.sitemap && (
              <section className="card card-pad">
                <h2 className="section-title">Sitemap coverage</h2>
                <p className="small" style={{ marginTop: 6 }}>
                  The sitemap lists <b>{summary.sitemap.listed.toLocaleString()}</b> URLs. Of the indexable pages crawled, <b>{summary.sitemap.crawledListed}</b> are listed and{" "}
                  <b style={{ color: summary.sitemap.crawledNotListed ? "var(--warn)" : undefined }}>{summary.sitemap.crawledNotListed}</b> are missing.
                </p>
              </section>
            )}

            <section className="card card-pad">
              <h2 className="section-title">Pages ({audits.length})</h2>
              <SortTable rows={audits} columns={pageCols} rowKey={(a) => a.page.url} initialSort={{ key: "score", dir: "asc" }} pageSize={50} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
