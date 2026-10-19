-- Sign-in moves to Clerk: users, organisations, members, roles and invites
-- live there now. Each synced workspace keeps its `orgs` row, linked to a
-- Clerk organisation id (or a Clerk user id for a personal workspace) in
-- clerk_id. users, user_emails, identities and members stay, read only, so
-- workspaces from before Clerk can be carried over by their owners.

ALTER TABLE orgs ADD COLUMN clerk_id TEXT;
CREATE UNIQUE INDEX orgs_clerk_id ON orgs (clerk_id);

DROP TABLE sessions;
DROP TABLE auth_states;
DROP TABLE invites;
