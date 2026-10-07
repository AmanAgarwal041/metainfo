"use client";

import { diffSnapshots, type TrackedSite } from "@/lib/history";
import { PLATFORM_META, type Platform, type Report } from "@/lib/types";
import { PlatformChips, scoreColor, SeverityBadge } from "./ui";

export default function Overview({
  report,
  site,
  onOpenIssues,
  onOpenPlan,
}: {
  report: Report;
  site: TrackedSite | null;
  onOpenIssues: (p: Platform | "all") => void;
  onOpenPlan: () => void;
}) {
  const s = report.summary;
  const topTasks = report.plan.flatMap((p) => p.tasks).slice(0, 6);
  const title = (id: string) => report.checks.find((c) => c.id === id)?.title ?? id;
  const snaps = site?.snapshots ?? [];
  const diff = snaps.length >= 2 ? diffSnapshots(snaps.at(-2), snaps.at(-1)!) : null;
  const delta = snaps.length >= 2 ? snaps.at(-1)!.overall - snaps.at(-2)!.overall : 0;
  const blocked = report.crawlers.filter((c) => !c.allowed && c.purpose !== "training");

  return (
    <div className="stack">
      {diff && (diff.fixed.length > 0 || diff.regressed.length > 0 || delta !== 0) && (
        <div className="notice">
          <b>Since your last scan:</b> overall {delta >= 0 ? "+" : ""}
          {delta}.{" "}
          {diff.fixed.length > 0 && <>Fixed: {diff.fixed.map(title).join(", ")}. </>}
          {diff.regressed.length > 0 && (
            <span style={{ color: "var(--fail)" }}>Regressed: {diff.regressed.map(title).join(", ")}.</span>
          )}
        </div>
      )}

      {blocked.length > 0 && (
        <div className="error-box" style={{ marginTop: 0 }}>
          <b>Blocked crawlers:</b> {blocked.map((b) => b.name).join(", ")}. These platforms can&apos;t read or cite this page. See
          the AI &amp; crawlers tab.
        </div>
      )}

      <div className="stat-tiles">
        <div className="stat">
          <div className="v" style={{ color: s.critical ? "var(--fail)" : undefined }}>{s.critical}</div>
          <div className="l">Critical failures</div>
        </div>
        <div className="stat">
          <div className="v" style={{ color: s.failed ? "var(--fail)" : undefined }}>{s.failed}</div>
          <div className="l">Failed checks</div>
        </div>
        <div className="stat">
          <div className="v" style={{ color: s.warnings ? "var(--warn)" : undefined }}>{s.warnings}</div>
          <div className="l">Warnings</div>
        </div>
        <div className="stat">
          <div className="v" style={{ color: "var(--pass)" }}>
            {s.passed}
            <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>/{s.total}</span>
          </div>
          <div className="l">Passed</div>
        </div>
      </div>

      <div>
        <h3 className="section-title">Visibility by platform</h3>
        <p className="section-sub">Each score weights only the checks that platform depends on. Click a card to see its issues.</p>
        <div className="platform-grid">
          {report.scores.map((p) => (
            <button key={p.platform} className="card platform-card" onClick={() => onOpenIssues(p.platform)}>
              <div className="name">
                <span className="dot" style={{ background: PLATFORM_META[p.platform].color }} />
                {PLATFORM_META[p.platform].label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 750, color: scoreColor(p.score), lineHeight: 1 }}>{p.score}</div>
              <div className="bar">
                <span style={{ width: `${p.score}%`, background: scoreColor(p.score) }} />
              </div>
              <div className="muted small">
                {p.failed} failed · {p.warnings} warnings
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="two-col">
        <div className="card card-pad">
          <h3 className="section-title">By category</h3>
          <div style={{ marginTop: 10 }}>
            {report.categories.map((c) => (
              <div className="cat-row" key={c.category}>
                <span>{c.label}</span>
                <div className="bar">
                  <span style={{ width: `${c.score}%`, background: scoreColor(c.score) }} />
                </div>
                <b style={{ textAlign: "right", color: scoreColor(c.score) }}>{c.score}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="card card-pad">
          <div className="row">
            <h3 className="section-title">Top fixes</h3>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={onOpenPlan}>
              Full plan →
            </button>
          </div>
          {topTasks.length === 0 ? (
            <p className="muted" style={{ marginTop: 10 }}>Nothing to fix. Every check passes.</p>
          ) : (
            <div style={{ marginTop: 6 }}>
              {topTasks.map((t) => (
                <div key={t.checkId} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <div className="row" style={{ gap: 6 }}>
                    <b style={{ fontSize: 13 }}>{t.title}</b>
                    <SeverityBadge severity={t.severity} />
                    <span className="badge gain">+{t.totalGain.toFixed(1)} pts</span>
                  </div>
                  <div className="muted small" style={{ marginTop: 2 }}>{t.recommendation}</div>
                  <div className="task-meta">
                    <PlatformChips platforms={t.platforms} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
