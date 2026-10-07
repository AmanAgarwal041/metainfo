"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useProject } from "@/lib/project";
import { PageHead } from "../kit";
import { researchStatus, ResearchError, setToken } from "@/lib/research-client";
import { bareDomain, LOCATIONS, type Intent, type ResearchStatus } from "@/lib/research-types";

export function PageHeader({ title, sub }: { title: string; sub: string }) {
  return <PageHead title={title} sub={sub} />;
}

/** Your domain, competitors and market: shared by every research page. */
export function ProjectBar({ showCompetitors = true }: { showCompetitors?: boolean }) {
  const [project, update] = useProject();
  const [comp, setComp] = useState("");

  const addCompetitor = () => {
    const c = bareDomain(comp);
    if (c) update({ competitors: [...project.competitors, c] });
    setComp("");
  };

  return (
    <div className="card project-bar">
      <label className="pb-field">
        <span>Your site</span>
        <input
          key={project.domain}
          className="input"
          defaultValue={project.domain}
          placeholder="example.com"
          onBlur={(e) => update({ domain: e.currentTarget.value })}
          onKeyDown={(e) => e.key === "Enter" && update({ domain: e.currentTarget.value })}
        />
      </label>
      {showCompetitors && (
        <div className="pb-field" style={{ flex: 2 }}>
          <span>Competitors</span>
          <div className="row" style={{ gap: 6 }}>
            {project.competitors.map((c) => (
              <span key={c} className="chip" aria-pressed="true">
                {c}{" "}
                <button className="chip-x" aria-label={`Remove ${c}`} onClick={() => update({ competitors: project.competitors.filter((x) => x !== c) })}>
                  ×
                </button>
              </span>
            ))}
            {project.competitors.length < 5 && (
              <input
                className="input"
                style={{ height: 30, width: 170 }}
                placeholder="+ add competitor"
                value={comp}
                onChange={(e) => setComp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCompetitor()}
                onBlur={() => comp && addCompetitor()}
              />
            )}
          </div>
        </div>
      )}
      <label className="pb-field" style={{ flex: "none" }}>
        <span>Market</span>
        <select className="select" style={{ height: 40 }} value={project.location} onChange={(e) => update({ location: Number(e.target.value) })}>
          {LOCATIONS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function useResearchStatus(): ResearchStatus | null {
  const [s, setS] = useState<ResearchStatus | null>(null);
  useEffect(() => {
    researchStatus().then(setS);
  }, []);
  return s;
}

/** Explains how to unlock provider-backed data. `free` describes what still works without it. */
export function ProviderNotice({ unlocks, free }: { unlocks: string; free?: ReactNode }) {
  return (
    <div className="card card-pad provider-notice">
      <h3 className="section-title">Connect DataForSEO to unlock {unlocks}</h3>
      <p className="section-sub">
        Search volumes, rankings and backlink data come from DataForSEO&apos;s pay-as-you-go API (no subscription; most lookups cost a
        fraction of a cent to a few cents). Create an account at dataforseo.com, then add your API credentials to <code>.env.local</code>{" "}
        and restart the server:
      </p>
      <pre className="code" style={{ padding: "12px 14px" }}>
        <code>{`DATAFORSEO_LOGIN=you@example.com\nDATAFORSEO_PASSWORD=your-api-password   # from app.dataforseo.com/api-access\nRESEARCH_TOKEN=pick-a-secret            # optional: stops others spending your balance`}</code>
      </pre>
      {free && <div className="notice" style={{ marginTop: 12 }}>{free}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const [token, setTok] = useState("");
  if (!error) return null;
  const e = error instanceof ResearchError ? error : null;
  if (e?.code === "token") {
    return (
      <div className="card card-pad">
        <h3 className="section-title">Access token required</h3>
        <p className="section-sub">This server protects its paid research features. Enter the RESEARCH_TOKEN it was configured with.</p>
        <div className="row">
          <input className="input" style={{ width: 280 }} type="password" value={token} onChange={(ev) => setTok(ev.target.value)} />
          <button
            className="btn btn-primary"
            onClick={() => {
              setToken(token);
              onRetry?.();
            }}
          >
            Save &amp; retry
          </button>
        </div>
      </div>
    );
  }
  return <div className="error-box">{error instanceof Error ? error.message : String(error)}</div>;
}

export function CostNote({ cost, cached, extra }: { cost: number; cached: boolean; extra?: string }) {
  return (
    <span className="muted small">
      {cached ? "Served from cache (no charge)" : `DataForSEO cost: $${cost.toFixed(4)}`}
      {extra ? ` · ${extra}` : ""}
    </span>
  );
}

export function Trend({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="na">-</span>;
  const max = Math.max(...values, 1);
  const w = 64;
  const h = 18;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 1 - (v / max) * (h - 2)}`).join(" ");
  return (
    <svg width={w} height={h} aria-label={`Monthly volume trend, latest ${values[values.length - 1]}`}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function KdBadge({ kd }: { kd: number | null }) {
  if (kd == null) return <span className="na">-</span>;
  const color = kd < 30 ? "var(--pass)" : kd < 60 ? "var(--warn)" : "var(--fail)";
  return (
    <span className="kd" style={{ color, borderColor: color }}>
      {kd}
    </span>
  );
}

const INTENT_SHORT: Record<Intent, string> = { informational: "I", navigational: "N", commercial: "C", transactional: "T" };

export function IntentBadge({ intent }: { intent: Intent | null }) {
  if (!intent) return <span className="na">-</span>;
  return (
    <span className={`badge intent-${intent}`} title={intent}>
      {INTENT_SHORT[intent]}
    </span>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sort?: (row: T) => number | string | null;
  align?: "right" | "center";
  title?: string;
}

export function SortTable<T>({
  rows,
  columns,
  initialSort,
  pageSize = 50,
  empty = "No rows.",
  rowKey,
}: {
  rows: T[];
  columns: Column<T>[];
  initialSort?: { key: string; dir: "asc" | "desc" };
  pageSize?: number;
  empty?: string;
  rowKey: (row: T) => string;
}) {
  const [sort, setSort] = useState(initialSort);
  const [shown, setShown] = useState(pageSize);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    if (!col?.sort || !sort) return rows;
    const val = col.sort;
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, columns, sort]);

  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ textAlign: c.align ?? "left" }} title={c.title}>
                  {c.sort ? (
                    <button
                      className="th-sort"
                      onClick={() =>
                        setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === "desc" ? "asc" : "desc" }))
                      }
                    >
                      {c.label}
                      {sort?.key === c.key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, shown).map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > shown && (
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button className="btn btn-sm" onClick={() => setShown(shown + pageSize)}>
            Show more ({sorted.length - shown} left)
          </button>
        </div>
      )}
    </>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="card card-pad row" aria-live="polite">
      <span className="spinner" /> {label}
    </div>
  );
}
