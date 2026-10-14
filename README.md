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

DataForSEO is pay-as-you-go with no subscription. Roughly: a keyword search makes 3 Labs calls (about $0.05 total), a keyword
gap 2 calls per competitor, a live SERP about $0.004, and backlinks about $0.025 per request. The Backlinks API may need enabling
at app.dataforseo.com first, and new accounts must be verified there before the API answers.

There are two ways to provide keys, and they can be combined:

**1. Bring your own keys (any user).** In **Settings → Data source**, enter a DataForSEO API login and API password. They're
saved in that browser only and sent with each research request in the `x-dataforseo-login` / `x-dataforseo-password` headers.
The server uses them for that request only and never stores or logs them. **Test keys** shows the account's balance. API and MCP
callers pass the same headers:

```bash
curl -H "x-dataforseo-login: you@example.com" -H "x-dataforseo-password: $DFS_API_PASSWORD" \
  "https://your-host/api/research/serp?q=invoice+software"
```

**2. Server keys (the owner pays).** Set them as environment variables (`.env.local` locally, `wrangler secret put` on Cloudflare):

```bash
DATAFORSEO_LOGIN=you@example.com
DATAFORSEO_PASSWORD=your-api-password     # app.dataforseo.com/api-access
RESEARCH_TOKEN=some-secret                # strongly recommended when deployed
```

* A request's own keys always take precedence over the server's.
* With `RESEARCH_TOKEN` set, using the **server's** keys requires the token (the UI asks for it once), so a public deployment
  can't spend your balance. Requests that bring their own keys don't need it.
* Responses are cached in memory for 12 hours, **per DataForSEO account**, so repeating a lookup is free and one user's paid
  results are never served to another. Each result shows what it cost.
* `DATAFORSEO_API_URL=https://sandbox.dataforseo.com/v3/` uses DataForSEO's free sandbox (dummy data) for testing.

## Workspace

* **Projects:** each holds a domain, brand name, up to 5 competitors, a market, tracked keywords and AI prompts. The sidebar switcher scopes every page to the active project.
* **Dashboard (`/`):** audit score and trend per platform, AI search readiness, average position and its distribution, AI answer mention rate, next fixes, and a setup checklist.
* **Rank tracking (`/rankings`):** desktop or mobile positions for the project's keywords and competitors, plus whether an AI Overview cites you.
  * Before each run it shows a cost estimate and asks you to confirm.
  * Results include movement, a position distribution, per-keyword history charts and a "by date" matrix for reports.
* **AI visibility (`/ai-visibility`):** sends your prompts to ChatGPT, Claude, Gemini and Perplexity (DataForSEO `ai_optimization/{engine}/llm_responses/live`, with web search) and checks Google AI Overviews.
  * Matching runs in code, with no LLM judge. "Mentioned" is a whole-word match on your brand or domain (URLs masked). "Cited" means a source URL is on your domain. Competitors are scored the same way.
  * Results show mention and citation rates, competitor gaps, cited sources, the full answer with your brand highlighted, and a trend across runs.
  * The free part is AI readiness from your latest audit.
* **Settings (`/settings`):** projects, data source status, MCP connection snippets, theme, and backup export, import and reset.
* **Command palette (⌘K):** jump to any page, audit a URL, research a keyword, check a SERP, switch or create projects, change theme.

## MCP server

`/api/mcp` implements MCP over Streamable HTTP. It's stateless JSON-RPC, protected by `RESEARCH_TOKEN` when that's set.

```bash
claude mcp add --transport http metainfo http://localhost:3000/api/mcp
```

Tools:
* Free: `audit_page`, `validate_schema`, and `keyword_ideas` (ideas only; volumes need DataForSEO).
* Need DataForSEO: `serp_check`, `keyword_gap`, `find_competitors`, `backlinks`, `ask_ai_engine`. These are hidden from the tool list until it's configured.

## Design system

The UI is built as an "operate" surface: dense, scannable, quiet.

* **Color:** OKLCH tokens, with neutrals tinted toward a single cobalt accent. Light and dark are composed separately, not inverted, and you can pick light, dark or system.
* **Type:** Hanken Grotesk for UI text and JetBrains Mono for code. Tables use tabular figures.
* **Layout:** hairline separation instead of shadows, no nested cards, and a bento dashboard with only as many cells as there's data for.
* **Glass:** the only "morphism" is glass on the sticky top bar and the command palette, with a solid fallback under `prefers-reduced-transparency`.
* **Motion:** 120-300ms on `cubic-bezier(0.16, 1, 0.3, 1)`, honoring `prefers-reduced-motion`.
* **Charts:** they use the validated categorical palette, with one fixed color per platform across the app. They have a crosshair tooltip, a legend and a table view. Ordered buckets use a single-hue ramp.
* **Empty states:** a single-stroke figure in the Hairline manner that answers the pointer.

## Site crawl and JavaScript rendering (Scrapling)

An optional companion service in `scraper/` uses [Scrapling](https://github.com/D4Vinci/Scrapling) for two things the Worker
can't do on its own.

* **JavaScript rendering in audits.** The page is rendered in headless Chromium (`DynamicFetcher`), and the Rust engine
  compares the rendered DOM with the raw HTML:
  * the share of words that only appear after JavaScript runs;
  * meta tags rewritten by JavaScript (title, description, canonical, robots, Open Graph);
  * links, headings and JSON-LD that only appear after rendering;
  * client-side (meta refresh or JavaScript) redirects.

  This drives the "Content is in the HTML" check with measured numbers and adds three checks: JS meta, JS links and JS
  structured data. The audit gets a **JS rendering** tab.
* **Site crawl (`/site-audit`).** `Spider` crawls the site server-side: same host, robots.txt obeyed, `<a>` and image-map
  links followed, identified as MetaInfoBot. The WASM engine audits every page in the browser, and the crawl adds site-wide
  findings:
  * broken and redirecting internal links;
  * duplicate titles and descriptions;
  * missing titles, descriptions and H1s;
  * noindex and canonical problems;
  * thin, deep and weakly linked pages;
  * sitemap coverage;
  * "fix once in your template" issues (checks failing on 60% or more of pages).

  Pages the app-shell heuristic suspects are re-rendered to verify them.

Without the service, audits fall back to the heuristic and site crawls run through a built-in crawler (page by page via
`/api/page`, also robots-aware). Both produce the same report.

**Deliberately not used:** Scrapling's anti-bot features (`StealthyFetcher`, Cloudflare challenge solving, TLS and browser
fingerprint impersonation, the fake Google referer). This tool audits other people's sites, so it identifies itself honestly.

```bash
# local
cd scraper && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/scrapling install          # downloads Chromium
.venv/bin/uvicorn app:app --port 8000
# then in .env.local: SCRAPER_URL=http://127.0.0.1:8000

# container (any Docker host: Fly.io, Railway, a VPS, Cloudflare Containers on Workers Paid)
docker build -t metainfo-scraper scraper && docker run -p 8000:8000 -e SCRAPER_TOKEN=secret metainfo-scraper
# then: wrangler secret put SCRAPER_URL / SCRAPER_TOKEN
```

Security: the service rejects private and loopback targets, blocks the browser's own subrequests to private networks, and
requires `x-scraper-token` when `SCRAPER_TOKEN` is set. Run it in a network without access to internal systems anyway.

### Does it help? (measured)

Same engine, raw HTML only (the old heuristic) vs with Scrapling's rendered DOM:

| Page | Heuristic | Measured | What rendering found |
| --- | --- | --- | --- |
| excalidraw.com | fail | fail | 98% of words only after JS |
| app.diagrams.net | fail | fail | 100% of words after JS; title set by JS |
| airbnb.com | **pass** | **fail** | Non-JS clients get an empty JS-only redirect stub; 7 meta tags and JSON-LD only after JS |
| paulgraham.com | **fail** | **pass** | Image-based homepage, nothing hidden (heuristic false positive) |
| htmx.org, react.dev, photopea.com | pass | pass | 0% hidden |
| stripe.com/pricing | pass | pass | 3% hidden |

Renders take 1.2-2.3 s for most pages and up to about 14 s for pages that never go network-idle. Crawls cover 50 pages of
htmx.org in about 3-4 s and 100 pages of paulgraham.com in about 8 s with Scrapling, against 5 s and 9 s with the built-in
crawler. WASM analysis adds about 0.5 s per 100 pages.

## Schema validator

`/schema` validates structured data the way [validator.schema.org](https://validator.schema.org/) does, and adds two checks it doesn't do. You can give it a URL or paste a snippet. The validator also runs on every page audit (the **Schema** tab), on every crawled page, as `GET`/`POST /api/schema`, and as the `validate_schema` MCP tool. It's all Rust/WASM (`wasm/src/schema.rs`).

* **Extraction.** Reads JSON-LD (including `@graph` and `@id` references), Microdata and RDFa. RDFa counts only when it uses the schema.org vocabulary, so MediaWiki's `mw:` annotations aren't reported as items. Each item is shown as a tree, with every issue next to the property it belongs to.
* **schema.org rules.** These cover:
  * unknown types and properties, with "Did you mean…" suggestions;
  * a property used as a type;
  * properties used on the wrong type;
  * values that aren't a valid Date, DateTime, Time, URL, Number, Integer, Boolean or Duration (including impossible dates like 2025-13-45);
  * invalid enumeration values (for example `"availability": "in stock"`);
  * superseded terms;
  * a missing `@context` or `@type`.

  The vocabulary is the full schema.org release (30.1: 939 types, 1,538 properties and 546 enumeration values), compiled by `node scripts/build-schema-vocab.mjs [version]` into `wasm/src/schema_vocab.json`. Severities follow validator.schema.org.
* **Google rich results.** Required and recommended properties per Google's docs for Article, Breadcrumb, Product, Product variants, Review, Recipe, Event, Job posting, Local business, Organization, Video, Software app, Course, Dataset, Discussion forum and Profile page. FAQ and How-to are marked as limited or retired.
* **Visible-content check.** Google requires markup to describe content people can see. Names, headlines, prices and ratings are checked against the page text, allowing for number formats and rounded ratings.

When the Scrapling service is configured, URLs are validated as rendered, which is what Google sees. A notice says how many items exist only after JavaScript runs. Sites that block plain requests (HTTP 403) are still validated through the browser.

**Compared with validator.schema.org.** I checked 12 live pages and a 12-case edge-case snippet against the official validator. Detected types and errors matched, except in these cases:
* **GitHub.** Its repository pages use `itemType="https://schema.org/abstract"`. `abstract` is a property, not a type; MetaInfo reports the error and the official validator misses it.
* **Missing `@context`.** The official validator silently drops a block without `@context`; MetaInfo reports it.
* **Blocked pages.** allrecipes and seriouseats answer HTTP 403 to plain requests; through the renderer, their Recipe markup is validated.

## Accounts and teams (optional)

Every tool works without signing in. Signing in saves your workspace to an account, syncs it across devices, and shares it with a team. The workspace is your projects, scan history and tracking, rank checks, crawls and AI-visibility runs. The design follows socialbrewery's auth:

* **Sign-in.** Google (OIDC with PKCE) or GitHub OAuth, with no passwords. Accounts with the same verified email are merged. The first sign-in creates an organisation.
* **Sessions.** A random token in an HttpOnly, SameSite=Lax cookie (`mi_session`, 30 days). Only its SHA-256 hash is stored. State-changing requests must come from the same origin.
* **Organisations.** Roles are owner, admin and member. Admins invite people with a link, which only the invited email can accept and which expires after 14 days. Every organisation keeps at least one owner. You can belong to several organisations and switch between them from the account menu.
* **Saving progress.** On first sign-in, work done anonymously in that browser is merged into the account. After that, changes sync a moment after they happen. Each item carries a version number, so concurrent edits on two devices are merged instead of overwritten. Switching organisation swaps in that organisation's workspace. Signing out clears the browser copy.
* **Never uploaded:** DataForSEO keys, the research token and the theme.

Storage is Cloudflare D1 (`migrations/`). To set it up:

```bash
npx wrangler d1 migrations apply metainfo --remote      # --local for next dev
npx wrangler secret put APP_URL                          # e.g. https://metainfo.example.com
npx wrangler secret put GOOGLE_AUTH_CLIENT_ID            # and _SECRET; and/or GITHUB_AUTH_CLIENT_ID/_SECRET
```

OAuth callback URLs are `${APP_URL}/auth/google/callback` and `${APP_URL}/auth/github/callback`. For local development, `AUTH_DEV_LOGIN=1 npm run dev` adds a test sign-in, which is ignored in production. With no provider configured, the sign-in button doesn't appear.

## AI citation readiness (GEO)

The **AI citations** report tab and its checks are deterministic ports of four open-source SEO skills: geo-seo-claude's passage citability scorer, claude-seo's content-quality, claim and drift checks, marketingskills' seo-audit checklist and firecrawl's seo-audit report structure. They run in the WASM engine; no LLM is involved.

* **Passage citability.** The main content is split at headings. Each prose section is scored out of 100: answer quality 30, self-containment 25, readability 20, statistics and sources 15, originality 10. The page grade (A ≥80 … D ≥35) is the mean of the five best sections, and the weakest sections get specific rewrite reasons. Lists, ingredient blocks, pricing cards and "See also" sections aren't scored.
* **Answer-first.** Every question heading should be followed by a direct answer (40–60 words is ideal), and a definition early in the page helps.
* **Claims and sources.** Statistics and research claims should have a link or attribution in the same paragraph.
* **Phrasing.** Filler and stock AI phrases are counted per 1,000 words.
* **Freshness.** Age tiers: under 3 months, 6 months, 1 year and 2 years. Also flagged: a year in the title older than the current year, and time-relative words.
* **Trust and entity graph.** About, contact, privacy and terms links (policies on a parent domain count), author schema, `sameAs` profiles, `@id` references and `knowsAbout`.
* **GEO score.** Uses claude-seo's weights: citability 25, structure 20, multi-modal 15, authority 20, technical access 20.
* **Also new:** soft-404 detection (a made-up URL must return 404), security headers, markdown content negotiation for agents, and drift alerts between scans (title, H1 or canonical changed; noindex added; schema types removed; H2 outline changed; GEO score down 10 or more).

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

## Deploy to Cloudflare Workers

The app deploys to Cloudflare Workers with [OpenNext](https://opennext.js.org/cloudflare) (`@opennextjs/cloudflare`).
Everything runs on Workers, including the server-side Rust/WASM engine used by `/api/report` and the MCP `audit_page` tool.

```bash
npx wrangler login                 # once
npm run build:wasm                 # the engine (needs Rust + wasm-pack locally)
npm run preview                    # build and run the Worker locally in workerd (http://localhost:8787)
npm run deploy                     # build and deploy

# optional server keys (otherwise users bring their own in Settings)
npx wrangler secret put DATAFORSEO_LOGIN
npx wrangler secret put DATAFORSEO_PASSWORD
npx wrangler secret put RESEARCH_TOKEN
```

* Config lives in `wrangler.jsonc` (Worker name `metainfo`) and `open-next.config.ts`.
* `global_fetch_strictly_public` keeps the scanner on the public internet, which is the SSRF guard on Workers.
* OpenNext copies local `.env*` values into the Worker bundle; `scripts/cf-sanitize-env.mjs` (part of `npm run cf:build`) strips
  everything except `NEXT_PUBLIC_*`, so credentials from a local `.env` never ship. Use `wrangler secret put` for production keys.
* The Worker is about 1.8 MB gzipped, under the 3 MB Workers Free limit.
* Browser history (projects, audits, rank checks, AI runs) is still per browser, as with the Node deployment.

## API (CI / scheduled tracking)

```bash
# Full report
curl "https://your-host/api/report?url=example.com"

# Compact summary; responds 422 if the overall score is below `min` (fail the pipeline)
curl -f "https://your-host/api/report?url=example.com/pricing&format=summary&min=80"

# Structured data: a live page (raw HTML, plus the rendered DOM when the scraper is configured)
curl "https://your-host/api/schema?url=example.com/product"

# ...or a file or snippet
curl --data-binary @page.html "https://your-host/api/schema"
```

## Notes and limits

* Crawler probes send only the user-agent string. CDNs that verify bots by IP may treat the real crawlers differently. If a
  spoofed Googlebot is also rejected, the probe results are marked inconclusive instead of reported as blocks.
* AI crawlers don't execute JavaScript, so content that appears only after JS runs is invisible to them. MetaInfo analyses
  the raw HTML on purpose.
* llms.txt is an emerging convention. No engine has confirmed it as a ranking factor, so it's scored as a medium-weight item.
* The scanner refuses private/loopback addresses. Set `ALLOW_PRIVATE_HOSTS=1` to scan local dev servers.
