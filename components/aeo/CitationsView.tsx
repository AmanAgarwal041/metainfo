"use client";

import { useMemo, useState } from "react";
import { SOURCE_TYPES, type Brand, type SourceType } from "@/lib/aeo";
import type { RunAnswers } from "@/lib/aeo-actions";
import { CHANNEL_COLOR, CONTENT_TYPES, channelLabel, composition, mentionRateWhenCited, metricsFor, urlTable, type ContentType } from "@/lib/aeo-insights";
import { HBars, LineChart, StackedBars } from "../charts";
import { Citations as SourceTypes } from "./Results";
import { TopDomains, TopUrls } from "./Dashboard";
import { ContentBadge, DomainCell, GroupHead, Pager, Tile, useSearchPage } from "./tables";

// Citations: how often engines cite you against competitors over time, what kinds of pages and channels they cite,
// your most-cited pages next to the most-cited pages overall, and every cited domain and URL.

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)"];

export default function CitationsView({ runs, brands }: { runs: RunAnswers[]; brands: Brand[] }) {
  const answers = runs.at(-1)!.answers;
  const x = runs.map((r) => fmt(r.at));
  const trend = runs.length > 1;
  const shown = brands.slice(0, 7);
  const label = (b: Brand, i: number) => (i === 0 ? `${b.name} (you)` : b.name);
  const comps = useMemo(() => runs.map((r) => composition(r.answers, brands)), [runs, brands]);
  const contentKeys = (Object.keys(CONTENT_TYPES) as ContentType[]).filter((k) => comps.some((c) => c.content[k]));
  const channelKeys = (Object.keys(SOURCE_TYPES) as SourceType[]).filter((k) => comps.some((c) => c.channel[k]));
  const urls = useMemo(() => urlTable(answers, brands), [answers, brands]);
  const owned = urls.filter((u) => u.channel === "you");
  const [showTypes, setShowTypes] = useState(false);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <GroupHead title="Citation performance vs. competitors" sub="How often engines cite each brand's own pages, and how often answers that cite sources name each brand." />
      <div className="bento">
        <Tile className="b-6" title="Owned domain citation rate" sub="Share of answers citing a page on each brand's site or accounts.">
          {trend ? (
            <LineChart ariaLabel="Citation rate per brand per run" x={x} yDomain={[0, 100]} format={(n) => `${n}%`} series={shown.map((b, i) => ({ id: b.domain, label: label(b, i), color: SERIES[i], values: runs.map((r) => { const m = metricsFor(r.answers, b.domain); return m.answered ? m.citationRate : null; }) }))} />
          ) : (
            <HBars items={shown.map((b, i) => ({ label: label(b, i), value: metricsFor(answers, b.domain).citationRate })).sort((a, b) => b.value - a.value)} format={(n) => `${n}%`} />
          )}
        </Tile>
        <Tile className="b-6" title="Brand mention rate in cited answers" sub="Of the answers that cite sources, the share naming each brand.">
          {trend ? (
            <LineChart ariaLabel="Mention rate in cited answers per brand per run" x={x} yDomain={[0, 100]} format={(n) => `${n}%`} series={shown.map((b, i) => ({ id: b.domain, label: label(b, i), color: SERIES[i], values: runs.map((r) => mentionRateWhenCited(r.answers, b.domain)) }))} />
          ) : (
            <HBars items={shown.map((b, i) => ({ label: label(b, i), value: mentionRateWhenCited(answers, b.domain) ?? 0 })).sort((a, b) => b.value - a.value)} format={(n) => `${n}%`} />
          )}
        </Tile>
      </div>

      <GroupHead title="Citation composition" sub="Which kinds of pages and which channels shape the answers. Publish the content types engines favour for your prompts, on the channels they cite." />
      <div className="bento">
        <Tile className="b-6" title="Citations by content type" sub="Share of citations per kind of page, per run.">
          <StackedBars ariaLabel="Citations by content type per run" x={x} series={contentKeys.map((k) => ({ id: k, label: CONTENT_TYPES[k].label, color: CONTENT_TYPES[k].color, values: comps.map((c) => c.content[k] ?? 0) }))} />
        </Tile>
        <Tile className="b-6" title="Citations by channel" sub="Share of citations per channel: your site, competitors, forums, reviews and so on.">
          <StackedBars ariaLabel="Citations by channel per run" x={x} series={channelKeys.map((k) => ({ id: k, label: channelLabel(k), color: CHANNEL_COLOR[k], values: comps.map((c) => c.channel[k] ?? 0) }))} />
        </Tile>
      </div>

      <GroupHead title="Overview of top citations" sub="The pages engines reference most from your site, next to the most referenced pages overall." />
      <div className="bento">
        <Tile className="b-6" title="Top owned citations" sub="Your pages (site and accounts) cited in the latest run.">
          <UrlList rows={owned} empty="None of your pages was cited in the latest run. The Actions tab lists which pages to create and where to get mentioned." />
        </Tile>
        <Tile className="b-6" title="Top citations overall" sub="Every cited page in the latest run.">
          <UrlList rows={urls} withType />
        </Tile>
      </div>

      <GroupHead title="Citation analysis" sub="Every domain and page in the latest run's answers." />
      <TopDomains answers={answers} brands={brands} />
      <TopUrls answers={answers} brands={brands} title="All citations" sub="Every cited URL, what kind of page it is, and whether the answer names you or competitors." />
      <Tile
        title="Plays by source type"
        sub="What to do about each kind of source. Click a type to see its domains."
        actions={<button className="btn btn-sm" onClick={() => setShowTypes(!showTypes)}>{showTypes ? "Hide" : "Show"}</button>}
      >
        {showTypes && <SourceTypes answers={answers} brands={brands} />}
      </Tile>
    </div>
  );
}

function UrlList({ rows, withType, empty }: { rows: ReturnType<typeof urlTable>; withType?: boolean; empty?: string }) {
  const t = useSearchPage(rows, (r) => r.url, 5);
  if (!rows.length) return <p className="muted small">{empty ?? "No citations."}</p>;
  return (
    <>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Cited URL</th>
              {withType && <th>Content type</th>}
              <th style={{ textAlign: "right" }}>Answers</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.url}>
                <td style={{ maxWidth: 360 }}><DomainCell domain={r.domain} url={r.url} title={r.title} sub={r.url.replace(/^https?:\/\/(www\.)?/, "")} /></td>
                {withType && <td><ContentBadge type={r.content} /></td>}
                <td className="mono" style={{ textAlign: "right" }}>{r.citations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={t.page} pages={t.pages} total={t.total} onPage={t.setPage} />
    </>
  );
}
