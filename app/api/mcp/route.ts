// MCP server (Streamable HTTP transport, stateless, JSON responses).
// Connect from Claude Code with:
//   claude mcp add --transport http metainfo http://localhost:3000/api/mcp [--header "Authorization: Bearer $RESEARCH_TOKEN"]

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dataForSeoConfigured } from "@/lib/server/dataforseo";
import { TOOLS } from "@/lib/server/mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function authorized(req: NextRequest): boolean {
  const required = process.env.RESEARCH_TOKEN;
  if (!required) return true;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || req.headers.get("x-research-token") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(required);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(msg: RpcRequest): Promise<object | null> {
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok(msg.id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "metainfo", title: "MetaInfo SEO & AI visibility", version: "0.3.0" },
        instructions:
          "SEO and AI-visibility tools. audit_page is free and works on any public URL. Tools marked as needing DataForSEO spend the server owner's credit; prefer audit_page and keyword_ideas unless volumes, rankings or backlinks are needed.",
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list": {
      const live = dataForSeoConfigured();
      return ok(msg.id, {
        tools: TOOLS.filter((t) => live || !t.paid || t.name === "keyword_ideas").map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })),
      });
    }
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${String(msg.params?.name)}`);
      try {
        const result = await tool.run((msg.params?.arguments ?? {}) as Record<string, unknown>);
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(result) }], isError: false });
      } catch (e) {
        // Tool failures are results, not protocol errors, so the model can read and react to them.
        return ok(msg.id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      if (isNotification) return null;
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json(fail(null, -32001, "Unauthorized: send Authorization: Bearer <RESEARCH_TOKEN>"), { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(fail(null, -32700, "Parse error"), { status: 400 });
  }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as RpcRequest[];
  const responses = (await Promise.all(msgs.map(handle))).filter((r) => r !== null);
  if (responses.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(batch ? responses : responses[0]);
}

export async function GET() {
  // No server-initiated stream: this server is stateless request/response only.
  return new NextResponse(null, { status: 405, headers: { allow: "POST" } });
}
