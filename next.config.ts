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
        // Baseline hardening for every response. No CSP yet: Clerk and the WASM engine need a tested policy first.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
      {
        source: "/engine/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
