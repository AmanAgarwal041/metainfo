// Runs the same Rust/WASM engine server-side, for the JSON API (CI checks,
// cron-based tracking) and MCP tools; the browser UI runs it client-side.
//
// The `?module` import yields a compiled WebAssembly.Module. Turbopack loads
// it from disk under Node, and the Cloudflare (OpenNext) build rewrites it to
// a static Workers WASM import, since Workers can't compile WASM from bytes
// at runtime.

import wasmModule from "@/wasm/pkg/metainfo_bg.wasm?module";
import * as engine from "@/wasm/pkg/metainfo.js";
import type { Report, ScanInput } from "@/lib/types";

let ready = false;

function init() {
  if (!ready) {
    engine.initSync({ module: wasmModule });
    ready = true;
  }
}

export async function analyzeOnServer(input: ScanInput): Promise<Report> {
  init();
  const out = JSON.parse(engine.analyze(JSON.stringify(input)));
  if (out.error) throw new Error(out.error);
  return out as Report;
}
