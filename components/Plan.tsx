"use client";

import { useState } from "react";
import { setTaskState, type TaskState, type TrackedSite } from "@/lib/history";
import { PLATFORM_META, type PlanTask, type Platform, type Report } from "@/lib/types";
import { CodeBlock, CopyButton, download, PlatformChips, scoreColor, SeverityBadge } from "./ui";

const STATE_LABEL: Record<TaskState, string> = { todo: "To do", doing: "In progress", done: "Done", skipped: "Won't fix" };

function planMarkdown(report: Report): string {
  const lines = [`# SEO & AI visibility fix plan`, ``, `Page: ${report.finalUrl || "(pasted HTML)"}`, `Overall score: ${report.summary.overall}/100`, ``];
  lines.push(report.scores.map((s) => `${PLATFORM_META[s.platform].short}: ${s.score}`).join(" · "), "");
  for (const phase of report.plan) {
    if (!phase.tasks.length) continue;
    lines.push(`## ${phase.title}`, ``, `_${phase.description}_`, ``);
    for (const t of phase.tasks) {
      const check = report.checks.find((c) => c.id === t.checkId);
      lines.push(`- [ ] **${t.title}** (${t.severity}, effort ${t.effort}, +${t.totalGain.toFixed(1)} pts)`);
      if (check?.finding) lines.push(`  - Found: ${check.finding}`);
      if (t.recommendation) lines.push(`  - Fix: ${t.recommendation}`);
      lines.push(`  - Affects: ${t.platforms.map((p) => PLATFORM_META[p].short).join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function TaskRow({
  task,
  report,
  state,
  onState,
}: {
  task: PlanTask;
  report: Report;
  state: TaskState;
  onState?: (s: TaskState) => void;
}) {
  const [open, setOpen] = useState(false);
  const check = report.checks.find((c) => c.id === task.checkId);
  return (
    <div className={`task ${state === "done" || state === "skipped" ? "is-done" : ""}`}>
      <div style={{ minWidth: 0 }}>
        <button className="btn-ghost" style={{ border: 0, background: "none", padding: 0, cursor: "pointer", textAlign: "left" }} onClick={() => setOpen(!open)}>
          <span className="task-title">{task.title}</span> <span className="muted small">{open ? "▴" : "▾"}</span>
        </button>
        <div className="task-rec">{task.recommendation}</div>
        <div className="task-meta">
          <SeverityBadge severity={task.severity} />
          <span className="badge">effort: {task.effort}</span>
          <span className="badge gain">+{task.totalGain.toFixed(1)} pts</span>
          <PlatformChips platforms={task.platforms} />
        </div>
        {state === "done" && (
          <div className="small" style={{ color: "var(--warn)", marginTop: 6 }}>
            Marked done, but the latest scan still flags it. Rescan after deploying to verify.
          </div>
        )}
        {open && check && (
          <div style={{ marginTop: 10 }} className="grid">
            <div className="small">
              <b>Found:</b> <span className="muted">{check.finding}</span>
            </div>
            <div className="small">
              <b>Why:</b> <span className="muted">{check.why}</span>
            </div>
            {check.snippet && <CodeBlock code={check.snippet} />}
          </div>
        )}
      </div>
      {onState && (
        <select className="select" value={state} onChange={(e) => onState(e.target.value as TaskState)} aria-label={`Status of ${task.title}`}>
          {(Object.keys(STATE_LABEL) as TaskState[]).map((s) => (
            <option key={s} value={s}>
              {STATE_LABEL[s]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function Plan({ report, site, onSiteChange }: { report: Report; site: TrackedSite | null; onSiteChange: (s: TrackedSite) => void }) {
  const all = report.plan.flatMap((p) => p.tasks);
  const stateOf = (id: string): TaskState => site?.tasks[id]?.state ?? "todo";
  const update = (id: string, s: TaskState) => {
    if (!site) return;
    const next = setTaskState(site.key, id, s);
    if (next) onSiteChange(next);
  };

  // Verified: tasks the user tracked that now pass on the latest scan.
  const verified = site
    ? Object.entries(site.tasks)
        .filter(([id, t]) => t.state === "done" && report.checks.find((c) => c.id === id)?.status === "pass")
        .map(([id, t]) => ({ id, at: t.updatedAt, title: report.checks.find((c) => c.id === id)?.title ?? id }))
    : [];
  const handled = all.filter((t) => ["done", "skipped"].includes(stateOf(t.checkId))).length;
  const totalTracked = all.length + verified.length;
  const resolved = handled + verified.length;

  const projected = report.scores.map((s) => {
    const gain = all.filter((t) => stateOf(t.checkId) !== "skipped").reduce((n, t) => n + (t.gains[s.platform as Platform] ?? 0), 0);
    return { ...s, projected: Math.min(100, Math.round(s.score + gain)) };
  });

  if (all.length === 0) {
    return <div className="card empty">Every check passes. Nothing left to plan. Rescan regularly to catch regressions.</div>;
  }

  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row">
          <div>
            <h3 className="section-title">Progress</h3>
            <div className="muted small">
              {resolved} of {totalTracked} resolved{verified.length ? ` · ${verified.length} verified by rescan` : ""}
            </div>
          </div>
          <span className="spacer" />
          <CopyButton text={planMarkdown(report)} label="Copy as Markdown" />
          <button className="btn btn-sm" onClick={() => download("fix-plan.md", planMarkdown(report), "text/markdown")}>
            Download .md
          </button>
        </div>
        <div className="progress-bar" style={{ margin: "12px 0 16px" }}>
          <span style={{ width: `${totalTracked ? (resolved / totalTracked) * 100 : 0}%` }} />
        </div>
        <div className="small muted" style={{ marginBottom: 8 }}>Projected scores once the remaining tasks pass (excluding “won&apos;t fix”):</div>
        <div className="row" style={{ gap: 14 }}>
          {projected.map((p) => (
            <div key={p.platform} className="small">
              <span className="dot" style={{ background: PLATFORM_META[p.platform].color, marginRight: 5 }} />
              {PLATFORM_META[p.platform].short}{" "}
              <b style={{ color: scoreColor(p.score) }}>{p.score}</b> → <b style={{ color: scoreColor(p.projected) }}>{p.projected}</b>
            </div>
          ))}
        </div>
        {!site && <div className="notice" style={{ marginTop: 12 }}>Scan a URL (not pasted HTML) to track task status across scans.</div>}
      </div>

      {report.plan
        .filter((p) => p.tasks.length > 0)
        .map((phase, i) => (
          <section className="phase" key={phase.id}>
            <div className="phase-head">
              <h3 className="section-title">
                {i + 1}. {phase.title}
              </h3>
              <span className="muted small">{phase.tasks.length} tasks</span>
            </div>
            <p className="section-sub" style={{ marginBottom: 8 }}>{phase.description}</p>
            <div className="card">
              {phase.tasks.map((t) => (
                <TaskRow key={t.checkId} task={t} report={report} state={stateOf(t.checkId)} onState={site ? (s) => update(t.checkId, s) : undefined} />
              ))}
            </div>
          </section>
        ))}

      {verified.length > 0 && (
        <section className="phase">
          <h3 className="section-title" style={{ marginBottom: 8 }}>✓ Verified fixed</h3>
          <div className="card">
            {verified.map((v) => (
              <div className="task is-done" key={v.id}>
                <div>
                  <span className="task-title">{v.title}</span>
                  <div className="muted small">Passing on the latest scan · updated {new Date(v.at).toLocaleDateString()}</div>
                </div>
                <span className="badge gain">verified</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
