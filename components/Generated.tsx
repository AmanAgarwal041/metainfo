"use client";

import type { Report } from "@/lib/types";
import { CodeBlock, download } from "./ui";

export default function Generated({ report }: { report: Report }) {
  const g = report.generated;
  const files = [
    {
      name: "<head> tags",
      file: "head.html",
      code: g.headHtml,
      note: "A complete, recommended <head> block built from this page's own content. Existing values are kept, and missing ones are filled with suggestions. Replace any placeholders before shipping.",
    },
    {
      name: "Structured data (JSON-LD)",
      file: "schema.html",
      code: g.jsonLd,
      note: "Organization, WebSite and WebPage/Article entities, plus BreadcrumbList for deeper pages. Validate at validator.schema.org after editing placeholders such as sameAs profiles and logo.",
    },
    {
      name: "robots.txt",
      file: "robots.txt",
      code: g.robotsTxt,
      note: "Explicitly allows search engines and AI answer engines, keeps your existing User-agent: * rules, preserves your current choice for training crawlers, and declares your sitemap. Serve it at /robots.txt.",
    },
    {
      name: "llms.txt",
      file: "llms.txt",
      code: g.llmsTxt,
      note: "A curated markdown map of your key pages for LLMs (llmstxt.org). Edit the link descriptions, then serve it at /llms.txt as text/plain or text/markdown.",
    },
  ];
  return (
    <div className="stack">
      {files.map((f) => (
        <div className="card card-pad" key={f.file}>
          <div className="row">
            <h3 className="section-title">{f.name}</h3>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => download(f.file, f.code)}>
              Download {f.file}
            </button>
          </div>
          <p className="section-sub">{f.note}</p>
          <CodeBlock code={f.code} />
        </div>
      ))}
    </div>
  );
}
