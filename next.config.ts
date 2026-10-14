import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Gives `next dev` the Worker's bindings (a local D1 under .wrangler/state) so
// accounts and sync work locally. Apply schema changes with
// `npx wrangler d1 migrations apply metainfo --local`.
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Turbopack's server WASM loader traces files with a very broad pattern,
  // which drags Next's unused OG-image library (and its WASM and fonts) into
  // the Cloudflare Worker bundle. We never generate OG images.
  outputFileTracingExcludes: {
    "*": ["node_modules/next/dist/compiled/@vercel/og/**"],
  },
  async headers() {
    return [
      {
        source: "/engine/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
