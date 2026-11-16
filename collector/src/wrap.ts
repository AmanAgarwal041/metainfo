/**
 * MetaInfo traffic collector for a site that is itself a Cloudflare Worker (Workers static assets, Next.js
 * on OpenNext, Astro, Remix, Hono...). A route can only run one worker, so instead of a second worker in
 * front, wrap your own handler:
 *
 *     import { withMetainfo } from "./lib/metainfo/wrap";
 *     export default withMetainfo(handler);   // the object your worker exported before
 *
 * Set the secrets METAINFO_TOKEN, METAINFO_ORG and METAINFO_SITE from the Traffic page (`npx wrangler secret put ...`). Static assets served before
 * your worker runs (Workers assets without `run_worker_first`) aren't seen, but those are files, not pages.
 */

import { createCollector, type Collector } from "./core";

interface Env {
  METAINFO_TOKEN?: string;
  METAINFO_ORG?: string;
  METAINFO_SITE?: string;
  METAINFO_ENDPOINT?: string;
  METAINFO_DISABLED?: string;
}

interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

interface Handler<E, C extends Ctx> {
  fetch?: (request: Request, env: E, ctx: C) => Response | Promise<Response>;
  [key: string]: unknown;
}

export function withMetainfo<E extends Env, C extends Ctx, H extends Handler<E, C>>(handler: H): H {
  const inner = handler.fetch;
  if (!inner) return handler;
  let collector: Collector | null = null;
  return {
    ...handler,
    async fetch(request: Request, env: E, ctx: C): Promise<Response> {
      const response = await inner.call(handler, request, env, ctx);
      if (env.METAINFO_DISABLED !== "1" && env.METAINFO_TOKEN) {
        collector ??= createCollector({ token: env.METAINFO_TOKEN, org: env.METAINFO_ORG, site: env.METAINFO_SITE, endpoint: env.METAINFO_ENDPOINT, via: "cloudflare-worker-wrap", batch: true });
        collector.observe(request, response.status, (p) => ctx.waitUntil(p));
      }
      return response;
    },
  };
}
