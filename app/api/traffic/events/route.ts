import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { MAX_BODY_BYTES, ingest, routeCollector } from "@/lib/server/traffic";

export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * POST /api/traffic/events: what a collector (collector/) reports, as NDJSON, one page load per line.
 * Routed by three headers that must all agree: `Authorization: Bearer mtr_...` (the site's collector token),
 * `x-metainfo-org` (the workspace id) and `x-metainfo-site` (the site URL). `x-metainfo-collector` says which
 * adapter sent it. Server to server: no cookies, no CORS. Answers 202 { accepted, rejected, reasons }.
 */
export async function POST(req: NextRequest) {
  const db = await getDb();
  if (!db) return json({ error: "This server has no database, so it can't collect traffic." }, 503);
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  const route = await routeCollector(db, token, req.headers.get("x-metainfo-org")?.trim() ?? "", req.headers.get("x-metainfo-site")?.trim() ?? "");
  if (!route.ok) return json({ error: route.error }, route.status);
  const { site } = route;

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return json({ error: `Send at most ${MAX_BODY_BYTES / 1024 / 1024} MB per request.` }, 413);
  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) return json({ error: `Send at most ${MAX_BODY_BYTES / 1024 / 1024} MB per request.` }, 413);

  try {
    const result = await ingest(db, site, body, req.headers.get("x-metainfo-collector"));
    return json(result, 202);
  } catch (e) {
    console.error("Traffic ingest failed", e);
    // 503 tells the collector to keep the batch and retry it.
    return json({ error: "Couldn't store these events right now." }, 503);
  }
}
