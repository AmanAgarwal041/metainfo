/**
 * MetaInfo traffic collector for Next.js (Vercel, Netlify, Cloudflare via next-on-pages, self-hosted), from
 * `proxy.ts` (`middleware.ts` before Next.js 16). Copy core.ts and this file into your project, e.g.
 * `lib/metainfo/`, then:
 *
 *     // proxy.ts (or middleware.ts)
 *     import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
 *     import { reportToMetainfo } from "./lib/metainfo/next";
 *
 *     export function proxy(request: NextRequest, event: NextFetchEvent) {
 *       return reportToMetainfo(request, event, NextResponse.next());
 *     }
 *
 *     export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
 *
 * and set METAINFO_TOKEN, METAINFO_ORG and METAINFO_SITE in the environment (all three are on the Traffic page).
 * In an existing proxy, wrap each response it returns: `return reportToMetainfo(request, event, response)`.
 *
 * A response the proxy answers itself (a redirect, a 404, a page it serves) is reported with its status. When
 * the proxy passes the request on (`NextResponse.next()`, a rewrite), the page hasn't rendered yet, so its
 * status isn't known: those events carry status 0. Each event is sent on its own (serverless instances
 * don't live long enough to batch).
 */

import { createCollector, type Collector } from "./core";

declare const process: { env: Record<string, string | undefined> };

let collector: Collector | null = null;

/** The status the visitor will get, when the proxy decided it; 0 when the app still has to render the page. */
function finalStatus(response: Response | undefined): number {
  if (!response) return 0;
  const h = response.headers;
  if (h.has("x-middleware-next") || h.has("x-middleware-rewrite")) return 0;
  return response.status;
}

export function reportToMetainfo<R extends Response | undefined>(request: Request, event: { waitUntil(promise: Promise<unknown>): void }, response?: R): R {
  try {
    if (process.env.METAINFO_DISABLED !== "1") {
      collector ??= createCollector({
        token: process.env.METAINFO_TOKEN,
        org: process.env.METAINFO_ORG,
        site: process.env.METAINFO_SITE,
        endpoint: process.env.METAINFO_ENDPOINT,
        via: "next",
        batch: false,
      });
      collector.observe(request, finalStatus(response), (p) => event.waitUntil(p));
    }
  } catch {
    /* reporting never breaks a request */
  }
  return response as R;
}
