// Runs the same Rust/WASM engine server-side, for the JSON API (CI checks,
// cron-based tracking): the browser UI runs it client-side instead.

import fs from "node:fs/promises";
import path from "node:path";
import * as engine from "@/wasm/pkg/metainfo.js";
import type { Report, ScanInput } from "@/lib/types";

let ready: Promise<void> | null = null;

function init() {
  ready ??= fs
    .readFile(path.join(process.cwd(), "public/engine/metainfo_bg.wasm"))
    .then((buf) => {
      engine.initSync({ module: buf });
    });
  return ready;
}

export async function analyzeOnServer(input: ScanInput): Promise<Report> {
  await init();
  const out = JSON.parse(engine.analyze(JSON.stringify(input)));
  if (out.error) throw new Error(out.error);
  return out as Report;
}
