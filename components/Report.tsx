"use client";

import { useState } from "react";
import type { TrackedSite } from "@/lib/history";
import type { Platform, Report as ReportT } from "@/lib/types";
import type { ScanMeta } from "./App";
import Crawlers from "./Crawlers";
import Generated from "./Generated";
import History from "./History";
import Issues from "./Issues";
import Overview from "./Overview";
import Plan from "./Plan";
import Previews from "./Previews";
import Tags from "./Tags";
import { download, ScoreRing } from "./ui";

export type TabId = "overview" | "issues" | "plan" | "crawlers" | "tags" | "previews" | "generated" | "history";

export default function Report({
  report,
  meta,
  site,
  onRescan,
  onSiteChange,
}: {
  report: ReportT;
  meta: ScanMeta;
  site: TrackedSite | null;
  onRescan: () => void;
  onSiteChange: (s: TrackedSite) => void;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const issues = report.checks.filter((c) => c.status === "fail" || c.status === "warn").length;
  const tasks = report.plan.reduce((n, p) => n + p.tasks.length, 0);

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "issues", label: "Issues", count: issues },
    { id: "plan", label: "Fix plan", count: tasks },
    { id: "crawlers", label: "AI & crawlers" },
    { id: "tags", label: "Tags & content" },
    { id: "previews", label: "Previews" },
    { id: "generated", label: "Generated files" },
    { id: "history", label: "Tracking", count: site?.snapshots.length },
  ];

  const openIssues = (p: Platform | "all") => {
    setPlatformFilter(p);
    setTab("issues");
  };

  return (
    <>
      <div className="report-head">
        <ScoreRing score={report.summary.overall} size={84} stroke={8} label="overall" />
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2 className="break">{report.page.title || "Untitled page"}</h2>
          <div className="report-url">
            {report.finalUrl ? (
              <a href={report.finalUrl} target="_blank" rel="noreferrer">
                {report.finalUrl}
              </a>
            ) : (
              "Pasted HTML"
            )}
          </div>
          <div className="facts">
            {report.status != null && (
              <span>
                HTTP <b>{report.status}</b>
              </span>
            )}
            {report.redirects.length > 0 && (
              <span>
                <b>{report.redirects.length}</b> redirect{report.redirects.length > 1 ? "s" : ""}
              </span>
            )}
            {report.ttfbMs != null && (
              <span>
                TTFB <b>{report.ttfbMs} ms</b>
              </span>
            )}
            <span>
              HTML <b>{Math.round(report.page.htmlBytes / 1024)} KB</b>
            </span>
            {meta.fetchMs != null && (
              <span>
                fetched in <b>{(meta.fetchMs / 1000).toFixed(1)} s</b>
              </span>
            )}
            <span>
              analysed in <b>{meta.analyzeMs.toFixed(0)} ms</b> (WASM)
            </span>
          </div>
        </div>
        <div className="row">
          <button
            className="btn"
            onClick={() => download(`metainfo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(report, null, 2), "application/json")}
          >
            Export JSON
          </button>
          <button className="btn btn-primary" onClick={onRescan}>
            Rescan
          </button>
        </div>
      </div>

      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.count ? <span className="count">{t.count}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "overview" && <Overview report={report} site={site} onOpenIssues={openIssues} onOpenPlan={() => setTab("plan")} />}
      {tab === "issues" && <Issues report={report} platform={platformFilter} onPlatform={setPlatformFilter} />}
      {tab === "plan" && <Plan report={report} site={site} onSiteChange={onSiteChange} />}
      {tab === "crawlers" && <Crawlers report={report} />}
      {tab === "tags" && <Tags report={report} />}
      {tab === "previews" && <Previews report={report} />}
      {tab === "generated" && <Generated report={report} />}
      {tab === "history" && <History report={report} site={site} />}
    </>
  );
}
