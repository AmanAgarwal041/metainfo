# MetaInfo

Scan any page the way **Google, Bing, ChatGPT, Perplexity, Claude and Gemini** see it. MetaInfo finds missing tags, crawler
blocks, and sitemap, robots.txt and llms.txt problems, checks the page against Google's guidelines and AI-readiness rules,
generates the fixes, and tracks your scores over time.

## What it does

| Area | Details |
| --- | --- |
| **Per-platform scores** | Separate 0–100 scores for Google, Bing, ChatGPT, Perplexity, Claude, Gemini/AI Overviews and social sharing. Each is weighted by the checks that platform depends on. |
| **55+ checks** | Indexability (status, HTTPS, redirects, noindex, snippet controls, canonical, hreflang, lang), meta tags, Open Graph/X cards, headings, content depth, client-side-rendering detection, image alt text, links, JSON-LD validity and required properties, entity markup, freshness, authorship, performance and security headers. |
| **Crawler access matrix** | For 14 crawlers (Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, GPTBot, Claude-SearchBot, Claude-User, ClaudeBot, PerplexityBot, …): the robots.txt verdict for this exact URL (RFC 9309 longest-match with `*`/`$`), plus the live HTTP status when the page is requested with that crawler's user agent, which catches CDN/WAF blocks. |
| **robots.txt / sitemap / llms.txt** | Parses and validates all three. Includes sitemap indexes, `.xml.gz` files, lastmod coverage, whether the page is listed, and `Content-Signal` directives. |
| **Previews** | Live, editable previews of Google results, AI-answer citations, Facebook, X, LinkedIn and Slack cards. Edit, then export the tags. |
| **Generated files** | A complete `<head>`, JSON-LD `@graph` (Organization, WebSite, WebPage/Article, BreadcrumbList), a recommended robots.txt and a draft llms.txt, all built from the page's own content. |
| **Fix plan** | Failing checks grouped into Blockers → Quick wins → Foundations → Polish, ranked by estimated score gain per unit of effort. Includes per-task status, projected scores, and Markdown export for tickets. |
| **Tracking** | Every scan is saved as a snapshot, with trend charts per platform, a fixed/regressed diff between scans, and tasks auto-verified when a rescan passes. |

## Research tools

Shared across pages: your site, up to 5 competitors and a target market (15 countries), remembered in the browser.

| Page | Free (no keys) | With DataForSEO |
| --- | --- | --- |
| **Keywords** (`/keywords`) | Long-tail ideas from Google Autocomplete (seed × questions, modifiers, a–z), grouped into questions, commercial, comparisons and prepositions | Search volume, keyword difficulty, CPC, intent, a 12-month trend and an opportunity score (volume × ease) |
| **Keyword gap** (`/keyword-gap`) | **Content gap:** topics competitors' pages cover that yours doesn't, extracted by the Rust engine (phrase extraction weighted by title, H1, headings and URL) | **Ranking gap:** keywords competitors rank for and you don't (missing), where they outrank you (weak), and where you lead (strong) |
| **Competitors** (`/competitors`) | **Audit comparison:** the full audit on your homepage and each competitor's side by side, plus "they do it, you don't" | Organic competitors by keyword overlap, their ranking keywords, top-3 counts and estimated traffic |
| **SERP** (`/serp`) | **Benchmark:** paste ranking URLs and compare their word count, structure, schema and scores with your page | Live Google results (desktop or mobile, top 20), SERP features, AI Overview sources (are you cited?), featured snippet owner, People also ask, related searches. Every check is saved for **rank tracking**, and you can benchmark the top 5 automatically |
| **Backlinks** (`/backlinks`) | n/a (no reliable free source; use Search Console's Links report) | Profile comparison with competitors, link gap (sites linking to competitors but not to you), top referring domains, anchors, newest links |

### Connecting DataForSEO

DataForSEO is pay-as-you-go with no subscription. Roughly: a keyword search makes 3 Labs calls (about $0.05 total), a keyword gap 2 calls per competitor, a live SERP
about $0.004, and backlinks about $0.025 per request. The Backlinks API may need enabling at app.dataforseo.com first. Copy
`.env.example` to `.env.local` and set:

```bash
DATAFORSEO_LOGIN=you@example.com
DATAFORSEO_PASSWORD=your-api-password     # app.dataforseo.com/api-access
RESEARCH_TOKEN=some-secret                # strongly recommended when deployed
```

* Responses are cached in memory for 12 hours, so repeating a lookup is free. Each result shows what it cost.
* With `RESEARCH_TOKEN` set, `/api/research/*` requires it (the UI asks for it once), so a public deployment can't spend your balance.
* `DATAFORSEO_API_URL=https://sandbox.dataforseo.com/v3/` uses DataForSEO's free sandbox (dummy data) for testing.

## Architecture

```
browser ──GET /api/scan?url=──▶ Next.js route (Node)
                                  ├─ fetch page (manual redirects, TTFB, 5 MB cap, SSRF guard)
                                  ├─ robots.txt, llms.txt, sitemaps (+ index children)
                                  └─ 10 crawler-UA probes (headers only)
        ◀── JSON bundle ──────────┘
browser: Rust → WASM engine (wasm/) ── parse · 55+ checks · scoring · plan · generated files ──▶ report
```

* **`wasm/`**: the Rust engine (`metainfo-core`): `extract` (html5ever via `scraper`), `robots`, `sitemap`, `llms`,
  `crawlers`, `checks`, `scoring`, `generate`, `keywords` (on-page topic extraction, plus `term_counts` for the content gap). Compiled with `wasm-pack --target web`. A 1 MB page analyses in about 50–120 ms.
* **`app/api/scan`**: server-side fetcher. Browsers can't fetch other sites because of CORS, so fetching lives here.
* **`app/api/report`**: runs the same WASM engine server-side, for CI and cron tracking.
* **`app/api/research/*`**: keyword, gap, competitor, SERP and backlink endpoints (`lib/server/dataforseo.ts`,
  `lib/server/autocomplete.ts`). They normalise provider data into `lib/research-types.ts`.
* **`components/`, `lib/`**: the UI. Audit history, rank history and the project (site, competitors, market) live in
  `localStorage` (`lib/history.ts`, `lib/rank-history.ts`, `lib/project.ts`).

## Develop

Requires Node 20.9+ and Rust (`rust-toolchain.toml` pins 1.90 with the `wasm32-unknown-unknown` target; rustup installs it
automatically). `wasm-pack` comes in through npm.

```bash
npm install
npm run dev          # builds the engine on first run, then starts Next.js
npm run build:wasm   # rebuild the engine after changing anything in wasm/
npm test             # Rust unit tests
npm run lint         # eslint + clippy
npm run build        # engine + production Next.js build
```

## API (CI / scheduled tracking)

```bash
# Full report
curl "https://your-host/api/report?url=example.com"

# Compact summary; responds 422 if the overall score is below `min` (fail the pipeline)
curl -f "https://your-host/api/report?url=example.com/pricing&format=summary&min=80"
```

## Notes and limits

* Crawler probes send only the user-agent string. CDNs that verify bots by IP may treat the real crawlers differently. If a
  spoofed Googlebot is also rejected, the probe results are marked inconclusive instead of reported as blocks.
* AI crawlers don't execute JavaScript, so content that appears only after JS runs is invisible to them. MetaInfo analyses
  the raw HTML on purpose.
* llms.txt is an emerging convention. No engine has confirmed it as a ranking factor, so it's scored as a medium-weight item.
* The scanner refuses private/loopback addresses. Set `ALLOW_PRIVATE_HOSTS=1` to scan local dev servers.
