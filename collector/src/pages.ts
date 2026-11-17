/**
 * MetaInfo traffic collector for Cloudflare Pages, as Pages Functions middleware.
 *
 * Copy core.ts and this file into your project OUTSIDE `functions/` (every file in `functions/` becomes a
 * route), e.g. `lib/metainfo/`, then create `functions/_middleware.ts`:
 *
 *     export { onRequest } from "../lib/metainfo/pages";
 *
 * and set the secrets METAINFO_TOKEN, METAINFO_ORG and METAINFO_SITE from the Traffic page in the Pages project
 * (Settings → Variables and Secrets).
 * Middleware runs for requests that reach Pages Functions; to report every page (static ones too), make sure
 * `_routes.json` doesn't exclude them.
 */

import { createCollector, type Collector } from "./core";

interface Env {
  METAINFO_TOKEN?: string;
  METAINFO_ORG?: string;
  METAINFO_SITE?: string;
  METAINFO_ENDPOINT?: string;
  METAINFO_DISABLED?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
  next(): Promise<Response>;
  waitUntil(promise: Promise<unknown>): void;
}

let collector: Collector | null = null;

export async function onRequest(context: PagesContext): Promise<Response> {
  const response = await context.next();
  const { env } = context;
  if (env.METAINFO_DISABLED !== "1" && env.METAINFO_TOKEN) {
    collector ??= createCollector({ token: env.METAINFO_TOKEN, org: env.METAINFO_ORG, site: env.METAINFO_SITE, endpoint: env.METAINFO_ENDPOINT, via: "cloudflare-pages", batch: true });
    collector.observe(context.request, response.status, (p) => context.waitUntil(p));
  }
  return response;
}
