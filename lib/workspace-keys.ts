// Which browser-storage keys make up a workspace (synced to the organisation
// when signed in). Secrets (DataForSEO keys, the research token) and
// per-device preferences (theme) never leave the browser.

const SYNCED = [/^metainfo:projects:v2$/, /^metainfo:sites:v1$/, /^metainfo:ranks:v1$/, /^metainfo:ai-runs:[\w-]{1,64}$/, /^metainfo:crawls:[\w-]{1,64}$/];

export const isSyncedKey = (key: string) => SYNCED.some((r) => r.test(key));

/** D1 rows top out at 2 MB; leave headroom. */
export const MAX_VALUE_BYTES = 1_500_000;
export const MAX_KEYS = 400;
