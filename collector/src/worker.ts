/**
 * MetaInfo traffic collector as a Cloudflare Worker route in front of any site whose DNS is proxied by
 * Cloudflare (orange cloud), wherever the site itself is hosted: Vercel, AWS, a VPS, WordPress hosting, or
 * Cloudflare Pages itself (add the route on the Pages project's custom domain; the worker runs before Pages).
 *
 * It passes every request to your origin untouched and reports page loads to MetaInfo in the background.
 * If this worker ever throws, Cloudflare sends the request straight to your origin.
 *
 * Three secrets from MetaInfo's Traffic page route the events to the right workspace and site (`npx wrangler secret put ...`):
 *   METAINFO_TOKEN     the site's collector token (mtr_...)
 *   METAINFO_ORG       the workspace id (org_... or user_...)
 *   METAINFO_SITE      the site's URL, e.g. https://example.com
 *   METAINFO_ENDPOINT  optional: a self-hosted MetaInfo's ingest URL (https://your-metainfo/api/traffic/events)
 *   METAINFO_DISABLED  optional kill switch: `1` and nothing is reported
 */

import { createCollector, type Collector } from "./core";

export interface Env {
  METAINFO_TOKEN?: string;
  METAINFO_ORG?: string;
  METAINFO_SITE?: string;
  METAINFO_ENDPOINT?: string;
  METAINFO_DISABLED?: string;
}

interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

let collector: Collector | null = null;
let configuredFor = "";

function collectorFor(env: Env): Collector {
  const key = `${env.METAINFO_TOKEN}|${env.METAINFO_ORG}|${env.METAINFO_SITE}|${env.METAINFO_ENDPOINT}`;
  if (!collector || key !== configuredFor) {
    collector = createCollector({ token: env.METAINFO_TOKEN, org: env.METAINFO_ORG, site: env.METAINFO_SITE, endpoint: env.METAINFO_ENDPOINT, via: "cloudflare-worker", batch: true });
    configuredFor = key;
  }
  return collector;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    ctx.passThroughOnException();
    if (env.METAINFO_DISABLED === "1" || !env.METAINFO_TOKEN) return fetch(request);
    const response = await fetch(request);
    collectorFor(env).observe(request, response.status, (p) => ctx.waitUntil(p));
    return response;
  },
};

export default worker;
