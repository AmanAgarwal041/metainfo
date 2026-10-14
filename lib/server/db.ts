// The D1 database (accounts, organisations, synced workspaces). Available on
// Cloudflare and in `next dev` (OpenNext's dev proxy runs a local D1 under
// .wrangler/state). Everything that uses it is optional: without a DB the app
// runs anonymous-only, exactly as before.

import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function getDb(): Promise<D1Database | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env.DB ?? null;
  } catch {
    return null;
  }
}
