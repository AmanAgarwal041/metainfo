"use client";

import type { ReactNode } from "react";
import { nameOf, PROMPT_TYPES, STAGES, type Brand, type BrandResult, type PromptType, type Sentiment } from "@/lib/aeo";
import type { Observation } from "@/lib/ai-visibility";
import type { Project } from "@/lib/project";

/** You first, then competitors: the order every BrandResult[] follows. */
export function brandsOf(project: Project, brand: string): Brand[] {
  return [
    { domain: project.domain, name: brand || nameOf(project.domain), aliases: project.aliases },
    ...project.competitors.map((c) => ({ domain: c, name: nameOf(c) })),
  ];
}

/** Older runs only stored mentioned/cited: fill in the rest as unknown. */
export function brandResults(o: Observation, brands: Brand[]): BrandResult[] {
  if (o.brands?.length) return o.brands;
  return brands.map((b, i) => {
    const m = i === 0 ? o.you : o.competitors[b.domain];
    return { domain: b.domain, mentioned: !!m?.mentioned, cited: !!m?.cited, position: null, sentiment: null, quote: "", judgedBy: "code" };
  });
}

export function TypeBadge({ type }: { type: PromptType }) {
  const t = PROMPT_TYPES[type];
  return (
    <span className="badge" title={`${STAGES[t.stage]}: ${t.hint}`}>
      {t.label}
    </span>
  );
}

const SENT: Record<Sentiment, { label: string; cls: string }> = {
  positive: { label: "positive", cls: "gain" },
  neutral: { label: "neutral", cls: "" },
  mixed: { label: "mixed", cls: "sev-high" },
  negative: { label: "negative", cls: "sev-critical" },
};

export function SentimentBadge({ s }: { s: Sentiment | null }) {
  if (!s) return null;
  return <span className={`badge ${SENT[s].cls}`}>{SENT[s].label}</span>;
}

export function Meter({ value, color = "var(--accent)" }: { value: number; color?: string }) {
  return (
    <div className="bar" style={{ minWidth: 60 }}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

export function Section({ title, sub, children, actions }: { title: string; sub?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card card-pad">
      <div className="panel-head">
        <div>
          <h2 className="section-title">{title}</h2>
          {sub && <p className="section-sub" style={{ marginBottom: 0 }}>{sub}</p>}
        </div>
        {actions && (
          <>
            <span className="spacer" />
            {actions}
          </>
        )}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}
