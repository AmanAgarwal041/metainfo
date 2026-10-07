// Publish the engine binary so the browser can fetch + stream-compile it.
import { mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/public/engine`, { recursive: true });
copyFileSync(`${root}/wasm/pkg/metainfo_bg.wasm`, `${root}/public/engine/metainfo_bg.wasm`);
console.log("Copied engine to public/engine/metainfo_bg.wasm");
