-- Real traffic from a collector at the site's edge (collector/). One site per
-- project in a workspace; the collector authenticates with a token of which
-- only sha256 is stored. Events aren't kept one by one: ingest folds them
-- into hourly counts per (kind, agent, source, path, status).

CREATE TABLE traffic_sites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  -- The workspace project (lib/project.ts) this site belongs to.
  project_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  -- The token's last 4 characters, to tell tokens apart in the UI.
  token_hint TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  last_event_at INTEGER,
  -- How the most recent events arrived (cloudflare-worker, cloudflare-pages, next, ...).
  last_via TEXT,
  UNIQUE (org_id, project_id)
);

CREATE TABLE traffic_hits (
  site_id TEXT NOT NULL REFERENCES traffic_sites (id) ON DELETE CASCADE,
  -- Epoch hour (UTC).
  hour INTEGER NOT NULL,
  -- human | ai_search | ai_user | ai_training | search | preview | bot
  kind TEXT NOT NULL,
  -- Crawler id (lib/traffic.ts), '' for people.
  agent TEXT NOT NULL,
  -- For people: where they came from (chatgpt, google, a referring host, direct, internal); '' for bots.
  source TEXT NOT NULL,
  -- Normalised path; '' for unrecognised bots (their paths are mostly probes for exploits).
  path TEXT NOT NULL,
  -- 0 when the collector couldn't see the response (Next.js proxy).
  status INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (site_id, hour, kind, agent, source, path, status)
);
