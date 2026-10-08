import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", ".open-next/**", ".wrangler/**", "wasm/**", "public/engine/**", "next-env.d.ts", "cloudflare-env.d.ts"] },
];

export default config;
