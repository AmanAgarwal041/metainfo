// Client for the optional Scrapling service (scraper/): JavaScript rendering
// and site crawling. Configure with SCRAPER_URL (and SCRAPER_TOKEN if set on
// the service). Without it, audits use raw HTML only and crawls fall back to
// the built-in page-by-page crawler.

export function scraperConfigured(): boolean {
  return Boolean(process.env.SCRAPER_URL);
}

function endpoint(path: string): string {
  return `${process.env.SCRAPER_URL!.replace(/\/$/, "")}${path}`;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (process.env.SCRAPER_TOKEN) h["x-scraper-token"] = process.env.SCRAPER_TOKEN;
  return h;
}

export interface Rendered {
  finalUrl: string;
  status: number;
  html: string;
  renderMs: number;
}

/** Render a page in the service's headless browser. Never throws: rendering is an optional extra. */
export async function renderPage(url: string): Promise<Rendered | { error: string }> {
  try {
    const res = await fetch(endpoint("/render"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.html) return { error: body?.detail ?? `Render service HTTP ${res.status}` };
    return body as Rendered;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Start a crawl; returns the service's response for streaming straight to the client. */
export async function crawlSite(url: string, maxPages: number, maxDepth: number): Promise<Response> {
  return fetch(endpoint("/crawl"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ url, maxPages, maxDepth }),
    signal: AbortSignal.timeout(240_000),
  });
}
