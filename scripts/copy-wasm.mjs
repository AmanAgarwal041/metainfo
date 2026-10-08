// Publish the engine binary so the browser can fetch + stream-compile it, and
// strip the glue's `new URL("metainfo_bg.wasm", import.meta.url)` fallback:
// callers always pass the module or path explicitly, and that reference makes
// bundlers emit a second copy of the WASM (which doubled the Cloudflare
// Worker bundle).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/public/engine`, { recursive: true });
copyFileSync(`${root}/wasm/pkg/metainfo_bg.wasm`, `${root}/public/engine/metainfo_bg.wasm`);

const gluePath = `${root}/wasm/pkg/metainfo.js`;
const glue = readFileSync(gluePath, "utf8");
const fallback = "module_or_path = new URL('metainfo_bg.wasm', import.meta.url);";
if (glue.includes(fallback)) {
  writeFileSync(gluePath, glue.replace(fallback, `throw new Error("metainfo: pass the WASM module or URL to init()");`));
}
console.log("Copied engine to public/engine/metainfo_bg.wasm");
