"use client";

import { useState } from "react";
import { flattenIssues, itemLabel, shortType } from "@/lib/schema-utils";
import type { RichResult, SchemaIssue, SchemaReport, SdItem, SdValue } from "@/lib/types";
import { Kpi } from "./kit";

const STATUS: Record<RichResult["status"], { icon: string; cls: string; label: string }> = {
  eligible: { icon: "✓", cls: "s-pass", label: "Eligible" },
  invalid: { icon: "!", cls: "s-fail", label: "Missing required properties" },
  limited: { icon: "i", cls: "s-info", label: "Limited availability" },
  deprecated: { icon: "–", cls: "s-info", label: "No longer shown by Google" },
};

function Issue({ i }: { i: SchemaIssue }) {
  return (
    <div className={`sd-issue ${i.severity}`} role="note">
      <b>{i.severity === "error" ? "Error" : "Warning"}</b>
      <span>{i.message}</span>
    </div>
  );
}

function Value({ v }: { v: SdValue }) {
  if (v.kind === "item") return <div className="sd-val sd-nested"><Node item={v.item} /></div>;
  if (v.kind === "ref") return <div className="sd-val mono small">→ {v.id}</div>;
  const link = /^https?:\/\//.test(v.value);
  return (
    <div className="sd-val">
      {link ? <a href={v.value} target="_blank" rel="noreferrer noopener" className="small">{v.value}</a> : v.value.length > 400 ? `${v.value.slice(0, 400)}…` : v.value}
    </div>
  );
}

/** Long lists (50 product variants, 100 list items) start collapsed to the first few. */
function Values({ values }: { values: SdValue[] }) {
  const [all, setAll] = useState(false);
  if (!values.length) return <div><span className="na">empty</span></div>;
  const shown = all ? values : values.slice(0, 3);
  return (
    <div>
      {shown.map((v, j) => <Value v={v} key={j} />)}
      {values.length > 3 && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${values.length}`}
        </button>
      )}
    </div>
  );
}

function Node({ item }: { item: SdItem }) {
  return (
    <div className="sd-tree">
      <div className="sd-node-head">
        <b>{itemLabel(item)}</b>
        {item.id && <span className="mono muted small">@id {item.id}</span>}
      </div>
      {item.issues.map((i, k) => <div className="sd-prop" key={`i${k}`} style={{ borderTop: 0 }}><Issue i={i} /></div>)}
      {item.properties.map((p, k) => (
        <div className="sd-prop" key={p.name + k}>
          <div className="sd-name">{shortType(p.name)}</div>
          <Values values={p.values} />
          {p.issues.map((i, j) => <Issue i={i} key={j} />)}
        </div>
      ))}
      {!item.properties.length && <p className="muted small">No properties.</p>}
    </div>
  );
}

function RichResults({ results }: { results: RichResult[] }) {
  return (
    <section className="card card-pad">
      <h3 className="section-title">Google rich results</h3>
      <p className="section-sub">Required and recommended properties per Google&apos;s structured data docs. schema.org validity alone doesn&apos;t make a page eligible.</p>
      {results.length === 0 ? (
        <p className="muted small" style={{ marginBottom: 0 }}>None of the detected types produce a Google rich result.</p>
      ) : (
        <div className="list-rows">
          {results.map((r, i) => {
            const s = STATUS[r.status];
            return (
              <div className="list-row" key={r.feature + i} style={{ alignItems: "flex-start" }}>
                <span className={`status-icon ${s.cls}`} aria-label={s.label}>{s.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <b>{r.feature}</b>
                    <span className="muted small">{r.itemType}</span>
                    <span className="badge">{s.label}</span>
                  </div>
                  {r.missingRequired.length > 0 && <div className="small" style={{ color: "var(--fail)", marginTop: 3 }}>Required: {r.missingRequired.join(", ")}</div>}
                  {r.missingRecommended.length > 0 && <div className="small muted" style={{ marginTop: 3 }}>Recommended: {r.missingRecommended.join(", ")}</div>}
                  {r.note && <div className="small muted" style={{ marginTop: 3 }}>{r.note}</div>}
                </div>
                <a className="small" href={r.docs} target="_blank" rel="noreferrer noopener">Google docs</a>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** validator.schema.org-style result: detected items as trees, issues inline, plus rich results and the visible-content check. */
export default function SchemaView({ report, rawCompare }: { report: SchemaReport; rawCompare?: SchemaReport | null }) {
  const [sel, setSel] = useState(0);
  const issues = flattenIssues(report);
  const eligible = report.richResults.filter((r) => r.status === "eligible").length;
  const item = report.items[Math.min(sel, report.items.length - 1)];
  const formats = report.formats.map(([f, n]) => `${n} ${f}`).join(", ");
  const jsOnly = rawCompare ? report.items.length - rawCompare.items.length : 0;

  return (
    <div className="stack">
      <div className="kpi-row">
        <Kpi label="Detected items" value={report.items.length} foot={formats || "No JSON-LD, Microdata or RDFa"} />
        <Kpi label="Errors" value={report.errors} tone={report.errors ? "var(--fail)" : "var(--pass)"} foot="Ignored by parsers until fixed" />
        <Kpi label="Warnings" value={report.warnings} tone={report.warnings ? "var(--warn)" : undefined} foot="Likely ignored or misread" />
        <Kpi label="Rich results eligible" value={`${eligible}/${report.richResults.length}`} tone={report.richResults.some((r) => r.status === "invalid") ? "var(--fail)" : undefined} foot={`schema.org ${report.vocabVersion}`} />
      </div>

      {jsOnly > 0 && (
        <div className="notice">
          {jsOnly} of these {report.items.length} items exist only after JavaScript runs. Google renders them, but validator.schema.org, social previews and AI crawlers that read raw HTML don&apos;t see them.
        </div>
      )}

      {issues.length > 0 && (
        <section className="card card-pad">
          <h3 className="section-title">Issues ({issues.length})</h3>
          <div className="list-rows" style={{ marginTop: 6 }}>
            {issues.slice(0, 50).map((i, k) => (
              <button
                key={k}
                className="list-row"
                style={{ width: "100%", border: 0, background: "none", textAlign: "left", cursor: i.item >= 0 ? "pointer" : "default", alignItems: "flex-start" }}
                onClick={() => i.item >= 0 && setSel(i.item)}
              >
                <span className={`status-icon ${i.severity === "error" ? "s-fail" : "s-warn"}`} aria-label={i.severity}>!</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>{i.message}</div>
                  <div className="mono muted small break">{i.path}</div>
                </div>
              </button>
            ))}
          </div>
          {issues.length > 50 && <p className="muted small">and {issues.length - 50} more in the item trees below.</p>}
        </section>
      )}

      <RichResults results={report.richResults} />

      {report.items.length > 0 && (
        <section className="card card-pad">
          <h3 className="section-title">Matches the visible page</h3>
          <p className="section-sub">Google requires structured data to describe content people can see. Names, headlines, prices and ratings are checked against the page text.</p>
          {report.notVisible.length === 0 ? (
            <p className="small" style={{ color: "var(--pass)", marginBottom: 0 }}>Every checked value appears on the page.</p>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Item</th><th>Property</th><th>Value not found on the page</th></tr></thead>
                <tbody>
                  {report.notVisible.map((n, i) => (
                    <tr key={i}><td>{n.itemType}</td><td className="mono">{n.property}</td><td className="break">{n.value}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="card card-pad">
        <h3 className="section-title">Detected items</h3>
        {report.items.length === 0 ? (
          <p className="muted small" style={{ marginBottom: 0 }}>
            {report.syntaxErrors.length ? "Nothing could be read: every JSON-LD block has a syntax error." : "No structured data found. Add JSON-LD describing the organization, the website and this page."}
          </p>
        ) : (
          <div className="sd-layout" style={{ marginTop: 10 }}>
            <div className="sd-items" role="group" aria-label="Detected items">
              {report.items.map((it, i) => (
                <button key={i} className="sd-item-btn" aria-pressed={i === sel} onClick={() => setSel(i)}>
                  <span className="sd-type">{itemLabel(it)}</span>
                  <span className="muted small">{it.format}</span>
                  {it.errors > 0 && <span className="sd-count e" aria-label={`${it.errors} errors`}>{it.errors}</span>}
                  {it.warnings > 0 && <span className="sd-count w" aria-label={`${it.warnings} warnings`}>{it.warnings}</span>}
                </button>
              ))}
            </div>
            {item && <Node item={item} />}
          </div>
        )}
      </section>
    </div>
  );
}
