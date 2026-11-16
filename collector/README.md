# MetaInfo traffic collector

Reports page loads on your site (people, AI crawlers, search engines and other bots) to MetaInfo's **Traffic** page, so you
see which crawlers actually read your pages, which ones get errors, and who clicks through from ChatGPT, Perplexity, Claude,
Gemini or Copilot.

**What it does:**

- **It never gets in the way.** The response is never changed or delayed. Events go out in the background
  (`waitUntil`), every call has a timeout, and the collector never throws. The Cloudflare Worker route also sets
  `passThroughOnException`, so if it fails, your origin answers as if it weren't there.
- **It reports only page loads.** These are skipped:
  - static files;
  - a page's sub-requests (images, scripts, `fetch()`/XHR);
  - prefetches and Next.js client navigations;
  - JSON API calls;
  - MetaInfo's own audit probes, which send `x-metainfo-probe: 1`.
- **It sends only what it needs.** An event holds:
  - time, method, host, path and status;
  - the user agent;
  - the referer's origin and path;
  - `utm_source`;
  - the `Sec-Fetch-Mode` and `Signature-Agent` headers.

  Never an IP address, a cookie, any other query parameter or any other header. MetaInfo works out who each visitor was
  (`lib/traffic.ts`) and stores only hourly counts per crawler, page and status. Nothing about an individual visitor is kept.
- **It has a kill switch.** Set `METAINFO_DISABLED=1` and it only passes traffic through.

## The three secrets

Every collector is configured with three values from MetaInfo's Traffic page (signed in, one site per project):

| Secret | Example | What it does |
|---|---|---|
| `METAINFO_TOKEN` | `mtr_3f…` | The site's collector token. Shown once; only its hash is stored. Can report traffic, can't read anything. |
| `METAINFO_ORG` | `org_2x…` (`user_…` for a personal workspace) | The workspace (organisation) the site belongs to. |
| `METAINFO_SITE` | `https://example.com` | The site. Only requests to this host and its subdomains are reported. |

MetaInfo accepts a batch only when all three agree: the token must belong to that workspace and to that site.
One workspace can have many sites, and one person can be in many workspaces. Data always lands in the right
place, and a token pasted into the wrong site's config is refused with a clear error. A collector missing any of
the three reports nothing and logs a warning.

## Pick an adapter

| Your site | Use | Sees status codes |
|---|---|---|
| DNS proxied by Cloudflare (orange cloud), hosted **anywhere** | `src/worker.ts` as a Worker route | ✅ |
| Cloudflare Pages | `src/pages.ts` as Pages Functions middleware | ✅ |
| The site is itself a Cloudflare Worker (OpenNext, Astro, Remix, Hono, Workers assets) | `src/wrap.ts` around your handler | ✅ |
| Next.js on Vercel, Netlify, Cloudflare (next-on-pages) or self-hosted | `src/next.ts` from `proxy.ts` / `middleware.ts` | Only for responses the proxy sends itself; rendered pages report status 0 |
| Anything else with `Request` and `waitUntil` (Deno, Netlify Edge, Bun...) | `src/core.ts`: `createCollector(...).observe(request, status, waitUntil)` | ✅ |

`core.ts` has no dependencies. Every adapter is one small file next to it.

### Cloudflare Worker route (any host)

```bash
git clone --depth 1 https://github.com/AmanAgarwal041/metainfo.git && cd metainfo/collector
npm install
npx wrangler deploy
npx wrangler secret put METAINFO_TOKEN     # mtr_...
npx wrangler secret put METAINFO_ORG       # org_... / user_...
npx wrangler secret put METAINFO_SITE      # https://example.com
```

Or use the one-click button:
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/AmanAgarwal041/metainfo/tree/main/collector)

Then, in the Cloudflare dashboard, go to Workers & Pages → **metainfo-collector** → Settings → Domains & Routes and add the
route `example.com/*` (plus `www.example.com/*` if you use it). The worker forwards every request to your origin untouched.

### Cloudflare Pages

Copy `core.ts` and `pages.ts` **outside** `functions/`, because every file in `functions/` becomes a route:

```bash
mkdir -p lib/metainfo && cd lib/metainfo
curl -fsSLO "https://raw.githubusercontent.com/AmanAgarwal041/metainfo/main/collector/src/{core,pages}.ts"
```

```ts
// functions/_middleware.ts
export { onRequest } from "../lib/metainfo/pages";
```

Add the three secrets (Settings → Variables and Secrets) and redeploy. The middleware only runs for requests
that reach Pages Functions, so check that `_routes.json` doesn't exclude your pages.

### A site that is a Worker

A route runs only one worker, so wrap your own handler instead of adding a second worker in front of it:

```ts
import { withMetainfo } from "./lib/metainfo/wrap";

export default withMetainfo({
  async fetch(request, env, ctx) {
    /* your handler */
  },
});
```

For OpenNext, wrap the handler it generates in a small custom worker entry.

### Next.js

```ts
// proxy.ts (middleware.ts before Next.js 16)
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { reportToMetainfo } from "./lib/metainfo/next";

export function proxy(request: NextRequest, event: NextFetchEvent) {
  return reportToMetainfo(request, event, NextResponse.next());
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

In an existing proxy, wrap each response it returns: `return reportToMetainfo(request, event, response)`. Then set
`METAINFO_TOKEN`, `METAINFO_ORG` and `METAINFO_SITE` in the environment.

## Configuration

| Variable | |
|---|---|
| `METAINFO_TOKEN` | **secret**: the site's collector token |
| `METAINFO_ORG` | **secret**: the workspace id |
| `METAINFO_SITE` | **secret**: the site's URL |
| `METAINFO_ENDPOINT` | optional: a self-hosted MetaInfo's `https://…/api/traffic/events` (default: the hosted MetaInfo) |
| `METAINFO_DISABLED` | optional kill switch: `1` and nothing is reported |

Check that it works by pretending to be a crawler, then refreshing the Traffic page:

```bash
curl -s -o /dev/null -A "Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)" https://example.com/
```

On Workers and Pages, events are batched per instance and sent at 500 events, or 5 seconds after the first one. If
MetaInfo answers 429 or 5xx, or can't be reached, the batch is kept and retried with the next one (up to 2000 events).
Serverless adapters such as the Next.js one send each event on its own.

## Protocol v1

`POST {endpoint}` with these headers:
- `Authorization: Bearer mtr_…`
- `x-metainfo-org: <workspace id>`
- `x-metainfo-site: <site URL>`
- `Content-Type: application/x-ndjson`
- `x-metainfo-collector: <adapter>`

A missing value is answered with 400, an unknown token with 401, and a token whose workspace or site doesn't match with 403. The body has one JSON object per line (`CollectorEvent` in `src/core.ts`). The answer
is `202 { accepted, rejected, reasons }`. MetaInfo refuses these events:
- a host that isn't the project's domain or one of its subdomains;
- anything other than `GET` or `HEAD`;
- a timestamp more than 48 hours old.

## Develop

```bash
npm test          # node:test, no install needed (Node 22+)
npm run typecheck
cp .dev.vars.example .dev.vars   # fill in the three values
npx wrangler dev
```
