// `npm run dev` convenience: build the Rust engine once if it hasn't been built yet.
// Run `npm run build:wasm` yourself after changing anything under wasm/.
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
if (!existsSync(`${root}/wasm/pkg/metainfo.js`) || !existsSync(`${root}/public/engine/metainfo_bg.wasm`)) {
  console.log("Engine not built yet — running build:wasm (first build takes a couple of minutes)…");
  execSync("npm run build:wasm", { stdio: "inherit", cwd: root });
}
