"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fromInsight, type PromptContext } from "@/lib/fix-prompts";
import type { TrafficStats } from "@/lib/traffic";
import { AREA_LABEL, openCount, trafficInsights, type Insight, type InsightArea, type InsightLevel } from "@/lib/traffic-insights";
import { CollatedPrompt, FixPromptButton, PickBox, useFixPicker, type FixPicker } from "./FixPrompt";

// "What to improve": the traffic read as a to-do list, for AI visibility, people, and errors.

const AREAS: InsightArea[] = ["ai", "people", "errors"];
const RANK: Record<InsightLevel, number> = { high: 0, medium: 1, low: 2, good: 3 };
const LEVEL: Record<InsightLevel, { label: string; cls: string }> = {
  high: { label: "Fix first", cls: "s-fail" },
  medium: { label: "Worth doing", cls: "s-warn" },
  low: { label: "Idea", cls: "s-info" },
  good: { label: "Good", cls: "s-pass" },
};

export default function TrafficInsights({ stats, domain, statusKnown }: { stats: TrafficStats; domain: string; statusKnown: boolean }) {
  const insights = useMemo(() => trafficInsights(stats, domain, statusKnown), [stats, domain, statusKnown]);
  // Open on the area with the most urgent item.
  const [area, setArea] = useState<InsightArea>(() => insights.find((i) => i.level !== "good")?.area ?? "ai");
  const shown = insights.filter((i) => i.area === area);
  const picker = useFixPicker();
  const ctx = useMemo<PromptContext>(() => ({ site: domain ? `https://${domain}` : "the site", source: `traffic report (last ${stats.days} days)` }), [domain, stats.days]);
  const fixes = useMemo(
    () =>
      insights
        .filter((i) => i.level !== "good" && i.steps.length)
        .sort((a, b) => RANK[a.level] - RANK[b.level])
        .map(fromInsight),
    [insights],
  );

  return (
    <div className="card card-pad">
      <h3 className="section-title">What to improve</h3>
      <p className="section-sub">Read from the last {stats.days} days of traffic. Each item says what the numbers show and what to change.</p>
      <CollatedPrompt fixes={fixes} ctx={ctx} picker={picker} />
      <div className="tabs" role="tablist" style={{ marginBottom: 8 }}>
        {AREAS.map((a) => {
          const c = openCount(insights, a);
          return (
            <button key={a} className="tab" role="tab" aria-selected={area === a} onClick={() => setArea(a)}>
              {AREA_LABEL[a]}
              <span className="count">{c || "✓"}</span>
            </button>
          );
        })}
      </div>
      <div>
        {shown.map((i, k) => (
          <InsightRow key={i.id} insight={i} open={k === 0 && i.level !== "good"} ctx={ctx} picker={picker} />
        ))}
      </div>
    </div>
  );
}

function InsightRow({ insight: i, open, ctx, picker }: { insight: Insight; open: boolean; ctx: PromptContext; picker: FixPicker }) {
  const lv = LEVEL[i.level];
  const more = i.steps.length > 0 || !!i.paths?.length;
  const fixable = i.level !== "good" && i.steps.length > 0;
  const head = (
    <div className={`insight-head${fixable ? " has-pick" : ""}`}>
      {fixable && <PickBox id={i.id} title={i.title} picker={picker} />}
      <span className={`badge ${lv.cls}`}>{lv.label}</span>
      <div>
        <div className="task-title">{i.title}</div>
        <div className="task-rec">{i.why}</div>
      </div>
    </div>
  );
  if (!more) return <div className="insight">{head}</div>;
  return (
    <details className="insight" open={open}>
      <summary>{head}</summary>
      <div className="insight-body">
        {i.steps.length > 0 && (
          <ol className="insight-steps">
            {i.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
        {i.paths && i.paths.length > 0 && (
          <div className="list-rows" style={{ marginTop: 10 }}>
            {i.paths.map((x) => (
              <div className="list-row" key={x.path}>
                <span className={x.path.startsWith("/") ? "mono small" : "small"} style={{ wordBreak: "break-all" }}>{x.path}</span>
                <span className="spacer" />
                <span className="muted small" style={{ textAlign: "right" }}>{x.note}</span>
              </div>
            ))}
          </div>
        )}
        {i.action &&
          (i.action.external ? (
            <a className="btn btn-sm" href={i.action.href} target="_blank" rel="noreferrer" style={{ marginTop: 12 }}>
              {i.action.label} ↗
            </a>
          ) : (
            <Link className="btn btn-sm" href={i.action.href} style={{ marginTop: 12 }}>
              {i.action.label} →
            </Link>
          ))}
        {fixable && <FixPromptButton fix={fromInsight(i)} ctx={ctx} />}
      </div>
    </details>
  );
}
