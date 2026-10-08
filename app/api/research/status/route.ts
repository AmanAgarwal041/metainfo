import { NextResponse } from "next/server";
import { serverHasCredentials } from "@/lib/server/credentials";
import type { ResearchStatus } from "@/lib/research-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the server provides. Browsers with their own keys merge that in client-side. */
export async function GET() {
  const body: ResearchStatus = { dataforseo: serverHasCredentials(), tokenRequired: Boolean(process.env.RESEARCH_TOKEN) };
  return NextResponse.json(body);
}
