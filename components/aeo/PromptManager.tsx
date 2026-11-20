"use client";

import { useMemo, useState } from "react";
import { classifyPrompt, generatePrompts, PROMPT_TYPES, STAGES, type PromptType, type Stage } from "@/lib/aeo";
import type { Project } from "@/lib/project";
import { Section, TypeBadge } from "./shared";

// Prompts grouped by buyer stage and type, with ideas generated from the category, audience and competitors.

export default function PromptManager({ project, brand, update }: { project: Project; brand: string; update: (p: Partial<Project>) => void }) {
  const [adding, setAdding] = useState("");
  // Open by default only while there are no prompts (the project loads after the first render).
  const [ideasToggle, setIdeasOpen] = useState<boolean | null>(null);
  const ideasOpen = ideasToggle ?? project.prompts.length === 0;
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const typed = useMemo(() => project.prompts.map((p) => ({ text: p, type: classifyPrompt(p, brand) })), [project.prompts, brand]);
  const ideas = useMemo(
    () =>
      generatePrompts({ brand, category: project.category, audience: project.audience, competitors: project.competitors, keywords: project.keywords }).filter(
        (i) => !project.prompts.some((p) => p.toLowerCase() === i.text.toLowerCase()),
      ),
    [brand, project.category, project.audience, project.competitors, project.keywords, project.prompts],
  );
  const byStage = (rows: { text: string; type: PromptType }[]) =>
    (Object.keys(STAGES) as Stage[]).map((s) => ({ stage: s, rows: rows.filter((r) => PROMPT_TYPES[r.type].stage === s) })).filter((g) => g.rows.length);

  const addList = (list: string[]) => list.length && update({ prompts: [...project.prompts, ...list] });

  return (
    <Section
      title={`Prompts (${project.prompts.length})`}
      sub="Questions buyers ask AI assistants, grouped by stage. Neutral prompts (no brand name) measure real visibility."
      actions={
        <button className="btn btn-sm" onClick={() => setIdeasOpen(!ideasOpen)} aria-expanded={ideasOpen}>
          {ideasOpen ? "Hide ideas" : "Prompt ideas"}
        </button>
      }
    >
      <div className="row" style={{ marginBottom: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="pb-field" style={{ maxWidth: 200 }}>
          <span>Brand name</span>
          <input key={project.id + brand} className="input" defaultValue={brand} onBlur={(e) => update({ brand: e.currentTarget.value })} />
        </label>
        <label className="pb-field" style={{ maxWidth: 220 }}>
          <span>Also known as (comma-separated)</span>
          <input key={project.id + "aka"} className="input" defaultValue={project.aliases.join(", ")} placeholder="openlit.io, Open LIT" onBlur={(e) => update({ aliases: e.currentTarget.value.split(",") })} />
        </label>
        <form
          className="row"
          style={{ flex: 1, minWidth: 260 }}
          onSubmit={(e) => {
            e.preventDefault();
            addList(adding.split("\n").map((s) => s.trim()).filter(Boolean));
            setAdding("");
          }}
        >
          <input className="input" style={{ flex: 1 }} placeholder="What is the best invoicing tool for freelancers?" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="New prompt" />
          <button className="btn" type="submit" disabled={!adding.trim()}>Add prompt</button>
        </form>
      </div>

      {ideasOpen && (
        <div className="card card-pad" style={{ background: "var(--surface-2)", marginBottom: 14 }}>
          <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="pb-field" style={{ flex: 1, minWidth: 200 }}>
              <span>What you sell, in buyers&apos; words</span>
              <input key={project.id + "cat"} className="input" defaultValue={project.category} placeholder="LLM observability" onBlur={(e) => update({ category: e.currentTarget.value })} />
            </label>
            <label className="pb-field" style={{ flex: 1, minWidth: 200 }}>
              <span>Who buys it</span>
              <input key={project.id + "aud"} className="input" defaultValue={project.audience} placeholder="AI engineers" onBlur={(e) => update({ audience: e.currentTarget.value })} />
            </label>
          </div>
          {ideas.length === 0 ? (
            <p className="muted small" style={{ marginTop: 10 }}>Fill in what you sell (or add competitors and keywords) to get prompt ideas.</p>
          ) : (
            <>
              {byStage(ideas).map((g) => (
                <div key={g.stage} style={{ marginTop: 12 }}>
                  <div className="small muted" style={{ marginBottom: 6, fontWeight: 600 }}>{STAGES[g.stage]}</div>
                  <div className="list-rows">
                    {g.rows.map((i) => (
                      <label className="list-row" key={i.text} style={{ cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={picked.has(i.text)}
                          onChange={(e) => {
                            const n = new Set(picked);
                            if (e.currentTarget.checked) n.add(i.text);
                            else n.delete(i.text);
                            setPicked(n);
                          }}
                        />
                        <span style={{ flex: 1 }}>{i.text}</span>
                        <TypeBadge type={i.type} />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" disabled={!picked.size} onClick={() => (addList([...picked]), setPicked(new Set()))}>
                  Add {picked.size || ""} selected
                </button>
                <button className="btn btn-sm" onClick={() => setPicked(new Set(ideas.map((i) => i.text)))}>Select all</button>
              </div>
            </>
          )}
        </div>
      )}

      {project.prompts.length === 0 ? (
        <div className="notice">No prompts yet. Open “Prompt ideas”, or type your own.</div>
      ) : (
        byStage(typed).map((g) => (
          <div key={g.stage} style={{ marginTop: 6 }}>
            <div className="small muted" style={{ margin: "8px 0 4px", fontWeight: 600 }}>
              {STAGES[g.stage]} · {g.rows.length}
            </div>
            <div className="list-rows">
              {g.rows.map((r) => (
                <div className="list-row" key={r.text}>
                  <span style={{ flex: 1 }}>{r.text}</span>
                  <TypeBadge type={r.type} />
                  <button className="chip-x" aria-label={`Remove ${r.text}`} onClick={() => update({ prompts: project.prompts.filter((x) => x !== r.text) })}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </Section>
  );
}
