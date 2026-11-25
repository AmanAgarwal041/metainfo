-- Google Search Console, connected once per workspace. An admin signs in with
-- Google; the refresh token is stored AES-GCM sealed (lib/server/gsc.ts) and
-- never leaves the server. Every member reads reports through it.

CREATE TABLE gsc_connections (
  org_id TEXT PRIMARY KEY REFERENCES orgs (id) ON DELETE CASCADE,
  -- "v1.<iv>.<ciphertext>": the refresh token sealed with a key derived from GSC_COOKIE_SECRET / GOOGLE_CLIENT_SECRET.
  refresh_token TEXT NOT NULL,
  -- The Google account that granted access (from the id_token), for display.
  email TEXT,
  -- Clerk user id of the admin who connected it.
  connected_by TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  -- Set when Google refuses the token (revoked or expired grant): the UI asks an admin to reconnect.
  last_error TEXT
);

-- The Search Console property each project uses, so the whole team sees the same one.
CREATE TABLE gsc_properties (
  org_id TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  -- The workspace project (lib/project.ts).
  project_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, project_id)
);
