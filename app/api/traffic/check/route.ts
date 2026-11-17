import { NextRequest, NextResponse } from "next/server";
import { handle, requireWorkspace } from "@/lib/server/auth/session";
import { projectOf } from "@/lib/server/traffic";

export const dynamic = "force-dynamic";

/** The user agent of the test visit: reported as an "other bot" page load, so it shows the collector works. */
const CHECK_UA = "MetaInfoCheckBot/1.0 (+https://github.com/AmanAgarwal041/metainfo)";

/**
 * POST { projectId } → loads the project's home page once, the way a visitor would (without the probe header the
 * audits send, so the collector counts it). The Traffic page then waits for that page load to arrive.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const s = await requireWorkspace(req);
    const body = (await req.json().catch(() => null)) as { projectId?: unknown } | null;
    const p = await projectOf(s, body?.projectId);
    try {
      const res = await fetch(`https://${p.domain}/`, { headers: { "user-agent": CHECK_UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
      await res.body?.cancel();
      return NextResponse.json({ ok: true, status: res.status, url: res.url });
    } catch {
      return NextResponse.json({ ok: false, error: `Couldn't load https://${p.domain}/.` });
    }
  });
}
