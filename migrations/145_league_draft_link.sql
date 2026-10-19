-- 145_league_draft_link.sql - Leagues slice 3, option B (fri-3): a Fantrax draft
-- league gets a player league as its door and its home. THE DRAFT DATA IS UNTOUCHED.
--
-- 1. draft_configs.league_id -> player_leagues(id). The draft tables stay the
--    engine (members, claims, keepers, invites, runs); the player league is who
--    is in, roles, the invite and the league home. ON DELETE SET NULL: deleting a
--    league never deletes a draft. Only a 'fantrax' config may be linked - a
--    manual or tracker config is ONE reader's private room, never a league
--    (the leagueShare ruling, CLAUDE.md). Several configs may share one league
--    (next season's import attaches to the same league), so no UNIQUE.
-- 2. player_leagues.kind: 'games' (every league until now) or 'fantasy' (a
--    league that holds a draft). A fantasy league may ALSO play public games
--    beside its draft (ruling fri-3; crew points apply when there are several).
-- 3. player_leagues.bots_on: for a draft league, are empty seats filled by bots?
--    Off unless the commissioner turns it on (ruling fri-3). Read by the shared
--    league draft (slice 4); a member's private mock always fills with bots.
-- League size for a fantasy league = the config's teams_count; the link writes it.
--
-- UNDO: ALTER TABLE draft_configs DROP COLUMN league_id;
--       ALTER TABLE player_leagues DROP COLUMN kind, DROP COLUMN bots_on;

ALTER TABLE player_leagues
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'games',
  ADD COLUMN IF NOT EXISTS bots_on boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE player_leagues ADD CONSTRAINT player_leagues_kind_check CHECK (kind IN ('games', 'fantasy'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE draft_configs
  ADD COLUMN IF NOT EXISTS league_id integer REFERENCES player_leagues(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE draft_configs ADD CONSTRAINT draft_configs_league_fantrax_check
    CHECK (league_id IS NULL OR source = 'fantrax');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_draft_configs_league ON draft_configs (league_id) WHERE league_id IS NOT NULL;
