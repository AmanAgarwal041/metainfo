// OpenNext copies the values of every local .env* file into the Worker bundle.
// Strip everything except NEXT_PUBLIC_* so credentials from a developer's
// .env never ship inside deployed code. Production secrets belong in
// `wrangler secret put` (OpenNext exposes them on process.env at runtime).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const keep = (k) => k.startsWith("NEXT_PUBLIC_") || k === "NEXTJS_ENV";
const removed = new Set();

const envModule = `${root}/.open-next/cloudflare/next-env.mjs`;
if (existsSync(envModule)) {
  const out = readFileSync(envModule, "utf8").replace(/^export const (\w+) = (.*);$/gm, (_, mode, json) => {
    const vars = JSON.parse(json);
    for (const k of Object.keys(vars)) {
      if (keep(k)) continue;
      removed.add(k);
      delete vars[k];
    }
    return `export const ${mode} = ${JSON.stringify(vars)};`;
  });
  writeFileSync(envModule, out);
}

// The server function also gets a raw copy of .env; the Worker doesn't need it.
const rawEnv = `${root}/.open-next/server-functions/default/.env`;
if (existsSync(rawEnv)) {
  const lines = readFileSync(rawEnv, "utf8").split("\n");
  writeFileSync(
    rawEnv,
    lines
      .filter((l) => {
        const k = l.match(/^\s*([\w.]+)\s*=/)?.[1];
        if (k && !keep(k)) removed.add(k);
        return !k || keep(k);
      })
      .join("\n"),
  );
}

console.log(removed.size ? `Removed from the Worker bundle: ${[...removed].join(", ")} (set them with wrangler secret put)` : "No server-side env vars to remove.");
