"use client";

import { useMemo, useState } from "react";
import { PLATFORM_META, PLATFORMS, type Category, type Check, type Platform, type Report } from "@/lib/types";
import { CodeBlock, PlatformChips, SeverityBadge, StatusIcon } from "./ui";

type StatusFilter = "issues" | "pass" | "info" | "all";
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER = { fail: 0, warn: 1, pass: 2, info: 3 };

export function CheckCard({ check, defaultOpen = false }: { check: Check; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="check">
      <button className="check-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <StatusIcon status={check.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="check-title">{check.title}</span>
            {(check.status === "fail" || check.status === "warn") && <SeverityBadge severity={check.severity} />}
          </div>
          <div className="check-finding">{check.finding}</div>
        </div>
        <span className="muted" aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="check-body">
          {check.recommendation && (
            <div>
              <div className="label">How to fix</div>
              {check.recommendation}
            </div>
          )}
          <div>
            <div className="label">Why it matters</div>
            <span className="muted">{check.why}</span>
          </div>
          {check.snippet && (
            <div>
              <div className="label">Suggested code</div>
              <CodeBlock code={check.snippet} />
            </div>
          )}
          <div className="row" style={{ gap: 6 }}>
            <PlatformChips platforms={check.platforms} />
            <span className="badge">effort: {check.effort}</span>
            <span className="badge mono">{check.id}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Issues({
  report,
  platform,
  onPlatform,
}: {
  report: Report;
  platform: Platform | "all";
  onPlatform: (p: Platform | "all") => void;
}) {
  const [status, setStatus] = useState<StatusFilter>("issues");
  const [category, setCategory] = useState<Category | "all">("all");
  const [q, setQ] = useState("");

  const checks = useMemo(() => {
    const needle = q.toLowerCase();
    return report.checks
      .filter((c) =>
        status === "all" ? true : status === "issues" ? c.status === "fail" || c.status === "warn" : c.status === status,
      )
      .filter((c) => platform === "all" || c.platforms.includes(platform))
      .filter((c) => category === "all" || c.category === category)
      .filter((c) => !needle || `${c.title} ${c.finding} ${c.id}`.toLowerCase().includes(needle))
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  }, [report.checks, status, platform, category, q]);

  const grouped = report.categories
    .map((cat) => ({ cat, items: checks.filter((c) => c.category === cat.category) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="filters">
        <div className="segmented" role="group" aria-label="Status">
          {(["issues", "pass", "info", "all"] as StatusFilter[]).map((s) => (
            <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === "issues" ? "Issues" : s === "pass" ? "Passed" : s === "info" ? "Info" : "All"}
            </button>
          ))}
        </div>
        <select className="select" value={platform} onChange={(e) => onPlatform(e.target.value as Platform | "all")} aria-label="Platform">
          <option value="all">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_META[p].label}
            </option>
          ))}
        </select>
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value as Category | "all")} aria-label="Category">
          <option value="all">All categories</option>
          {report.categories.map((c) => (
            <option key={c.category} value={c.category}>
              {c.label}
            </option>
          ))}
        </select>
        <input className="input" style={{ height: 30, width: 200 }} placeholder="Search checks…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{checks.length} shown</span>
      </div>
      {grouped.length === 0 && <div className="card empty">No checks match these filters.</div>}
      {grouped.map((g) => (
        <section key={g.cat.category} style={{ marginBottom: 20 }}>
          <h3 className="section-title" style={{ marginBottom: 8 }}>
            {g.cat.label} <span className="muted small">score {g.cat.score}</span>
          </h3>
          <div className="check-list">
            {g.items.map((c) => (
              <CheckCard key={c.id} check={c} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
