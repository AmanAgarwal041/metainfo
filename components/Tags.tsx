"use client";

import type { Report } from "@/lib/types";
import { CodeBlock } from "./ui";

const ENGINE_COLS = [
  { id: "google", label: "Google" },
  { id: "bing", label: "Bing" },
  { id: "social", label: "Social" },
  { id: "x", label: "X" },
  { id: "ai", label: "AI" },
];

export default function Tags({ report }: { report: Report }) {
  const p = report.page;
  const minLevel = Math.min(...p.headings.map((h) => h.level), 6);
  return (
    <div className="stack">
      <div className="card card-pad">
        <h3 className="section-title">Essentials</h3>
        <div className="table-wrap">
          <table className="t">
            <tbody>
              {[
                ["Title", p.title, p.title ? `${[...p.title].length} chars` : "missing"],
                ["Description", p.description, p.description ? `${[...p.description].length} chars` : "missing"],
                ["Canonical", p.canonicals.join(", ") || null, ""],
                ["Robots", p.metaRobots, ""],
                ["Language", p.lang, ""],
                ["Viewport", p.viewport, ""],
                ["Charset", p.charset, ""],
                ["Author", p.author, ""],
                ["Published", p.published, ""],
                ["Modified", p.modified, ""],
                ["Generator", p.generator, ""],
              ].map(([k, v, note]) => (
                <tr key={k as string}>
                  <td style={{ width: 120, fontWeight: 600 }}>{k}</td>
                  <td className="break">{v || <span className="na">not set</span>}</td>
                  <td className="muted small" style={{ whiteSpace: "nowrap" }}>{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="section-title">All meta tags ({p.meta.length})</h3>
        <p className="section-sub">In document order, with the consumers known to read each tag.</p>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Content</th>
                {ENGINE_COLS.map((e) => (
                  <th key={e.id} className="c">
                    {e.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.meta.map((m, i) => (
                <tr key={i}>
                  <td className="mono small" style={{ whiteSpace: "nowrap" }}>
                    <span className="muted">{m.attr}=</span>
                    {m.key}
                  </td>
                  <td className="break small">{m.content}</td>
                  {ENGINE_COLS.map((e) => (
                    <td key={e.id} className="c">
                      {m.engines.includes(e.id) ? <span className="yes">✓</span> : <span className="na">·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="two-col">
        <div className="card card-pad">
          <h3 className="section-title">Heading outline ({p.headings.length})</h3>
          <div style={{ marginTop: 8, maxHeight: 420, overflow: "auto" }}>
            {p.headings.length === 0 && <p className="muted">No headings.</p>}
            {p.headings.map((h, i) => (
              <div key={i} className="outline-item" style={{ paddingLeft: (h.level - minLevel) * 16 }}>
                <span className="lvl">H{h.level}</span>
                <span className="break">{h.text || <i className="muted">(empty)</i>}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card card-pad">
          <h3 className="section-title">Content stats</h3>
          <table className="t" style={{ marginTop: 8 }}>
            <tbody>
              {[
                ["Words (raw HTML)", p.wordCount.toLocaleString()],
                ["Paragraphs / lists / tables", `${p.paragraphs} / ${p.lists} / ${p.tables}`],
                ["Question headings", p.questionHeadings],
                ["Text-to-HTML ratio", `${(p.textRatio * 100).toFixed(1)}%`],
                ["Links (internal / external)", `${p.linkStats.internal} / ${p.linkStats.external}`],
                ["Nofollow / empty / generic anchors", `${p.linkStats.nofollow} / ${p.linkStats.emptyAnchor} / ${p.linkStats.genericAnchor}`],
                ["Images (no alt / no size / lazy)", `${p.imageCount} (${p.imagesMissingAlt} / ${p.imagesMissingSize} / ${p.imagesLazy})`],
                ["Scripts (external / inline / blocking)", `${p.scripts.total} (${p.scripts.external} / ${p.scripts.inline} / ${p.scripts.headBlocking})`],
                ["Stylesheets", p.stylesheets],
                ["Client-rendered app shell", p.spaShell ? "Yes ⚠" : "No"],
              ].map(([k, v]) => (
                <tr key={k as string}>
                  <td className="muted">{k}</td>
                  <td style={{ fontWeight: 600 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="section-title">Structured data</h3>
        <p className="section-sub">
          {p.jsonLd.length} JSON-LD block(s)
          {p.microdataTypes.length > 0 && <> · microdata: {p.microdataTypes.join(", ")}</>}
        </p>
        {p.jsonLd.map((b, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div className="row" style={{ marginBottom: 6, gap: 6 }}>
              <b className="small">Block {i + 1}</b>
              {b.valid ? <span className="badge gain">valid JSON</span> : <span className="badge sev-critical">invalid: {b.error}</span>}
              {b.types.map((t) => (
                <span key={t} className="badge accent">
                  {t}
                </span>
              ))}
            </div>
            <CodeBlock code={b.valid ? JSON.stringify(JSON.parse(b.raw), null, 2) : b.raw} />
          </div>
        ))}
      </div>

      {p.images.length > 0 && (
        <div className="card card-pad">
          <h3 className="section-title">Images ({p.imageCount})</h3>
          <div className="table-wrap" style={{ maxHeight: 380, overflow: "auto" }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Alt</th>
                  <th>Size</th>
                  <th>Loading</th>
                </tr>
              </thead>
              <tbody>
                {p.images.slice(0, 80).map((img, i) => (
                  <tr key={i}>
                    <td className="break small" style={{ maxWidth: 380 }}>{img.src}</td>
                    <td className="small">{img.alt == null ? <span className="no">missing</span> : img.alt || <span className="muted">(decorative)</span>}</td>
                    <td className="small">{img.width && img.height ? `${img.width}×${img.height}` : <span className="na">—</span>}</td>
                    <td className="small">{img.loading ?? <span className="na">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
