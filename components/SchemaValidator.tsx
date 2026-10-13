"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateSchema } from "@/lib/engine";
import { flattenIssues } from "@/lib/schema-utils";
import type { SchemaReport } from "@/lib/types";
import { PageHead } from "./kit";
import { useResearchStatus } from "./research/common";
import SchemaView from "./SchemaView";
import { download } from "./ui";

type Mode = "url" | "code";
type View = "rendered" | "raw";

interface Result {
  url?: string;
  raw: SchemaReport;
  rendered?: SchemaReport;
  renderError?: string;
  truncated?: boolean;
  status?: number;
}

const EXAMPLE = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Trail Runner 2",
  "image": "https://example.com/trail-runner.jpg",
  "offers": {
    "@type": "Offer",
    "price": "89.00",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  }
}
</script>`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || body.error) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { code: body.code });
  return body as T;
}

export default function SchemaValidator() {
  const status = useResearchStatus();
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [view, setView] = useState<View>("rendered");
  const autorun = useRef(false);

  const runUrl = async (target: string) => {
    setError(null);
    setResult(null);
    setBusy("Fetching the page (and rendering it, when the Scrapling service is connected)");
    try {
      const [page, rendered] = await Promise.all([
        getJson<{ finalUrl: string; status: number; html: string; truncated: boolean }>(`/api/page?full=1&url=${encodeURIComponent(target)}`),
        // 501 "no-scraper" when no rendering service is configured: validate the raw HTML only.
        getJson<{ html: string; status: number }>(`/api/render?url=${encodeURIComponent(target)}`).catch((e: Error & { code?: string }) =>
          e.code === "no-scraper" ? null : { error: e.message },
        ),
      ]);
      const raw = await validateSchema(page.html);
      const out: Result = { url: page.finalUrl, raw, truncated: page.truncated, status: page.status };
      if (rendered && "html" in rendered) out.rendered = await validateSchema(rendered.html);
      else if (rendered && "error" in rendered) out.renderError = rendered.error.split("\n")[0].replace(/^Render failed: /, "").trim();
      const renderedOk = rendered && "html" in rendered && rendered.status < 400;
      if (page.status >= 400 && !renderedOk)
        throw new Error(
          out.rendered
            ? `The page returned HTTP ${page.status}, in the browser too. Check the URL.`
            : `The site answered HTTP ${page.status} and the page couldn't be rendered, so there's nothing reliable to validate.`,
        );
      setResult(out);
      setView(out.rendered ? "rendered" : "raw");
      const u = new URL(window.location.href);
      u.searchParams.set("url", target);
      window.history.replaceState(null, "", u);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runCode = async () => {
    setError(null);
    setResult(null);
    try {
      setResult({ raw: await validateSchema(code) });
      setView("raw");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ?url= deep links (from the audit report and site crawl) run on first load.
  useEffect(() => {
    if (autorun.current) return;
    autorun.current = true;
    const initial = new URL(window.location.href).searchParams.get("url");
    if (initial) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from the URL after mount */
      setUrl(initial);
      void runUrl(initial);
    }
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "url" ? url.trim() : code.trim()) void (mode === "url" ? runUrl(url.trim()) : runCode());
  };

  const shown = result ? (view === "rendered" && result.rendered ? result.rendered : result.raw) : null;

  const exportCsv = () => {
    if (!shown) return;
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows = flattenIssues(shown).map((i) => [i.severity, i.path, i.message].map(esc).join(","));
    download("schema-issues.csv", ["severity,location,message", ...rows].join("\n"), "text/csv");
  };

  return (
    <main className="shell">
      <PageHead
        title="Schema validator"
        sub="Validate JSON-LD, Microdata and RDFa against the full schema.org vocabulary, check Google rich-result requirements, and verify the markup matches what's on the page."
      />
      <div className="stack">
        <form className="card scan-box" style={{ maxWidth: "none", margin: 0 }} onSubmit={submit}>
          <div className="segmented" role="group" aria-label="Input" style={{ marginBottom: 10 }}>
            <button type="button" aria-pressed={mode === "url"} onClick={() => setMode("url")}>Fetch URL</button>
            <button type="button" aria-pressed={mode === "code"} onClick={() => setMode("code")}>Code snippet</button>
          </div>
          {mode === "url" ? (
            <div className="scan-row">
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/product" aria-label="Page URL" />
              <button className="btn btn-primary" type="submit" disabled={!!busy}>{busy ? "Validating" : "Validate"}</button>
            </div>
          ) : (
            <>
              <textarea className="input textarea" style={{ minHeight: 220 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder={EXAMPLE} aria-label="HTML or JSON-LD" spellCheck={false} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn btn-primary" type="submit">Validate</button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setCode(EXAMPLE)}>Load an example</button>
              </div>
            </>
          )}
          <p className="muted small" style={{ marginTop: 8 }}>
            Runs in your browser with the WASM engine.{" "}
            {mode === "url" && (status?.scraper ? "Pages are also rendered in Chromium to validate what Google sees after JavaScript." : "Validates the raw HTML; connect the Scrapling service to also validate the rendered page.")}
          </p>
          {error && <div className="error-box">{error}</div>}
        </form>

        {busy && (
          <div className="card card-pad row small" aria-live="polite">
            <span className="spinner" /> {busy}
          </div>
        )}

        {result && shown && (
          <>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {result.url && <span className="mono small break">{result.url}</span>}
              <span className="spacer" />
              {result.rendered && (
                <div className="segmented" role="group" aria-label="Version">
                  <button type="button" aria-pressed={view === "rendered"} onClick={() => setView("rendered")}>Rendered (Google)</button>
                  <button type="button" aria-pressed={view === "raw"} onClick={() => setView("raw")}>Raw HTML</button>
                </div>
              )}
              <button className="btn btn-sm" onClick={exportCsv} disabled={!shown.errors && !shown.warnings}>Export issues</button>
            </div>
            {result.status != null && result.status >= 400 && (
              <div className="notice">
                The site refused a plain request (HTTP {result.status}) but rendered in the browser. The rendered result is the real page; the raw HTML view shows the error page.
              </div>
            )}
            {result.renderError && <div className="notice">Couldn&apos;t render the page ({result.renderError}); showing the raw HTML.</div>}
            {result.truncated && <div className="notice">The page is larger than 3 MB; only the first 3 MB was validated.</div>}
            <SchemaView key={`${result.url}-${view}`} report={shown} rawCompare={view === "rendered" && result.rendered ? result.raw : null} />
          </>
        )}
      </div>
    </main>
  );
}
