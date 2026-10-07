"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { scanMany, type PageScan } from "@/lib/engine";
import { useProject } from "@/lib/project";
import { checkFromSerp, rankHistory, rankKey, recordRanks, trackedKeywords, type RankCheck } from "@/lib/rank-history";
import { fmtNum, research } from "@/lib/research-client";
import { bareDomain, locationByCode, type SerpResult } from "@/lib/research-types";
import type { Report } from "@/lib/types";
import { scoreColor } from "../ui";
import { CostNote, ErrorBox, PageHeader, ProjectBar, ProviderNotice, Spinner, useResearchStatus } from "./common";

const FEATURE_LABEL: Record<string, string> = {
  ai_overview: "AI Overview",
  featured_snippet: "Featured snippet",
  people_also_ask: "People also ask",
  local_pack: "Local pack",
  video: "Videos",
  images: "Images",
  top_stories: "Top stories",
  knowledge_graph: "Knowledge panel",
  related_searches: "Related searches",
  shopping: "Shopping",
  paid: "Ads",
  twitter: "X posts",
  discussions_and_forums: "Discussions & forums",
  perspectives: "Perspectives",
};

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** What the top-ranking pages have in common, for "what it takes to rank". */
function Benchmark({ scans, mineUrl }: { scans: PageScan[]; mineUrl: string | null }) {
  const ok = scans.filter((s) => s.report);
  const top = ok.filter((s) => s.url !== mineUrl);
  const mine = ok.find((s) => s.url === mineUrl)?.report;
  if (!top.length) return <div className="error-box">Couldn&apos;t scan any of the top results.</div>;
  const rows: { label: string; v: (r: Report) => number; fmt?: (n: number) => string }[] = [
    { label: "Words", v: (r) => r.page.wordCount },
    { label: "Title length", v: (r) => [...(r.page.title ?? "")].length },
    { label: "H2 sections", v: (r) => r.page.headings.filter((h) => h.level === 2).length },
    { label: "Question headings", v: (r) => r.page.questionHeadings },
    { label: "Images", v: (r) => r.page.imageCount },
    { label: "Internal links", v: (r) => r.page.linkStats.internal },
    { label: "Lists + tables", v: (r) => r.page.lists + r.page.tables },
    { label: "Overall audit score", v: (r) => r.summary.overall },
    { label: "TTFB (ms)", v: (r) => r.ttfbMs ?? 0 },
  ];
  const schema = new Map<string, number>();
  for (const s of top) for (const t of new Set(s.report!.page.jsonLd.flatMap((b) => b.types))) schema.set(t, (schema.get(t) ?? 0) + 1);

  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Metric</th>
              <th style={{ textAlign: "right" }}>Top results (median)</th>
              <th style={{ textAlign: "right" }}>Range</th>
              {mine && <th style={{ textAlign: "right" }}>Your page</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const vals = top.map((s) => row.v(s.report!));
              const med = median(vals);
              const yours = mine ? row.v(mine) : null;
              return (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{med.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }} className="muted">
                    {Math.min(...vals).toLocaleString()}-{Math.max(...vals).toLocaleString()}
                  </td>
                  {mine && (
                    <td style={{ textAlign: "right", fontWeight: 600, color: yours != null && row.label !== "TTFB (ms)" && yours < med * 0.6 ? "var(--warn)" : undefined }}>
                      {yours?.toLocaleString()}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="small">
        <b>Structured data on top results:</b>{" "}
        {[...schema.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([t, n]) => `${t} (${n}/${top.length})`)
          .join(", ") || "none"}
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Page</th>
              <th style={{ textAlign: "right" }}>Words</th>
              <th style={{ textAlign: "right" }}>Score</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {scans.map((s) => (
              <tr key={s.url}>
                <td className="break small">
                  {s.url === mineUrl && <span className="badge accent">you</span>} {s.url}
                </td>
                <td style={{ textAlign: "right" }}>{s.report ? s.report.page.wordCount.toLocaleString() : "-"}</td>
                <td style={{ textAlign: "right", fontWeight: 700, color: s.report ? scoreColor(s.report.summary.overall) : undefined }}>
                  {s.report ? s.report.summary.overall : <span className="na small">{s.error}</span>}
                </td>
                <td style={{ textAlign: "right" }}>
                  <a className="btn btn-sm btn-ghost" href={`/audit?url=${encodeURIComponent(s.url)}`}>
                    Audit →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BenchmarkRunner({ urls, mineUrl, label }: { urls: string[]; mineUrl: string | null; label: string }) {
  const [scans, setScans] = useState<PageScan[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const all = mineUrl && !urls.includes(mineUrl) ? [...urls, mineUrl] : urls;
  const run = async () => {
    setProgress(`0/${all.length}`);
    setScans(await scanMany(all, (d) => setProgress(`${d}/${all.length}`)));
    setProgress(null);
  };
  return (
    <div className="card card-pad">
      <div className="row">
        <div>
          <h3 className="section-title">
            What it takes to rank <span className="badge gain">free</span>
          </h3>
          <p className="section-sub" style={{ marginBottom: 0 }}>{label}</p>
        </div>
        <span className="spacer" />
        <button className="btn btn-primary" disabled={!urls.length || !!progress} onClick={run}>
          {progress ? `Scanning ${progress}…` : scans ? "Re-run benchmark" : "Benchmark pages"}
        </button>
      </div>
      {scans && (
        <div style={{ marginTop: 14 }}>
          <Benchmark scans={scans} mineUrl={mineUrl} />
        </div>
      )}
    </div>
  );
}

function ManualBenchmark() {
  const [project] = useProject();
  const [urls, setUrls] = useState("");
  const [mine, setMine] = useState("");
  const list = urls.split(/\s+/).filter((u) => /^https?:\/\//.test(u)).slice(0, 8);
  return (
    <div className="stack">
      <div className="card card-pad">
        <h3 className="section-title">Benchmark ranking pages manually</h3>
        <p className="section-sub">Search your keyword in Google, paste the top results here, and compare them with your page.</p>
        <div className="two-col">
          <div className="field">
            <label>Top-ranking URLs (one per line)</label>
            <textarea className="textarea" style={{ minHeight: 110, fontFamily: "var(--sans)" }} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://…" />
          </div>
          <div className="field">
            <label>Your page (optional)</label>
            <input className="input" value={mine} onChange={(e) => setMine(e.target.value)} placeholder={project.domain ? `https://${project.domain}/…` : "https://yoursite.com/page"} />
          </div>
        </div>
      </div>
      <BenchmarkRunner urls={list} mineUrl={/^https?:\/\//.test(mine) ? mine : null} label="Median content depth, structure and technical scores of the pages you pasted." />
    </div>
  );
}

function RankHistory({ checks, domains }: { checks: RankCheck[]; domains: string[] }) {
  if (checks.length === 0) return null;
  const rows = [...checks].reverse().slice(0, 15);
  return (
    <div className="card card-pad">
      <h3 className="section-title">Rank history for this keyword</h3>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="t">
          <thead>
            <tr>
              <th>Checked</th>
              {domains.map((d, i) => (
                <th key={d} style={{ textAlign: "center" }}>
                  {d} {i === 0 && <span className="badge accent">you</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const prev = rows[i + 1];
              return (
                <tr key={c.checkedAt}>
                  <td className="small">{new Date(c.checkedAt).toLocaleString()}</td>
                  {domains.map((d) => {
                    const p = c.positions[d];
                    const q = prev?.positions[d];
                    const delta = p != null && q != null ? q - p : null;
                    return (
                      <td key={d} style={{ textAlign: "center", fontWeight: 600 }}>
                        {p != null ? `#${p}` : <span className="na">-</span>}
                        {delta ? <span className="small" style={{ color: delta > 0 ? "var(--pass)" : "var(--fail)", marginLeft: 4 }}>{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LiveSerp() {
  const [project] = useProject();
  const [q, setQ] = useState("");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [data, setData] = useState<SerpResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<RankCheck[]>([]);
  const [tracked, setTracked] = useState<ReturnType<typeof trackedKeywords>>([]);
  const domains = [project.domain, ...project.competitors].filter(Boolean);

  const run = useCallback(
    async (keyword: string, dev = device) => {
      if (!keyword.trim()) return;
      setLoading(true);
      setError(null);
      try {
        const d = await research<SerpResult>("serp", { q: keyword.trim(), loc: project.location, device: dev });
        setData(d);
        setHistory(recordRanks(rankKey(d.keyword, d.location, d.device), checkFromSerp(d, domains)));
        setTracked(trackedKeywords());
        const u = new URL(window.location.href);
        u.searchParams.set("q", keyword.trim());
        window.history.replaceState(null, "", u);
      } catch (e) {
        setError(e);
      } finally {
        setLoading(false);
      }
    },
    // domains is derived from project; project is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, device],
  );

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate from URL + localStorage after mount */
    setTracked(trackedKeywords());
    const initial = new URL(window.location.href).searchParams.get("q");
    if (initial) {
      setQ(initial);
      setHistory(rankHistory(rankKey(initial, project.location, device)));
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // first load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isMine = (d: string) => project.domain && (d === project.domain || d.endsWith(`.${project.domain}`));
  const isComp = (d: string) => project.competitors.some((c) => d === c || d.endsWith(`.${c}`));
  const mine = data?.organic.find((o) => isMine(o.domain));
  const aiCitesYou = data?.aiOverview?.references.some((r) => isMine(r.domain));

  return (
    <div className="stack">
      <form
        className="card scan-box"
        style={{ maxWidth: "none", margin: 0 }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          run(q);
        }}
      >
        <div className="scan-row">
          <input className="input" placeholder="Keyword, e.g. best invoice software" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Keyword" />
          <div className="segmented" role="group" aria-label="Device" style={{ alignSelf: "center" }}>
            {(["desktop", "mobile"] as const).map((d) => (
              <button type="button" key={d} aria-pressed={device === d} onClick={() => setDevice(d)}>
                {d === "desktop" ? "Desktop" : "Mobile"}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Checking…" : "Analyse SERP"}
          </button>
        </div>
        {tracked.length > 0 && (
          <div className="chips">
            <span className="muted small">Tracked:</span>
            {tracked.slice(0, 10).map((t) => (
              <button
                type="button"
                key={t.key}
                className="chip"
                title={`${locationByCode(t.location).name} · ${t.device}`}
                onClick={() => {
                  setQ(t.keyword);
                  setDevice(t.device as "desktop" | "mobile");
                  setHistory(rankHistory(t.key));
                  run(t.keyword, t.device as "desktop" | "mobile");
                }}
              >
                {t.keyword} {project.domain && t.last.positions[project.domain] != null ? `#${t.last.positions[project.domain]}` : ""}
              </button>
            ))}
          </div>
        )}
      </form>

      {loading && <Spinner label="Fetching live Google results…" />}
      <ErrorBox error={error} onRetry={() => run(q)} />
      {data && !loading && (
        <>
          <div className="stat-tiles">
            <div className="stat">
              <div className="v" style={{ color: mine ? (mine.position <= 3 ? "var(--pass)" : mine.position <= 10 ? "var(--warn)" : undefined) : "var(--fail)" }}>
                {mine ? `#${mine.position}` : project.domain ? "-" : "?"}
              </div>
              <div className="l">{project.domain ? `${project.domain} position${mine ? "" : " (not in top 20)"}` : "Set your site to see your position"}</div>
            </div>
            <div className="stat">
              <div className="v">{fmtNum(data.resultsCount)}</div>
              <div className="l">Google results</div>
            </div>
            <div className="stat">
              <div className="v" style={{ color: data.aiOverview ? (aiCitesYou ? "var(--pass)" : "var(--warn)") : undefined }}>
                {data.aiOverview ? (aiCitesYou ? "Cited" : "Not cited") : "None"}
              </div>
              <div className="l">AI Overview</div>
            </div>
            <div className="stat">
              <div className="v" style={{ fontSize: 16 }}>{data.featuredSnippet ? data.featuredSnippet.domain : "None"}</div>
              <div className="l">Featured snippet owner</div>
            </div>
          </div>

          <div className="row">
            {data.features.filter((f) => f !== "organic").map((f) => (
              <span key={f} className="badge">{FEATURE_LABEL[f] ?? f.replace(/_/g, " ")}</span>
            ))}
            <span className="spacer" />
            <CostNote cost={data.cost} cached={data.cached} extra={`${locationByCode(data.location).name} · ${data.device}`} />
          </div>

          <div className="two-col" style={{ alignItems: "start" }}>
            <div className="card card-pad">
              <h3 className="section-title">Organic results</h3>
              <ol className="serp-list">
                {data.organic.map((o) => (
                  <li key={`${o.absolute}-${o.url}`} className={isMine(o.domain) ? "is-mine" : isComp(o.domain) ? "is-comp" : ""}>
                    <span className="pos">{o.position}</span>
                    <div style={{ minWidth: 0 }}>
                      <a href={o.url} target="_blank" rel="noreferrer" className="break">
                        {o.title || o.url}
                      </a>
                      <div className="muted small break">
                        {o.domain}
                        {isMine(o.domain) && <span className="badge accent" style={{ marginLeft: 6 }}>you</span>}
                        {isComp(o.domain) && <span className="badge" style={{ marginLeft: 6 }}>competitor</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="stack">
              {data.aiOverview && (
                <div className="card card-pad">
                  <h3 className="section-title">AI Overview sources</h3>
                  {data.aiOverview.references.length === 0 ? (
                    <p className="muted small">An AI Overview is shown, but its sources weren&apos;t returned.</p>
                  ) : (
                    <ul className="plain-list">
                      {data.aiOverview.references.map((r) => (
                        <li key={r.url} className={isMine(r.domain) ? "is-mine" : ""}>
                          <a href={r.url} target="_blank" rel="noreferrer">{r.domain}</a> <span className="muted small">{r.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!aiCitesYou && <p className="small" style={{ marginTop: 8 }}>To get cited: answer the query directly in a self-contained paragraph, add FAQ/HowTo-style sections, and make sure Googlebot can crawl the page. The site audit checks all of this.</p>}
                </div>
              )}
              {data.peopleAlsoAsk.length > 0 && (
                <div className="card card-pad">
                  <h3 className="section-title">People also ask</h3>
                  <ul className="plain-list">
                    {data.peopleAlsoAsk.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <p className="muted small" style={{ marginTop: 6 }}>Answer these as H2/H3 questions with 1-2 sentence answers to target the box and AI answers.</p>
                </div>
              )}
              {data.relatedSearches.length > 0 && (
                <div className="card card-pad">
                  <h3 className="section-title">Related searches</h3>
                  <div className="chips">
                    {data.relatedSearches.map((r) => (
                      <Link key={r} className="chip" href={`/keywords?q=${encodeURIComponent(r)}`}>
                        {r}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <RankHistory checks={history} domains={domains.length ? domains : []} />
          <BenchmarkRunner
            key={data.checkedAt}
            urls={data.organic.slice(0, 5).map((o) => o.url)}
            mineUrl={mine?.url ?? (project.domain ? `https://${bareDomain(project.domain)}/` : null)}
            label={`Scans the top 5 results for “${data.keyword}”${mine || project.domain ? " and your page" : ""} and compares content depth, structure and technical scores.`}
          />
        </>
      )}
    </div>
  );
}

export default function Serp() {
  const status = useResearchStatus();
  return (
    <main className="shell">
      <PageHeader
        title="SERP analysis"
        sub="See exactly what Google shows for a keyword: who ranks, which features appear, whether an AI Overview cites you, and what the top pages have in common. Every check is saved so you can track positions."
      />
      <ProjectBar />
      <div style={{ marginTop: 16 }}>
        {status?.dataforseo ? (
          <LiveSerp />
        ) : (
          status && (
            <div className="stack">
              <ProviderNotice unlocks="live Google results, rank tracking and AI Overview citations" free={<>You can still benchmark the pages that rank. Paste their URLs below.</>} />
              <ManualBenchmark />
            </div>
          )
        )}
      </div>
    </main>
  );
}

