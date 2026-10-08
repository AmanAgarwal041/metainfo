import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No ISR or data cache is used (pages are static or fully dynamic), so the
// default in-memory incremental cache is enough.
export default defineCloudflareConfig({});
