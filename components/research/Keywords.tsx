"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useProject } from "@/lib/project";
import { fmtNum, research, toCsv } from "@/lib/research-client";
import type { KeywordResearch, KeywordRow } from "@/lib/research-types";
import { CopyButton, download } from "../ui";
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
  Trend,
  useResearchStatus,
  type Column,
} from "./common";

const GROUPS: { id: KeywordRow["group"] | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "questions", label: "Questions" },
  { id: "commercial", label: "Commercial" },
  { id: "comparisons", label: "Comparisons" },
  { id: "prepositions", label: "Prepositions" },
  { id: "other", label: "Other" },
];

/** 0-100: high volume and low difficulty is the best opportunity. */
function opportunity(r: KeywordRow): number | null {
  if (r.volume == null || r.difficulty == null) return null;
  const vol = Math.min(1, Math.log10(r.volume + 1) / 5);
  return Math.round(vol * (1 - r.difficulty / 100) * 100);
}

export default function Keywords() {
  const [project, updateProject] = useProject();
  const status = useResearchStatus();
  const [seed, setSeed] = useState("");
  const [data, setData] = useState<KeywordResearch | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [group, setGroup] = useState<(typeof GROUPS)[number]["id"]>("all");
  const [filter, setFilter] = useState("");
  const [minVol, setMinVol] = useState("");
  const [maxKd, setMaxKd] = useState("");
  const ctrl = useRef<AbortController | null>(null);

  const run = useCallback(
    async (q: string) => {
      if (!q.trim()) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      setError(null);
      try {
        const d = await research<KeywordResearch>("keywords", { q: q.trim(), loc: project.location }, c.signal);
        setData(d);
        setGroup("all");
        const u = new URL(window.location.href);
        u.searchParams.set("q", q.trim());
        window.history.replaceState(null, "", u);
      } catch (e) {
        if (!c.signal.aborted) setError(e);
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    },
    [project.location],
  );

  useEffect(() => {
    const q = new URL(window.location.href).searchParams.get("q");
    if (q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deep link (?q=) hydration
      setSeed(q);
      run(q);
    }
    // Only on first load; later searches are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    return data.keywords.filter(
      (r) =>
        (group === "all" || r.group === group) &&
        (!f || r.keyword.includes(f)) &&
        (!minVol || (r.volume ?? 0) >= Number(minVol)) &&
        (!maxKd || (r.difficulty != null && r.difficulty <= Number(maxKd))),
    );
  }, [data, group, filter, minVol, maxKd]);

  const hasMetrics = data?.provider === "dataforseo";
  const columns: Column<KeywordRow>[] = [
    {
      key: "keyword",
      label: "Keyword",
      sort: (r) => r.keyword,
      render: (r) => (
        <span>
          {r.keyword}{" "}
          {r.source === "autocomplete" && hasMetrics && r.volume == null && <span className="muted small">(autocomplete)</span>}
        </span>
      ),
    },
    ...(hasMetrics
      ? ([
          { key: "volume", label: "Volume", align: "right", sort: (r) => r.volume, render: (r) => <b>{fmtNum(r.volume)}</b>, title: "Average monthly searches" },
          { key: "kd", label: "KD", align: "center", sort: (r) => r.difficulty, render: (r) => <KdBadge kd={r.difficulty} />, title: "Keyword difficulty (0-100)" },
          { key: "cpc", label: "CPC", align: "right", sort: (r) => r.cpc, render: (r) => (r.cpc != null ? `$${r.cpc.toFixed(2)}` : "-") },
          { key: "intent", label: "Intent", align: "center", sort: (r) => r.intent, render: (r) => <IntentBadge intent={r.intent} /> },
          { key: "trend", label: "12-mo trend", render: (r) => <Trend values={r.trend} /> },
          {
            key: "opp",
            label: "Opportunity",
            align: "right",
            sort: (r) => opportunity(r),
            render: (r) => opportunity(r) ?? "-",
            title: "High volume × low difficulty, 0-100",
          },
        ] as Column<KeywordRow>[])
      : []),
    {
      key: "go",
      label: "",
      align: "right",
      render: (r) => (
        <span className="row" style={{ gap: 4, justifyContent: "flex-end", flexWrap: "nowrap" }}>
          {project.keywords.includes(r.keyword) ? (
            <span className="badge accent">tracked</span>
          ) : (
            <button className="btn btn-sm" onClick={() => updateProject({ keywords: [...project.keywords, r.keyword] })} disabled={!project.id}>
              Track
            </button>
          )}
          <Link className="btn btn-sm btn-ghost" href={`/serp?q=${encodeURIComponent(r.keyword)}`}>
            SERP
          </Link>
        </span>
      ),
    },
  ];

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.keywords.length ?? 0 };
    for (const k of data?.keywords ?? []) c[k.group] = (c[k.group] ?? 0) + 1;
    return c;
  }, [data]);

  return (
    <main className="shell">
      <PageHeader
        title="Keyword research"
        sub="Find what people search for around a topic: long-tail ideas, questions and comparisons, with search volume, difficulty, CPC and intent when DataForSEO is connected."
      />
      <ProjectBar showCompetitors={false} />
      <form
        className="card scan-box"
        style={{ maxWidth: "none", marginTop: 16 }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          run(seed);
        }}
      >
        <div className="scan-row">
          <input className="input" placeholder="Seed keyword, e.g. invoice software" value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Seed keyword" />
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Searching…" : "Find keywords"}
          </button>
        </div>
      </form>

      {status && !status.dataforseo && (
        <div style={{ marginTop: 16 }}>
          <ProviderNotice
            unlocks="search volume, difficulty, CPC and intent"
            free={<>Without it you still get free keyword ideas from Google Autocomplete: real searches people type, grouped into questions, comparisons and commercial terms.</>}
          />
        </div>
      )}

      <div style={{ marginTop: 16 }} className="stack">
        {loading && <Spinner label="Expanding the seed with Google Autocomplete and fetching keyword metrics…" />}
        <ErrorBox error={error} onRetry={() => run(seed)} />
        {data && !loading && (
          <>
            {data.seedMetrics && (
              <div className="stat-tiles">
                <div className="stat">
                  <div className="v">{fmtNum(data.seedMetrics.volume)}</div>
                  <div className="l">“{data.seed}” monthly searches</div>
                </div>
                <div className="stat">
                  <div className="v">
                    <KdBadge kd={data.seedMetrics.difficulty} />
                  </div>
                  <div className="l">Keyword difficulty</div>
                </div>
                <div className="stat">
                  <div className="v">{data.seedMetrics.cpc != null ? `$${data.seedMetrics.cpc.toFixed(2)}` : "-"}</div>
                  <div className="l">Cost per click</div>
                </div>
                <div className="stat">
                  <div className="v" style={{ textTransform: "capitalize", fontSize: 18 }}>{data.seedMetrics.intent ?? "-"}</div>
                  <div className="l">Search intent</div>
                </div>
              </div>
            )}
            {data.warnings.map((w) => (
              <div key={w} className="notice">{w}</div>
            ))}
            <div className="card card-pad">
              <div className="filters">
                <div className="segmented" role="group" aria-label="Keyword group">
                  {GROUPS.map((g) => (
                    <button key={g.id} aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
                      {g.label} <span className="muted small">{counts[g.id] ?? 0}</span>
                    </button>
                  ))}
                </div>
                <input className="input" style={{ height: 30, width: 160 }} placeholder="Contains…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                {hasMetrics && (
                  <>
                    <input className="input" style={{ height: 30, width: 110 }} placeholder="Min volume" inputMode="numeric" value={minVol} onChange={(e) => setMinVol(e.target.value.replace(/\D/g, ""))} />
                    <input className="input" style={{ height: 30, width: 90 }} placeholder="Max KD" inputMode="numeric" value={maxKd} onChange={(e) => setMaxKd(e.target.value.replace(/\D/g, ""))} />
                  </>
                )}
                <span className="spacer" />
                <CopyButton text={rows.map((r) => r.keyword).join("\n")} label="Copy keywords" />
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    download(
                      `keywords-${data.seed.replace(/\W+/g, "-")}.csv`,
                      toCsv(rows.map((r) => ({ keyword: r.keyword, volume: r.volume, difficulty: r.difficulty, cpc: r.cpc, intent: r.intent, group: r.group, source: r.source }))),
                      "text/csv",
                    )
                  }
                >
                  Export CSV
                </button>
              </div>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="muted small">
                  {rows.length} keywords · source: {hasMetrics ? "DataForSEO + search autocomplete" : "search autocomplete (free)"}
                </span>
                <span className="spacer" />
                {hasMetrics && <CostNote cost={data.cost} cached={data.cached} />}
              </div>
              <SortTable
                rows={rows}
                columns={columns}
                rowKey={(r) => r.keyword}
                initialSort={hasMetrics ? { key: "volume", dir: "desc" } : undefined}
                empty="No keywords match these filters."
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
