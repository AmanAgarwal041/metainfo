"use client";

import { useState, type ReactNode } from "react";
import type { SourceType } from "@/lib/aeo";
import { CHANNEL_COLOR, CONTENT_TYPES, channelLabel, type ContentType } from "@/lib/aeo-insights";
import { AI_ENGINES, type AiEngine } from "@/lib/research-types";

// Small pieces shared by the AEO tables: a search box with paging, a domain mark, channel and content badges.

export function useSearchPage<T>(rows: T[], text: (r: T) => string, size = 10) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => text(r).toLowerCase().includes(needle)) : rows;
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const p = Math.min(page, pages - 1);
  return {
    q,
    setQ: (v: string) => {
      setQ(v);
      setPage(0);
    },
    rows: filtered.slice(p * size, p * size + size),
    total: filtered.length,
    page: p,
    pages,
    setPage,
  };
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input className="input search-input" type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.currentTarget.value)} />
  );
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  if (pages <= 1) return <p className="muted small table-foot">{total} {total === 1 ? "row" : "rows"}</p>;
  return (
    <div className="row table-foot" style={{ gap: 6 }}>
      <span className="muted small">{total} rows</span>
      <span className="spacer" />
      <button className="btn btn-sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Prev</button>
      <span className="small mono">{page + 1} / {pages}</span>
      <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

/** A letter mark per domain instead of a favicon (no third-party request). */
export function DomainMark({ domain }: { domain: string }) {
  let h = 0;
  for (const c of domain) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="domain-mark" aria-hidden="true" style={{ background: `oklch(0.62 0.12 ${h})` }}>
      {domain.replace(/^www\./, "").charAt(0).toUpperCase()}
    </span>
  );
}

export function DomainCell({ domain, url, title, sub }: { domain: string; url?: string; title?: string; sub?: ReactNode }) {
  return (
    <span className="domain-cell">
      <DomainMark domain={domain} />
      <span style={{ minWidth: 0 }}>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="ellipsis" title={url}>{domain}</a>
        ) : (
          <b className="ellipsis">{domain}</b>
        )}
        {(title || sub) && <span className="muted small ellipsis" title={title}>{sub ?? title}</span>}
      </span>
    </span>
  );
}

export function ChannelBadge({ type }: { type: SourceType }) {
  return (
    <span className="badge channel-badge" style={{ ["--c" as string]: CHANNEL_COLOR[type] }}>
      {channelLabel(type)}
    </span>
  );
}

export function ContentBadge({ type }: { type: ContentType }) {
  return (
    <span className="badge channel-badge" style={{ ["--c" as string]: CONTENT_TYPES[type].color }}>
      {CONTENT_TYPES[type].label}
    </span>
  );
}

export function EngineDots({ engines }: { engines: AiEngine[] }) {
  return (
    <span className="row" style={{ gap: 3 }}>
      {AI_ENGINES.filter((e) => engines.includes(e.id)).map((e) => (
        <span key={e.id} className="dot" title={e.label} style={{ background: e.color }} />
      ))}
    </span>
  );
}

/** Card with a title, help text and an optional right-side control, like every dashboard tile. */
export function Tile({ title, sub, actions, children, className = "" }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card card-pad tile ${className}`}>
      <div className="tile-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="tile-title">{title}</h3>
          {sub && <p className="tile-sub">{sub}</p>}
        </div>
        {actions && <div className="tile-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function GroupHead({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="group-head">
      <h2>{title}</h2>
      {sub && <p>{sub}</p>}
    </div>
  );
}
