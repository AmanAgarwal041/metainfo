"use client";

import { useEffect, useState } from "react";
import { createProject, deleteProject, saveProject, selectProject, useProjects } from "@/lib/project";
import { getToken, setToken } from "@/lib/research-client";
import { LOCATIONS } from "@/lib/research-types";
import { setTheme, useTheme } from "@/lib/theme";
import { PageHead } from "./kit";
import { useResearchStatus } from "./research/common";
import { CodeBlock, CopyButton, download } from "./ui";

function Section({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card card-pad" style={{ scrollMarginTop: 70 }}>
      <h2 className="section-title">{title}</h2>
      {sub && <p className="section-sub">{sub}</p>}
      {children}
    </section>
  );
}

function Projects() {
  const { projects, activeId } = useProjects();
  const [domain, setDomain] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  return (
    <Section id="projects" title="Projects" sub="Each project has its own domain, competitors, market, tracked keywords and AI prompts.">
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Name</th>
              <th>Domain</th>
              <th>Brand</th>
              <th>Market</th>
              <th style={{ textAlign: "right" }}>Keywords</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    key={p.name}
                    className="input"
                    style={{ height: 30 }}
                    defaultValue={p.name}
                    aria-label="Project name"
                    onFocus={() => selectProject(p.id)}
                    onBlur={(e) => saveProject({ name: e.currentTarget.value || p.name })}
                  />
                </td>
                <td>
                  <input key={p.domain} className="input" style={{ height: 30 }} defaultValue={p.domain} aria-label="Domain" onFocus={() => selectProject(p.id)} onBlur={(e) => saveProject({ domain: e.currentTarget.value })} />
                </td>
                <td>
                  <input key={p.brand} className="input" style={{ height: 30 }} defaultValue={p.brand} aria-label="Brand name" onFocus={() => selectProject(p.id)} onBlur={(e) => saveProject({ brand: e.currentTarget.value })} />
                </td>
                <td>
                  <select
                    className="select"
                    value={p.location}
                    aria-label="Market"
                    onChange={(e) => {
                      selectProject(p.id);
                      saveProject({ location: Number(e.target.value) });
                    }}
                  >
                    {LOCATIONS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: "right" }}>{p.keywords.length}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {p.id === activeId ? <span className="badge accent">active</span> : <button className="btn btn-sm btn-ghost" onClick={() => selectProject(p.id)}>Switch</button>}
                  {deleting === p.id ? (
                    <>
                      <button className="btn btn-sm" style={{ color: "var(--fail)" }} onClick={() => { deleteProject(p.id); setDeleting(null); }}>Confirm delete</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setDeleting(null)}>Keep</button>
                    </>
                  ) : (
                    <button className="btn btn-sm btn-ghost" onClick={() => setDeleting(p.id)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="row"
        style={{ marginTop: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (domain.trim()) createProject({ domain });
          setDomain("");
        }}
      >
        <input className="input" style={{ maxWidth: 320 }} placeholder="newsite.com" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="New project domain" />
        <button className="btn btn-primary" type="submit" disabled={!domain.trim()}>Create project</button>
      </form>
    </Section>
  );
}

export default function Settings() {
  const status = useResearchStatus();
  const theme = useTheme();
  const [origin, setOrigin] = useState("http://localhost:3000");
  const [token, setTok] = useState("");
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- browser-only values */
    setOrigin(window.location.origin);
    setTok(getToken());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const mcpUrl = `${origin}/api/mcp`;
  const authArg = status?.tokenRequired ? ` --header "Authorization: Bearer YOUR_RESEARCH_TOKEN"` : "";
  const cursorJson = JSON.stringify(
    { mcpServers: { metainfo: { url: mcpUrl, ...(status?.tokenRequired ? { headers: { Authorization: "Bearer YOUR_RESEARCH_TOKEN" } } : {}) } } },
    null,
    2,
  );
  const markMcp = () => {
    try {
      localStorage.setItem("metainfo:mcp-copied", "1");
    } catch {
      /* storage blocked */
    }
  };

  const exportAll = () => {
    const data: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("metainfo:") && k !== "metainfo:research-token") data[k] = localStorage.getItem(k)!;
    }
    download(`metainfo-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json");
  };

  return (
    <main className="shell">
      <PageHead title="Settings" sub="Projects, data sources, AI agent access and your stored data." />
      <div className="stack">
        <Projects />

        <Section id="data" title="Data source" sub="Audits, autocomplete keyword ideas, content gaps and audit comparisons are free. Search volumes, rankings, competitors, backlinks and AI answers come from DataForSEO (pay as you go).">
          <div className="row" style={{ marginBottom: 12 }}>
            <span className={`badge ${status?.dataforseo ? "gain" : ""}`}>{status == null ? "Checking" : status.dataforseo ? "DataForSEO connected" : "Not connected"}</span>
            {status?.tokenRequired && <span className="badge accent">Access token required</span>}
          </div>
          {!status?.dataforseo && (
            <>
              <p className="small" style={{ marginBottom: 8 }}>Add your API credentials to <code>.env.local</code> on the server and restart it:</p>
              <CodeBlock code={`DATAFORSEO_LOGIN=you@example.com\nDATAFORSEO_PASSWORD=your-api-password   # app.dataforseo.com/api-access\nRESEARCH_TOKEN=pick-a-secret            # recommended when deployed`} />
            </>
          )}
          {status?.tokenRequired && (
            <form
              className="row"
              style={{ marginTop: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                setToken(token);
                setSaved(true);
                setTimeout(() => setSaved(false), 1500);
              }}
            >
              <input className="input" type="password" style={{ maxWidth: 320 }} value={token} onChange={(e) => setTok(e.target.value)} placeholder="Research token" aria-label="Research token" />
              <button className="btn" type="submit">{saved ? "Saved" : "Save token"}</button>
            </form>
          )}
        </Section>

        <Section id="mcp" title="Connect an AI agent (MCP)" sub="Let Claude Code, Cursor or any MCP client run audits, keyword research, SERP checks, gap analysis and backlink lookups through this server.">
          <div className="field-label" style={{ marginBottom: 6 }}>Claude Code</div>
          <div onCopy={markMcp}>
            <CodeBlock code={`claude mcp add --transport http metainfo ${mcpUrl}${authArg}`} />
          </div>
          <div className="field-label" style={{ margin: "14px 0 6px" }}>Cursor and other clients (mcp.json)</div>
          <div onCopy={markMcp}>
            <CodeBlock code={cursorJson} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <CopyButton text={mcpUrl} label="Copy server URL" />
            <button className="btn btn-sm btn-ghost" onClick={markMcp}>I&apos;ve connected it</button>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            Tools: audit_page (free), keyword_ideas (free ideas, volumes with DataForSEO), serp_check, keyword_gap, find_competitors and backlinks. Paid tools are hidden until DataForSEO is configured.
          </p>
        </Section>

        <Section id="appearance" title="Appearance">
          <div className="segmented" role="group" aria-label="Theme">
            {(["light", "dark", "system"] as const).map((t) => (
              <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>
                {t === "system" ? "Match system" : t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </Section>

        <Section id="storage" title="Your data" sub="Projects, audit history, rank checks and AI runs are stored in this browser. Export a backup to move them or keep a copy.">
          <div className="row">
            <button className="btn" onClick={exportAll}>Export backup</button>
            <label className="btn">
              Import backup
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const data = JSON.parse(await f.text()) as Record<string, string>;
                    let n = 0;
                    for (const [k, v] of Object.entries(data)) {
                      if (k.startsWith("metainfo:") && typeof v === "string") {
                        localStorage.setItem(k, v);
                        n++;
                      }
                    }
                    setImportMsg(`Imported ${n} items. Reloading.`);
                    setTimeout(() => window.location.reload(), 800);
                  } catch {
                    setImportMsg("That file isn't a MetaInfo backup.");
                  }
                }}
              />
            </label>
            {resetting ? (
              <>
                <button
                  className="btn"
                  style={{ color: "var(--fail)" }}
                  onClick={() => {
                    Object.keys(localStorage).filter((k) => k.startsWith("metainfo:")).forEach((k) => localStorage.removeItem(k));
                    window.location.reload();
                  }}
                >
                  Delete everything
                </button>
                <button className="btn btn-ghost" onClick={() => setResetting(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => setResetting(true)}>Reset all data</button>
            )}
          </div>
          {importMsg && <p className="small" style={{ marginTop: 8 }}>{importMsg}</p>}
        </Section>
      </div>
    </main>
  );
}
