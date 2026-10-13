// Structured-data validation of a live URL, shared by /api/schema and the MCP
// tool. Validates the raw HTML (what validator.schema.org reads) and, when the
// Scrapling service is configured, the rendered DOM (what Google reads).

import { fetchPage } from "@/lib/server/fetch-bundle";
import { validateSchemaOnServer } from "@/lib/server/engine";
import { renderPage, scraperConfigured } from "@/lib/server/scraper";
import type { SchemaReport } from "@/lib/types";

export interface SchemaCheck {
  url: string;
  finalUrl: string;
  status: number;
  raw: SchemaReport;
  rendered?: SchemaReport;
  renderError?: string;
  /** Set when the site refused or failed the request, so "no markup" isn't misread. */
  warning?: string;
}

export async function validateUrl(url: string, render = true): Promise<SchemaCheck> {
  const [page, rendered] = await Promise.all([
    fetchPage(url, 3_000_000),
    render && scraperConfigured() ? renderPage(url) : Promise.resolve(null),
  ]);
  const out: SchemaCheck = { url: page.url, finalUrl: page.finalUrl, status: page.status, raw: validateSchemaOnServer(page.html) };
  if (rendered && "error" in rendered) out.renderError = rendered.error.split("\n")[0].trim();
  else if (rendered) out.rendered = validateSchemaOnServer(rendered.html);
  const renderedOk = rendered && !("error" in rendered) && rendered.status < 400;
  if (page.status >= 400)
    out.warning = renderedOk
      ? `The site answered HTTP ${page.status} to a plain request; the rendered result reflects the real page.`
      : `The page returned HTTP ${page.status}, so this is the markup of an error page, not real content.`;
  return out;
}
