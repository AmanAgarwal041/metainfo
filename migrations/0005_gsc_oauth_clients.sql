-- Each workspace brings its own Google OAuth client for Search Console, entered by an admin in Settings.
-- The server's environment is never used for it, so one workspace's client can't be overridden by
-- another's or by a deploy. The secret is AES-GCM sealed (lib/server/gsc.ts) and never sent back to a browser.

CREATE TABLE gsc_oauth_clients (
  org_id TEXT PRIMARY KEY REFERENCES orgs (id) ON DELETE CASCADE,
  -- "<id>.apps.googleusercontent.com": public, shown in Settings.
  client_id TEXT NOT NULL,
  -- "v1.<iv>.<ciphertext>": the client secret, sealed.
  client_secret TEXT NOT NULL,
  -- Clerk user id of the admin who last saved it.
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);
