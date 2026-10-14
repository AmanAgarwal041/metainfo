"use client";

import type { GeoReport, Passage, Report } from "@/lib/types";
import { Kpi } from "./kit";
import { scoreColor } from "./ui";

const PARTS: { key: keyof Omit<GeoReport["score"], "total">; label: string; max: number; help: string }[] = [
  { key: "citability", label: "Citability", max: 25, help: "How quotable the best sections are" },
  { key: "structure", label: "Structure", max: 20, help: "Questions answered, definition up front, lists, no walls of text" },
  { key: "multimodal", label: "Multi-modal", max: 15, help: "Images with alt text, tables, video or figures" },
  { key: "authority", label: "Authority", max: 20, help: "Author, trust pages, sameAs profiles, sourced claims" },
  { key: "technical", label: "Technical access", max: 20, help: "AI crawlers allowed, content in the HTML, indexable" },
];

const FRESH: Record<GeoReport["freshness"]["tier"], { label: string; tone: string }> = {
  excellent: { label: "Under 3 months", tone: "var(--pass)" },
  good: { label: "Under 6 months", tone: "var(--pass)" },
  acceptable: { label: "Under a year", tone: "var(--warn)" },
  warning: { label: "1-2 years old", tone: "var(--warn)" },
  stale: { label: "Over 2 years old", tone: "var(--fail)" },
  unknown: { label: "No date found", tone: "var(--fail)" },
};

/** Plain-language reasons a passage scores low, from its sub-scores. */
function weaknesses(p: Passage): string[] {
  const out: string[] = [];
  if (p.answer < 15) out.push("no direct answer or definition up front");
  if (p.contextDependent) out.push("opens by leaning on the previous section");
  if (p.words < 80) out.push(`short (${p.words} words; 130-170 is ideal)`);
  else if (p.words > 250) out.push(`long (${p.words} words; split it)`);
  if (p.stats === 0) out.push("no numbers, dates or named sources");
  if (p.readability < 8) out.push("long or uneven sentences");
  return out;
}

function PassageRow({ p, weak }: { p: Passage; weak?: boolean }) {
  const why = weak ? weaknesses(p) : [];
  return (
    <div className="list-row" style={{ alignItems: "flex-start" }}>
      <b style={{ color: scoreColor(p.score), minWidth: 34, textAlign: "right" }}>{p.score}</b>
      <div style={{ flex: 1, minWidth: 0 }}>
        {p.heading && <div style={{ fontWeight: 600 }}>{p.heading}</div>}
        <div className="small muted">{p.excerpt}</div>
        <div className="row small" style={{ gap: 6, marginTop: 4, flexWrap: "wrap" }}>
          <span className="badge" title="Answer quality, out of 30">answer {p.answer}/30</span>
          <span className="badge" title="Self-containment, out of 25">self-contained {p.selfContained}/25</span>
          <span className="badge" title="Readability, out of 20">readable {p.readability}/20</span>
          <span className="badge" title="Statistics and sources, out of 15">stats {p.stats}/15</span>
          <span className="badge" title="Original research and examples, out of 10">original {p.originality}/10</span>
          <span className="muted">{p.words} words, {p.position}% down the page</span>
        </div>
        {why.length > 0 && <div className="small" style={{ color: "var(--warn)", marginTop: 4 }}>Why it&apos;s weak: {why.join("; ")}.</div>}
      </div>
    </div>
  );
}

function Tick({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li>
      <span className={`status-icon ${ok ? "s-pass" : "s-warn"}`} aria-label={ok ? "yes" : "no"}>{ok ? "✓" : "!"}</span>
      {children}
    </li>
  );
}

/** How ready the page is to be quoted by AI answer engines (GEO). */
export default function Geo({ report }: { report: Report }) {
  const g = report.geo;
  if (!g) return <div className="card card-pad muted small">This report was saved before AI-citation analysis existed. Rescan the page.</div>;
  const ci = g.citability;
  const fr = FRESH[g.freshness.tier];
  return (
    <div className="stack">
      <div className="kpi-row">
        <Kpi label="GEO score" value={g.score.total} tone={scoreColor(g.score.total)} foot="AI-citation readiness, out of 100" />
        <Kpi label="Passage citability" value={ci.passages ? `${ci.grade} · ${ci.score}` : "n/a"} tone={ci.passages ? scoreColor(ci.score) : undefined} foot={`${ci.coverage}% of ${ci.passages} sections above 70`} />
        <Kpi label="Questions answered" value={g.answers.questionHeadings ? `${g.answers.answered}/${g.answers.questionHeadings}` : "none"} foot={g.answers.earlyDefinition ? "Opens with a definition" : "No definition up front"} />
        <Kpi label="Last updated" value={g.freshness.ageDays != null ? (g.freshness.ageDays < 60 ? `${g.freshness.ageDays} d` : `${Math.round(g.freshness.ageDays / 30)} mo`) : "unknown"} tone={fr.tone} foot={fr.label} />
      </div>

      <section className="card card-pad">
        <h3 className="section-title">What makes up the score</h3>
        <p className="section-sub">Weights from claude-seo&apos;s GEO framework; the rules are deterministic ports of the open-source SEO skills (geo-seo-claude&apos;s citability rubric, claude-seo&apos;s content checks).</p>
        {PARTS.map((p) => {
          const v = g.score[p.key];
          const pct = Math.round((v / p.max) * 100);
          return (
            <div className="cat-row" key={p.key} style={{ gridTemplateColumns: "150px 1fr 56px" }} title={p.help}>
              <span>{p.label}</span>
              <div className="bar" role="img" aria-label={`${p.label}: ${v} of ${p.max}`}>
                <span style={{ width: `${pct}%`, background: scoreColor(pct) }} />
              </div>
              <span className="small" style={{ textAlign: "right" }}><b>{v}</b>/{p.max}</span>
            </div>
          );
        })}
      </section>

      {ci.passages > 0 && (
        <div className="two-col">
          <section className="card card-pad">
            <h3 className="section-title">Most quotable sections</h3>
            <p className="section-sub">What an answer engine is most likely to lift.{ci.bestPosition != null && ci.bestPosition > 33 ? ` The best one sits ${ci.bestPosition}% down the page; AI answers lean on the first third.` : ""}</p>
            <div className="list-rows">{ci.top.map((p, i) => <PassageRow p={p} key={i} />)}</div>
          </section>
          <section className="card card-pad">
            <h3 className="section-title">Rewrite these first</h3>
            <p className="section-sub">Open with the answer, name the subject, add a number or a source, aim for 130-170 words.</p>
            {ci.bottom.length ? (
              <div className="list-rows">{ci.bottom.map((p, i) => <PassageRow p={p} weak key={i} />)}</div>
            ) : (
              <p className="small" style={{ color: "var(--pass)" }}>Every section scores 60 or more.</p>
            )}
          </section>
        </div>
      )}

      <div className="two-col">
        <section className="card card-pad">
          <h3 className="section-title">Claims and sources</h3>
          <p className="section-sub">
            {g.evidence.claims ? `${g.evidence.cited} of ${g.evidence.claims} factual claims have a link or attribution in the same paragraph.` : "No factual claims or statistics detected."} {g.evidence.statsPer500} numbers per 500 words.
          </p>
          {g.evidence.uncitedExamples.length > 0 && (
            <>
              <div className="field-label">Unsourced claims</div>
              <ul className="plain-list">{g.evidence.uncitedExamples.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
          {g.answers.unanswered.length > 0 && (
            <>
              <div className="field-label" style={{ marginTop: 12 }}>Questions without a direct answer below them</div>
              <ul className="plain-list">{g.answers.unanswered.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
        </section>
        <section className="card card-pad">
          <h3 className="section-title">Phrasing</h3>
          <p className="section-sub">{g.phrasing.aiPer1k} stock AI phrases and {g.phrasing.fillerPer1k} filler phrases per 1,000 words.</p>
          {g.phrasing.aiPatterns.length + g.phrasing.filler.length > 0 ? (
            <div className="chips">
              {[...g.phrasing.aiPatterns, ...g.phrasing.filler].map(([p, n]) => (
                <span className="badge" key={p}>&ldquo;{p}&rdquo;{n > 1 ? ` ×${n}` : ""}</span>
              ))}
            </div>
          ) : (
            <p className="small" style={{ color: "var(--pass)" }}>No filler or stock AI phrases.</p>
          )}
          {(g.freshness.vagueTime.length > 0 || g.freshness.titleYear) && (
            <p className="small" style={{ marginTop: 12 }}>
              {g.freshness.titleYear ? <>The title says {g.freshness.titleYear}. </> : null}
              {g.freshness.vagueTime.length > 0 && <>Time-relative words that age badly: {g.freshness.vagueTime.map((w) => `“${w}”`).join(", ")}.</>}
            </p>
          )}
        </section>
      </div>

      <div className="two-col">
        <section className="card card-pad">
          <h3 className="section-title">Trust signals</h3>
          <ul className="checklist">
            <Tick ok={!!report.page.author}>Named author{report.page.author ? `: ${report.page.author}` : ""}</Tick>
            <Tick ok={g.trust.authorProfile}>Author described in schema (jobTitle, worksFor, sameAs)</Tick>
            <Tick ok={g.trust.about}>About page linked</Tick>
            <Tick ok={g.trust.contact}>Contact page or email linked</Tick>
            <Tick ok={g.trust.privacy && g.trust.terms}>Privacy policy and terms linked</Tick>
            <Tick ok={g.trust.editorial}>Editorial, corrections or methodology page</Tick>
          </ul>
        </section>
        <section className="card card-pad">
          <h3 className="section-title">Entity graph</h3>
          <ul className="checklist">
            <Tick ok={g.entity.sameAs.length >= 3}>{g.entity.sameAs.length} sameAs profile links (3+ recommended)</Tick>
            <Tick ok={g.entity.idReferences > 0}>{g.entity.idReferences} @id references connecting items</Tick>
            <Tick ok={g.entity.knowsAbout > 0}>{g.entity.knowsAbout} knowsAbout topics</Tick>
            <Tick ok={g.entity.searchAction}>WebSite with SearchAction</Tick>
            <Tick ok={g.entity.speakable}>speakable (voice assistants)</Tick>
          </ul>
          {g.entity.sameAs.length > 0 && <p className="small muted break" style={{ marginTop: 8 }}>{g.entity.sameAs.join(" · ")}</p>}
        </section>
      </div>
    </div>
  );
}
