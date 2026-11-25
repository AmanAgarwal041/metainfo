"use client";

import { useMemo, useState } from "react";
import { metricsFor, OPPORTUNITY_KINDS, type Opportunity } from "@/lib/aeo";
import { ACTION_STATUS, actionId, actionImpact, CHANNELS, cleanUrl, estimateLift, inScope, type AeoAction, type ActionStatus, type Channel, type RunAnswers } from "@/lib/aeo-actions";
import { fromOpportunity, type PromptContext } from "@/lib/fix-prompts";
import { AI_ENGINES } from "@/lib/research-types";
import { CollatedPrompt, FixPromptButton, PickBox, useFixPicker, type FixPicker } from "../FixPrompt";
import { Delta, Kpi } from "../kit";
import { DomainCell, EngineDots } from "./tables";

// Actions: the suggestions from the latest run, turned into tracked work (status, owner, notes), each with an
// estimated visibility lift and, once done and re-checked, the measured change on the answers it targets.

const PRIO = { high: "s-fail", medium: "s-warn", low: "s-info" };
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export const toOpportunity = (a: AeoAction): Opportunity => ({
  id: a.id,
  kind: a.kind,
  priority: a.priority,
  title: a.title,
  why: a.why,
  steps: a.steps,
  prompts: a.scope.prompts ?? [],
  targets: a.targets,
});

function scopeLabel(a: AeoAction): string {
  const s = a.scope;
  if (s.domain) return `answers that cite ${s.domain}`;
  if (s.engine) return `${AI_ENGINES.find((e) => e.id === s.engine)?.label ?? s.engine} answers`;
  if (s.prompts?.length === 1) return `“${s.prompts[0]}”`;
  if (s.prompts?.length) return `${s.prompts.length} prompts`;
  return "all answers";
}

function Lift({ value }: { value: number }) {
  return value > 0 ? (
    <span className="badge gain" title="If you get into every answer it targets that leaves you out today, in points of overall visibility">up to +{value} pts</span>
  ) : (
    <span className="badge" title="Improves position, tone or citations rather than whether you're named">quality</span>
  );
}

function ImpactCell({ a, runs, you }: { a: AeoAction; runs: RunAnswers[]; you: string }) {
  if (a.status !== "done") return null;
  const x = actionImpact(a, runs, you);
  if (!x) return <span className="muted small">Measured after the next run</span>;
  return (
    <span className="small" title={`${x.before.visibility}% → ${x.after.visibility}% named, ${x.before.citationRate}% → ${x.after.citationRate}% cited (${scopeLabel(a)})`}>
      visibility <Delta value={x.visibility} suffix=" pts" /> · cited <Delta value={x.citationRate} suffix=" pts" />
    </span>
  );
}

function ActionDetail({ a, ctx, onUpdate }: { a: AeoAction; ctx: PromptContext; onUpdate: (id: string, patch: Partial<AeoAction>) => void }) {
  const fix = useMemo(() => fromOpportunity(toOpportunity(a)), [a]);
  return (
    <>
        <p className="task-rec" style={{ marginTop: 0 }}>{a.why}</p>
        <ol className="insight-steps">
          {a.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
        {a.targets.length > 0 && (
          <ul className="plain-list" style={{ marginTop: 10 }}>
            {a.targets.map((t, i) => (
              <li key={`${i}:${t.url ?? t.label}`}>{t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.label}</a> : <span className="small">{t.label}</span>}</li>
            ))}
          </ul>
        )}
        {a.baseline && (
          <p className="muted small" style={{ marginTop: 10 }}>
            When added ({fmt(a.baseline.at)}): named in {a.baseline.visibility}% and cited in {a.baseline.citationRate}% of {a.baseline.answered} {scopeLabel(a)}
            {a.baseline.avgPosition != null ? `, average position #${a.baseline.avgPosition}` : ""}.
          </p>
        )}
        <div className="action-fields">
          <label className="field">
            <span className="field-label">Owner</span>
            <input className="input" defaultValue={a.owner ?? ""} placeholder="Who's on it" maxLength={60} onBlur={(e) => e.currentTarget.value !== (a.owner ?? "") && onUpdate(a.id, { owner: e.currentTarget.value.trim() || undefined })} />
          </label>
          <label className="field">
            <span className="field-label">Notes</span>
            <input className="input" defaultValue={a.note ?? ""} placeholder="Links, who you contacted, what changed" maxLength={500} onBlur={(e) => e.currentTarget.value !== (a.note ?? "") && onUpdate(a.id, { note: e.currentTarget.value.trim() || undefined })} />
          </label>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <FixPromptButton fix={fix} ctx={ctx} />
        </div>
    </>
  );
}

function ActionRow({ a, runs, you, ctx, picker, onUpdate }: { a: AeoAction; runs: RunAnswers[]; you: string; ctx: PromptContext; picker: FixPicker; onUpdate: (id: string, patch: Partial<AeoAction>) => void }) {
  const setStatus = (status: ActionStatus) => onUpdate(a.id, setStatusPatch(status));
  return (
    <details className="insight action-row">
      <summary>
        <div className="action-head">
          <PickBox id={a.id} title={a.title} picker={picker} />
          <span className={`badge prio ${PRIO[a.priority]}`}>{a.priority}</span>
          <div style={{ minWidth: 0 }}>
            <div className="task-title">{a.title}</div>
            <div className="row small muted" style={{ gap: 6, marginTop: 3, flexWrap: "wrap" }}>
              <span>{CHANNELS[a.channel].label}</span>·<span>{OPPORTUNITY_KINDS[a.kind]}</span>·<span>{scopeLabel(a)}</span>
              {a.owner && <>·<span>{a.owner}</span></>}
              ·<span>{a.status === "done" && a.doneAt ? `done ${fmt(a.doneAt)}` : `added ${fmt(a.at)}`}</span>
            </div>
          </div>
          <div className="action-side" onClick={(e) => e.preventDefault()}>
            <Lift value={a.lift} />
            <select className="select" value={a.status} aria-label={`Status of “${a.title}”`} onChange={(e) => setStatus(e.currentTarget.value as ActionStatus)}>
              {(Object.keys(ACTION_STATUS) as ActionStatus[]).map((s) => (
                <option key={s} value={s}>{ACTION_STATUS[s].label}</option>
              ))}
            </select>
          </div>
        </div>
        {a.status === "done" && (
          <div className="action-impact"><ImpactCell a={a} runs={runs} you={you} /></div>
        )}
      </summary>
      <div className="insight-body" style={{ paddingLeft: 0 }}>
        <ActionDetail a={a} ctx={ctx} onUpdate={onUpdate} />
      </div>
    </details>
  );
}

const setStatusPatch = (status: ActionStatus): Partial<AeoAction> => ({ status, doneAt: status === "done" ? new Date().toISOString() : undefined });

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** The site an action is about: its outreach domain, or the first target's host. */
function actionDomain(a: AeoAction): string {
  return a.scope.domain ?? a.targets.map((t) => (t.url ? hostOf(t.url) : "")).find(Boolean) ?? "";
}

/** What's behind an action in the latest run: the prompts it targets with your numbers, and the sources engines cite. */
function Drivers({ a, latest, you }: { a: AeoAction; latest: RunAnswers | null; you: string }) {
  if (!latest) return <p className="muted small">Run a check to see what drives this.</p>;
  const scoped = latest.answers.filter((x) => inScope(x, a.scope));
  const prompts = [...new Set(scoped.map((x) => x.prompt))];
  const urls = a.targets.filter((t) => t.url).slice(0, 10);
  const cites = (url: string) => {
    const want = cleanUrl(url);
    return latest.answers.filter((x) => x.sources.some((s) => cleanUrl(s.url) === want)).length;
  };
  const byDomain = a.scope.domain ? latest.answers.filter((x) => x.sources.some((s) => s.domain.replace(/^www\./, "").endsWith(a.scope.domain!))).length : 0;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <p className="small" style={{ margin: 0 }}>{a.why}</p>
      <div>
        <h4 className="drawer-h">Prompts driving it</h4>
        {prompts.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th style={{ textAlign: "right" }}>Your visibility</th>
                  <th style={{ textAlign: "right" }}>Cited</th>
                  <th>Engines</th>
                </tr>
              </thead>
              <tbody>
                {prompts.slice(0, 12).map((p) => {
                  const xs = scoped.filter((x) => x.prompt === p);
                  const m = metricsFor(xs, you);
                  return (
                    <tr key={p}>
                      <td className="small">{p}</td>
                      <td className="mono small" style={{ textAlign: "right" }}>{m.visibility}%</td>
                      <td className="mono small" style={{ textAlign: "right" }}>{m.citationRate}%</td>
                      <td><EngineDots engines={[...new Set(xs.map((x) => x.engine))]} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">No answer in the latest run falls in its scope.</p>
        )}
      </div>
      {(urls.length > 0 || a.scope.domain) && (
        <div>
          <h4 className="drawer-h">Citation sources</h4>
          {a.scope.domain && <p className="small" style={{ marginTop: 0 }}><b>{a.scope.domain}</b> is cited in {byDomain} answers in the latest run.</p>}
          {urls.length > 0 && (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th style={{ textAlign: "right" }}>Times cited</th>
                  </tr>
                </thead>
                <tbody>
                  {urls.map((t) => (
                    <tr key={t.url}>
                      <td><DomainCell domain={hostOf(t.url!)} url={t.url} sub={t.label} /></td>
                      <td className="mono small" style={{ textAlign: "right" }}>{cites(t.url!)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div>
        <h4 className="drawer-h">Why this matters</h4>
        <p className="small muted" style={{ margin: 0 }}>
          {a.lift > 0
            ? `Answers in its scope leave you out today. Getting into all of them would add up to ${a.lift} points of overall visibility.`
            : "It improves how you're named (position, tone or citations) rather than whether you're named."}
        </p>
      </div>
    </div>
  );
}

function ActionDrawer({ a, latest, runs, you, ctx, onUpdate, onClose, onStep }: { a: AeoAction; latest: RunAnswers | null; runs: RunAnswers[]; you: string; ctx: PromptContext; onUpdate: (id: string, patch: Partial<AeoAction>) => void; onClose: () => void; onStep: (d: -1 | 1) => void }) {
  const [tab, setTab] = useState<"rec" | "drivers" | "impact">("rec");
  const x = actionImpact(a, runs, you);
  return (
    <aside className="drawer" role="dialog" aria-label={a.title}>
      <div className="drawer-top">
        <select className="select" value={a.status} aria-label="Status" onChange={(e) => onUpdate(a.id, setStatusPatch(e.currentTarget.value as ActionStatus))}>
          {(Object.keys(ACTION_STATUS) as ActionStatus[]).map((st) => <option key={st} value={st}>{ACTION_STATUS[st].label}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" aria-label="Previous action" onClick={() => onStep(-1)}>‹</button>
        <button className="btn btn-sm btn-ghost" aria-label="Next action" onClick={() => onStep(1)}>›</button>
        <button className="btn btn-sm btn-ghost" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <h3 className="drawer-title">{a.title}</h3>
      <div className="row small muted" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <span className={`badge prio ${PRIO[a.priority]}`}>{a.priority}</span>
        <span>{CHANNELS[a.channel].label}</span>·<span>{OPPORTUNITY_KINDS[a.kind]}</span>·<Lift value={a.lift} />
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        {(
          [
            ["rec", "Recommendation"],
            ["drivers", "What's driving it"],
            ["impact", "Impact"],
          ] as const
        ).map(([id, l]) => (
          <button key={id} className="tab" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{l}</button>
        ))}
      </div>
      {tab === "rec" && <ActionDetail key={a.id} a={a} ctx={ctx} onUpdate={onUpdate} />}
      {tab === "drivers" && <Drivers a={a} latest={latest} you={you} />}
      {tab === "impact" &&
        (a.status !== "done" ? (
          <p className="muted small">Mark it done when it ships; the next run measures named, cited and position on the {scopeLabel(a)} it targets.</p>
        ) : x ? (
          <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <Kpi label="Named" value={`${x.after.visibility}%`} foot={<>from {x.before.visibility}% <Delta value={x.visibility} suffix=" pts" /></>} />
            <Kpi label="Cited" value={`${x.after.citationRate}%`} foot={<>from {x.before.citationRate}% <Delta value={x.citationRate} suffix=" pts" /></>} />
            <Kpi label="Position" value={x.after.avgPosition == null ? "–" : `#${x.after.avgPosition}`} foot={x.position == null ? `${x.runsAfter} runs since` : <Delta value={x.position} />} />
          </div>
        ) : (
          <p className="muted small">Done {a.doneAt ? fmt(a.doneAt) : ""}. Measured after the next run.</p>
        ))}
    </aside>
  );
}

function ActionTable({ rows, onOpen, onUpdate, openId }: { rows: AeoAction[]; onOpen: (id: string) => void; onUpdate: (id: string, patch: Partial<AeoAction>) => void; openId: string | null }) {
  return (
    <div className="table-wrap">
      <table className={`t action-table${openId ? " compact" : ""}`}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Channel</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Domain</th>
            <th style={{ textAlign: "right" }} title="Most overall visibility you could gain">Est. lift</th>
            <th>Owner</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className={openId === a.id ? "is-open" : ""}>
              <td style={{ maxWidth: 340 }}>
                <button className="link-btn task-title" style={{ textAlign: "left" }} onClick={() => onOpen(a.id)}>{a.title}</button>
              </td>
              <td><span className="badge kind-badge" data-kind={a.kind}>{OPPORTUNITY_KINDS[a.kind]}</span></td>
              <td className="small">{CHANNELS[a.channel].label}</td>
              <td><span className={`badge prio ${PRIO[a.priority]}`}>{a.priority}</span></td>
              <td>
                <select className="select" value={a.status} aria-label={`Status of “${a.title}”`} onChange={(e) => onUpdate(a.id, setStatusPatch(e.currentTarget.value as ActionStatus))}>
                  {(Object.keys(ACTION_STATUS) as ActionStatus[]).map((st) => <option key={st} value={st}>{ACTION_STATUS[st].label}</option>)}
                </select>
              </td>
              <td className="small ellipsis" style={{ maxWidth: 140 }}>{actionDomain(a) || <span className="muted">N/A</span>}</td>
              <td className="mono small" style={{ textAlign: "right" }}>{a.lift > 0 ? `+${a.lift}%` : <span className="muted">quality</span>}</td>
              <td className="small">{a.owner || <span className="muted">Unassigned</span>}</td>
              <td className="small muted" style={{ whiteSpace: "nowrap" }}>{fmt(a.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Category = "all" | Channel | "done" | "dismissed";

export default function Actions({
  actions,
  suggestions,
  latest,
  runs,
  you,
  ctx,
  onTrack,
  onUpdate,
}: {
  actions: AeoAction[];
  /** Opportunities from the latest run. */
  suggestions: Opportunity[];
  latest: RunAnswers | null;
  runs: RunAnswers[];
  you: string;
  ctx: PromptContext;
  onTrack: (os: Opportunity[], status?: ActionStatus) => void;
  onUpdate: (id: string, patch: Partial<AeoAction>) => void;
}) {
  const [cat, setCat] = useState<Category>("all");
  const [layout, setLayout] = useState<"table" | "list">("table");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const tracked = useMemo(() => new Set(actions.map((a) => a.id)), [actions]);
  const fresh = useMemo(
    () =>
      latest
        ? suggestions
            .filter((o) => !tracked.has(actionId(o)))
            .map((o) => ({ o, lift: estimateLift(o, latest.answers, you) }))
        : [],
    [suggestions, tracked, latest, you],
  );
  const isOpen = (a: AeoAction) => a.status === "todo" || a.status === "doing";
  const open = actions.filter(isOpen);
  const done = actions.filter((a) => a.status === "done");
  const archived = actions.filter((a) => a.status === "dismissed");
  const measured = done.map((a) => actionImpact(a, runs, you)).filter((x) => x != null);
  const gains = measured.filter((x) => x.visibility > 0 || x.citationRate > 0).length;
  const needle = q.trim().toLowerCase();
  const inCat = (a: AeoAction) => (cat === "all" ? isOpen(a) : cat === "done" || cat === "dismissed" ? a.status === cat : isOpen(a) && a.channel === cat);
  const shown = actions
    .filter(inCat)
    .filter((a) => !needle || `${a.title} ${a.why} ${actionDomain(a)} ${a.owner ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1) || { high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority] || b.lift - a.lift);
  const picker = useFixPicker();
  const fixes = shown.map((a) => fromOpportunity(toOpportunity(a)));
  const channels = (Object.keys(CHANNELS) as Channel[]).filter((c) => open.some((a) => a.channel === c));
  const current = openId ? actions.find((a) => a.id === openId) ?? null : null;
  const step = (d: -1 | 1) => {
    const i = shown.findIndex((a) => a.id === openId);
    const next = shown[(i + d + shown.length) % shown.length];
    if (next) setOpenId(next.id);
  };
  const cats: [Category, string, number][] = [
    ["all", "All open", open.length],
    ...channels.map((c) => [c, CHANNELS[c].label, open.filter((a) => a.channel === c).length] as [Category, string, number]),
    ["done", "Done", done.length],
    ["dismissed", "Archived", archived.length],
  ];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="kpi-row">
        <Kpi label="Open" value={open.length} foot={`${open.filter((a) => a.status === "doing").length} in progress`} />
        <Kpi label="Done" value={done.length} foot={`${measured.length} measured since`} />
        <Kpi label="Moved the needle" value={measured.length ? `${gains}/${measured.length}` : "–"} foot="done actions with more mentions or citations after" />
        <Kpi label="New suggestions" value={fresh.length} foot="from the latest run, not tracked yet" />
      </div>

      {fresh.length > 0 && (
        <section className="card card-pad">
          <div className="panel-head">
            <div>
              <h2 className="section-title">Suggested from the latest run</h2>
              <p className="section-sub" style={{ marginBottom: 0 }}>Track the ones you&apos;ll work on. Lift is the most overall visibility you could gain: the answers it targets that leave you out today.</p>
            </div>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => onTrack(fresh.filter((x) => x.o.priority === "high").map((x) => x.o))} disabled={!fresh.some((x) => x.o.priority === "high")}>
              Track all high priority
            </button>
            <button className="btn btn-sm" onClick={() => onTrack(fresh.map((x) => x.o))}>Track all {fresh.length}</button>
          </div>
          <div className="list-rows" style={{ marginTop: 10 }}>
            {fresh.map(({ o, lift }) => (
              <div className="list-row suggestion-row" key={o.id + o.prompts.join("|")}>
                <span className={`badge prio ${PRIO[o.priority]}`} style={{ alignSelf: "flex-start" }}>{o.priority}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="task-title">{o.title}</div>
                  <div className="task-rec">{o.why}</div>
                </div>
                <span className="badge kind-badge" data-kind={o.kind}>{OPPORTUNITY_KINDS[o.kind]}</span>
                <Lift value={lift} />
                <button className="btn btn-sm btn-primary" onClick={() => onTrack([o])}>Track</button>
                <button className="btn btn-sm" title="Hide this suggestion; it stays under Archived" onClick={() => onTrack([o], "dismissed")}>Dismiss</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className={current ? "with-drawer" : ""}>
        <section className="card card-pad">
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <div className="pill-tabs" role="tablist" aria-label="Category">
              {cats.map(([id, l, n]) => (
                <button key={id} role="tab" aria-selected={cat === id} onClick={() => setCat(id)}>
                  {l} <span className="pill-count">{n}</span>
                </button>
              ))}
            </div>
            <span className="spacer" />
            <div className="segmented" role="group" aria-label="Layout">
              <button aria-pressed={layout === "table"} onClick={() => setLayout("table")}>Table</button>
              <button aria-pressed={layout === "list"} onClick={() => setLayout("list")}>List</button>
            </div>
          </div>
          <input className="input search-input" type="search" placeholder="Search actions" aria-label="Search actions" value={q} onChange={(e) => setQ(e.currentTarget.value)} style={{ marginTop: 12 }} />
          <div style={{ marginTop: 4 }}>
            {cat !== "done" && cat !== "dismissed" && layout === "list" && <CollatedPrompt fixes={fixes} ctx={ctx} picker={picker} />}
            {!shown.length ? (
              <p className="muted small">
                {needle
                  ? "No action matches."
                  : cat === "done"
                    ? "No done actions yet."
                    : cat === "dismissed"
                      ? "Nothing archived."
                      : actions.length
                        ? "Nothing open. Track a suggestion above, or from a prompt's plan in By prompt."
                        : "No tracked actions yet. Track a suggestion above, or from a prompt's plan in By prompt. When you mark one done, the next run measures whether it moved visibility on the answers it targets."}
              </p>
            ) : layout === "table" ? (
              <ActionTable rows={shown} onOpen={setOpenId} onUpdate={onUpdate} openId={openId} />
            ) : (
              shown.map((a) => <ActionRow key={a.id} a={a} runs={runs} you={you} ctx={ctx} picker={picker} onUpdate={onUpdate} />)
            )}
          </div>
        </section>
        {current && <ActionDrawer key={current.id} a={current} latest={latest} runs={runs} you={you} ctx={ctx} onUpdate={onUpdate} onClose={() => setOpenId(null)} onStep={step} />}
      </div>
    </div>
  );
}
