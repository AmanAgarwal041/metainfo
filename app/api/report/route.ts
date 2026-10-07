import { NextRequest, NextResponse } from "next/server";
import { buildBundle, ScanError } from "@/lib/server/fetch-bundle";
import { analyzeOnServer } from "@/lib/server/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/report?url=…[&format=summary][&min=80]
 *
 * Full scan + analysis on the server, for CI pipelines and scheduled tracking.
 * With `min`, responds 422 when the overall score is below the threshold so a
 * CI step can fail the build.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const url = params.get("url");
  if (!url) return NextResponse.json({ error: "Missing ?url=" }, { status: 400 });
  try {
    const t0 = performance.now();
    const bundle = await buildBundle(url);
    const report = await analyzeOnServer(bundle);
    const analyzeMs = Math.round(performance.now() - t0) - (bundle.fetchMs ?? 0);
    const min = params.get("min") ? Number(params.get("min")) : null;
    const below = min !== null && report.summary.overall < min;

    const body =
      params.get("format") === "summary"
        ? {
            url: report.finalUrl,
            scannedAt: new Date().toISOString(),
            summary: report.summary,
            scores: Object.fromEntries(report.scores.map((s) => [s.platform, s.score])),
            failing: report.checks
              .filter((c) => c.status === "fail" || c.status === "warn")
              .map((c) => ({ id: c.id, status: c.status, severity: c.severity, title: c.title, finding: c.finding })),
            fetchMs: bundle.fetchMs,
            analyzeMs,
          }
        : report;
    return NextResponse.json(body, { status: below ? 422 : 200, headers: { "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof ScanError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
