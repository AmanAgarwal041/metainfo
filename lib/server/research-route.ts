import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { locationByCode, type Location } from "@/lib/research-types";
import { dataForSeoConfigured, ProviderError } from "./dataforseo";

export class BadRequest extends Error {}

/**
 * Wraps a research route: enforces the optional RESEARCH_TOKEN (so a public
 * deployment can't spend your DataForSEO balance) and turns errors into JSON.
 */
export function researchRoute(fn: (req: NextRequest, ctx: { location: Location }) => Promise<unknown>) {
  return async (req: NextRequest) => {
    const required = process.env.RESEARCH_TOKEN;
    if (required) {
      const given = Buffer.from(req.headers.get("x-research-token") ?? "");
      const want = Buffer.from(required);
      if (given.length !== want.length || !timingSafeEqual(given, want)) {
        return NextResponse.json({ error: "This server needs an access token for research features.", code: "token" }, { status: 401 });
      }
    }
    try {
      const location = locationByCode(Number(req.nextUrl.searchParams.get("loc") ?? 2840));
      const body = await fn(req, { location });
      return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
    } catch (e) {
      if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e instanceof ProviderError) {
        return NextResponse.json({ error: e.message, code: e.status === 501 ? "not-configured" : e.code }, { status: e.status });
      }
      console.error(e);
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  };
}

export function requireProvider() {
  if (!dataForSeoConfigured()) throw new ProviderError("This feature needs DataForSEO credentials.", 501);
}

export function param(req: NextRequest, name: string, required = true): string {
  const v = req.nextUrl.searchParams.get(name)?.trim() ?? "";
  if (required && !v) throw new BadRequest(`Missing ?${name}=`);
  return v;
}
