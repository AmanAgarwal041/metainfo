import { NextResponse } from "next/server";
import { dataForSeoConfigured } from "@/lib/server/dataforseo";
import type { ResearchStatus } from "@/lib/research-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const body: ResearchStatus = { dataforseo: dataForSeoConfigured(), tokenRequired: Boolean(process.env.RESEARCH_TOKEN) };
  return NextResponse.json(body);
}
