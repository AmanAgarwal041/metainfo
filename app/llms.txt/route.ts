import { DESCRIPTION, LAST_UPDATED, REPO, SITE_URL, TOOLS } from "@/lib/site";

// llms.txt (llmstxt.org): a plain summary of the site and its key pages for AI agents and answer engines.
export const dynamic = "force-static";

export function GET() {
  const body = [
    "# MetaInfo",
    "",
    `> ${DESCRIPTION}`,
    "",
    "MetaInfo is an open-source SEO and AI visibility toolkit. The page audit runs in the browser (Rust compiled to WebAssembly) and needs no account. Research and AI-answer tracking use the visitor's own DataForSEO keys, paid per request.",
    `Last updated: ${LAST_UPDATED}.`,
    "",
    "## Tools",
    "",
    ...TOOLS.map((t) => `- [${t.title}](${SITE_URL}${t.path}): ${t.description}`),
    "",
    "## For developers and agents",
    "",
    `- [Report API](${SITE_URL}/api/report?url=example.com&format=summary): runs the audit server-side; with \`min\`, answers HTTP 422 when the score is below the threshold, for CI.`,
    `- [MCP server](${SITE_URL}/api/mcp): Streamable HTTP. Tools: audit_page, validate_schema, keyword_ideas, suggest_ai_prompts, simulate_ai_citation, with DataForSEO ai_visibility_check, ask_ai_engine and the research tools, and with a Google Search Console service account search_console_report and search_console_inspect_url. Prompts: improve_ai_citations, ai_visibility_baseline, seo_audit_and_fix.`,
    `- [Source code and docs](${REPO})`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
