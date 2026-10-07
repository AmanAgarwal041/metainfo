"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { scanMany, termCounts, type PageScan } from "@/lib/engine";
import { useProject } from "@/lib/project";
import { fmtNum, research, toCsv } from "@/lib/research-client";
import type { GapRow, KeywordGap as KeywordGapT } from "@/lib/research-types";
import { download, hostOf } from "../ui";
import {
  CostNote,
  ErrorBox,
  IntentBadge,
  KdBadge,
  PageHeader,
  ProjectBar,
  ProviderNotice,
  SortTable,
  Spinner,
  useResearchStatus,
  type Column,
} from "./common";

type GapTab = GapRow["status"];
const GAP_TABS: { id: GapTab; label: string; help: string }[] = [
  { id: "missing", label: "Missing", help: "Competitors rank, you don't. Your biggest content opportunities." },
  { id: "weak", label: "Weak", help: "You rank, but a competitor ranks higher." },
  { id: "strong", label: "Strong", help: "You outrank every competitor that ranks." },
];

function RankingGap() {
  const [project] = useProject();
  const [data, setData] = useState<KeywordGapT | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<GapTab>("missing");

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await research<KeywordGapT>("gap", { you: project.domain, them: project.competitors.join(","), loc: project.location }));
      setTab("missing");
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const rows = data?.rows.filter((r) => r.status === tab) ?? [];
  const posCell = (r: GapRow, d: string) =>
    r.positions[d] != null ? (
      <a href={r.urls[d]} target="_blank" rel="noreferrer" title={r.urls[d]}>
        #{r.positions[d]}
      </a>
    ) : (
      <span className="na">-</span>
    );
  const columns: Column<GapRow>[] = data
    ? [
        { key: "kw", label: "Keyword", sort: (r) => r.keyword, render: (r) => r.keyword },
        { key: "vol", label: "Volume", align: "right", sort: (r) => r.volume, render: (r) => <b>{fmtNum(r.volume)}</b> },
        { key: "kd", label: "KD", align: "center", sort: (r) => r.difficulty, render: (r) => <KdBadge kd={r.difficulty} /> },
        { key: "intent", label: "Intent", align: "center", render: (r) => <IntentBadge intent={r.intent} /> },
        { key: "you", label: data.you, align: "center", sort: (r) => r.positions[data.you] ?? 999, render: (r) => posCell(r, data.you) },
        ...data.competitors.map(
          (c): Column<GapRow> => ({ key: c, label: c, align: "center", sort: (r) => r.positions[c] ?? 999, render: (r) => posCell(r, c) }),
        ),
        {
          key: "go",
          label: "",
          align: "right",
          render: (r) => (
            <Link className="btn btn-sm btn-ghost" href={`/serp?q=${encodeURIComponent(r.keyword)}`}>
              SERP →
            </Link>
          ),
        },
      ]
    : [];

  const ready = project.domain && project.competitors.length > 0;
  return (
    <div className="card card-pad">
      <div className="row">
        <div>
          <h3 className="section-title">Ranking gap</h3>
          <p className="section-sub" style={{ marginBottom: 0 }}>Keywords your competitors rank for in Google, compared with yours.</p>
        </div>
        <span className="spacer" />
        <button className="btn btn-primary" disabled={!ready || loading} onClick={run}>
          {loading ? "Analysing…" : "Find ranking gap"}
        </button>
      </div>
      {!ready && <p className="muted small" style={{ marginTop: 10 }}>Set your site and at least one competitor above.</p>}
      <div style={{ marginTop: 14 }}>
        {loading && <Spinner label="Pulling ranked keywords for every domain…" />}
        <ErrorBox error={error} onRetry={run} />
        {data && !loading && (
          <>
            <div className="filters">
              <div className="segmented" role="group" aria-label="Gap type">
                {GAP_TABS.map((t) => (
                  <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                    {t.label} <span className="muted small">{data.rows.filter((r) => r.status === t.id).length}</span>
                  </button>
                ))}
              </div>
              <span className="muted small">{GAP_TABS.find((t) => t.id === tab)?.help}</span>
              <span className="spacer" />
              <CostNote cost={data.cost} cached={data.cached} />
              <button
                className="btn btn-sm"
                onClick={() =>
                  download(
                    `keyword-gap-${tab}.csv`,
                    toCsv(rows.map((r) => ({ keyword: r.keyword, volume: r.volume, difficulty: r.difficulty, intent: r.intent, ...Object.fromEntries([data.you, ...data.competitors].map((d) => [d, r.positions[d] ?? ""])) }))),
                    "text/csv",
                  )
                }
              >
                Export CSV
              </button>
            </div>
            {data.warnings.map((w) => (
              <div key={w} className="muted small" style={{ marginBottom: 8 }}>{w}</div>
            ))}
            <SortTable rows={rows} columns={columns} rowKey={(r) => r.keyword} initialSort={{ key: "vol", dir: "desc" }} empty="No keywords in this group." />
          </>
        )}
      </div>
    </div>
  );
}

interface ContentGapRow {
  term: string;
  usedBy: string[];
  avgCount: number;
  yourCount: number;
  prominent: boolean;
  status: "missing" | "underused";
}

function ContentGap() {
  const [project] = useProject();
  const [yourUrl, setYourUrl] = useState("");
  const [theirUrls, setTheirUrls] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [scans, setScans] = useState<PageScan[] | null>(null);
  const [rows, setRows] = useState<ContentGapRow[] | null>(null);

  const prefilled = useRef(false);
  useEffect(() => {
    // Prefill once from the stored project; after that the fields are the user's.
    if (prefilled.current || !project.domain) return;
    prefilled.current = true;
    setYourUrl(`https://${project.domain}/`);
    setTheirUrls(project.competitors.map((c) => `https://${c}/`).join("\n"));
  }, [project.domain, project.competitors]);

  const run = async () => {
    const theirs = theirUrls.split(/\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
    if (!yourUrl.trim() || !theirs.length) return;
    setRows(null);
    setProgress({ done: 0, total: theirs.length + 1 });
    const results = await scanMany([yourUrl.trim(), ...theirs], (done) => setProgress({ done, total: theirs.length + 1 }));
    setScans(results);
    const [mine, ...comps] = results;
    const okComps = comps.filter((c) => c.report);
    if (!mine.report || !mine.html || !okComps.length) {
      setProgress(null);
      setRows([]);
      return;
    }
    // Brand names aren't topics worth copying.
    const brands = new Set(results.map((r) => hostOf(r.url).split(".")[0]));
    const agg = new Map<string, { usedBy: string[]; total: number; prominent: boolean }>();
    for (const c of okComps) {
      for (const t of c.report!.page.topics.slice(0, 40)) {
        if (t.term.split(" ").some((w) => brands.has(w))) continue;
        const a = agg.get(t.term) ?? { usedBy: [], total: 0, prominent: false };
        a.usedBy.push(hostOf(c.url));
        a.total += t.count;
        a.prominent ||= t.inTitle || t.inH1 || t.inHeadings;
        agg.set(t.term, a);
      }
    }
    const terms = [...agg.keys()];
    const counts = await termCounts(mine.html, terms);
    const out: ContentGapRow[] = [];
    terms.forEach((term, i) => {
      const a = agg.get(term)!;
      const avg = a.total / a.usedBy.length;
      const yours = counts[i];
      // Single words are only worth flagging when several competitors lean on them.
      if (!term.includes(" ") && a.usedBy.length < 2) return;
      const status = yours === 0 ? "missing" : yours < avg / 3 ? "underused" : null;
      if (status) out.push({ term, usedBy: a.usedBy, avgCount: Math.round(avg * 10) / 10, yourCount: yours, prominent: a.prominent, status });
    });
    const words = (t: string) => t.split(" ").length;
    out.sort(
      (a, b) =>
        b.usedBy.length - a.usedBy.length ||
        Number(b.prominent) - Number(a.prominent) ||
        Math.min(words(b.term), 2) - Math.min(words(a.term), 2) ||
        b.avgCount - a.avgCount,
    );
    setRows(out);
    setProgress(null);
  };

  const failed = scans?.filter((s) => s.error) ?? [];
  const columns: Column<ContentGapRow>[] = [
    { key: "term", label: "Topic", sort: (r) => r.term, render: (r) => <b>{r.term}</b> },
    {
      key: "status",
      label: "Your page",
      sort: (r) => r.yourCount,
      render: (r) =>
        r.status === "missing" ? <span className="no">Not mentioned</span> : <span style={{ color: "var(--warn)" }}>Underused ({r.yourCount}×)</span>,
    },
    { key: "used", label: "Competitors using it", sort: (r) => r.usedBy.length, render: (r) => <span title={r.usedBy.join(", ")}>{r.usedBy.length} · <span className="muted small">{r.usedBy.join(", ")}</span></span> },
    { key: "avg", label: "Their mentions (avg)", align: "right", sort: (r) => r.avgCount, render: (r) => r.avgCount },
    { key: "prom", label: "In their headings", align: "center", sort: (r) => Number(r.prominent), render: (r) => (r.prominent ? <span className="yes">✓</span> : <span className="na">·</span>) },
  ];

  return (
    <div className="card card-pad">
      <h3 className="section-title">Content gap <span className="badge gain">free</span></h3>
      <p className="section-sub">
        Compares the topics on competitors&apos; pages with your page and lists what they cover that you don&apos;t. The pages are
        analysed by the WASM engine, so no data provider is needed. Compare like with like: your pricing page with theirs, your
        guide with theirs.
      </p>
      <div className="two-col">
        <div className="field">
          <label>Your page</label>
          <input className="input" value={yourUrl} onChange={(e) => setYourUrl(e.target.value)} placeholder="https://yoursite.com/page" />
        </div>
        <div className="field">
          <label>Competitor pages (one per line, up to 5)</label>
          <textarea className="textarea" style={{ minHeight: 76, fontFamily: "var(--sans)" }} value={theirUrls} onChange={(e) => setTheirUrls(e.target.value)} placeholder={"https://competitor.com/page"} />
        </div>
      </div>
      <button className="btn btn-primary" onClick={run} disabled={!!progress}>
        {progress ? `Scanning ${progress.done}/${progress.total}…` : "Find content gap"}
      </button>
      {failed.map((f) => (
        <div key={f.url} className="error-box">
          {f.url}: {f.error}
        </div>
      ))}
      {rows && (
        <div style={{ marginTop: 16 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="muted small">{rows.length} topics competitors cover more than you</span>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => download("content-gap.csv", toCsv(rows.map((r) => ({ topic: r.term, status: r.status, your_mentions: r.yourCount, competitors: r.usedBy.join(" "), their_avg_mentions: r.avgCount }))), "text/csv")}>
              Export CSV
            </button>
          </div>
          <SortTable rows={rows} columns={columns} rowKey={(r) => r.term} empty="No gaps. Your page covers every topic the competitors emphasise." />
        </div>
      )}
    </div>
  );
}

export default function KeywordGap() {
  const status = useResearchStatus();
  return (
    <main className="shell">
      <PageHeader
        title="Keyword gap"
        sub="Find the keywords and topics your competitors win that you don't: ranking gaps from Google data, and content gaps from comparing the pages themselves."
      />
      <ProjectBar />
      <div className="stack" style={{ marginTop: 16 }}>
        {status?.dataforseo ? <RankingGap /> : status && <ProviderNotice unlocks="the ranking gap (keywords competitors rank for and you don't)" free={<>The content gap below is free and works now.</>} />}
        <ContentGap />
      </div>
    </main>
  );
}
