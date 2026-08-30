-- ============================================================================
-- Migration 079 — Standings: TWO tables, deliberately not one
-- ============================================================================
-- A record and a table are different objects, and a census of the three
-- providers proved the fields do not merely differ in name, they collide in
-- MEANING:
--
--   `points`   EPL  = league table points, 3 for a win
--              NFL  = points_for, i.e. points SCORED
--              One column name, two unrelated quantities. Whichever
--              definition a shared column took, it would be wrong for one
--              league. That single collision settles the design.
--   `rank`     EPL  = league position, the whole point of the display
--              NFL  = playoff_seed, which is not a position and is populated
--                     with nonsense during preseason
--              CFB  = does not exist at all
--   draw/tie   EPL  = ~25% of matches, central
--              NFL  = vanishingly rare;  CFB = effectively extinct
--
-- So: team_records answers "how has this team done", league_tables answers
-- "where does this team stand". Unifying them behind a jsonb would buy one
-- join and cost a typed column for every field anyone actually renders.
--
-- LEAGUE-AGNOSTIC BY CONSTRUCTION. Neither table names a sport, a provider or
-- a league in its schema — league_id is a plain FK and every league-specific
-- field is nullable. MLB, NBA and NHL join in September/October by inserting
-- rows, not by altering these tables. The only per-league knowledge lives in
-- the importers.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- SHAPE A — RECORDS (NFL, CFB, and any future W-L-T league)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_records (
  id                      serial PRIMARY KEY,
  league_id               integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id                 integer NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  season                  integer NOT NULL,

  -- SEASON_TYPE IS REQUIRED, AND IT IS THE WHOLE REASON THIS COLUMN EXISTS.
  -- BDL's /nfl/v1/standings is documented as "regular season team standings"
  -- and, asked for the current season before Week 1, returns PRESEASON records
  -- — 49 games league-wide on 30 Aug 2026, with playoff_seed populated on a
  -- 1-2 team. Storing that unlabelled would put a preseason mark on a team
  -- page as "the record". The importer decides this from the calendar, never
  -- from the endpoint's own framing.
  season_type             text    NOT NULL
                            CHECK (season_type IN ('preseason', 'regular', 'postseason')),

  wins                    integer NOT NULL DEFAULT 0,
  losses                  integer NOT NULL DEFAULT 0,
  ties                    integer NOT NULL DEFAULT 0,

  -- Splits. All nullable: CFBD serves conference/home/away/neutral, BDL serves
  -- conference/division/home/road and no neutral, and a future league may
  -- serve none of them. A missing split is NULL, never 0 — zero is a real
  -- value meaning "played none and won none".
  conf_wins               integer, conf_losses    integer, conf_ties    integer,
  home_wins               integer, home_losses    integer, home_ties    integer,
  away_wins               integer, away_losses    integer, away_ties    integer,
  neutral_wins            integer, neutral_losses integer, neutral_ties integer,
  div_wins                integer, div_losses     integer, div_ties     integer,

  points_for              integer,
  points_against          integer,

  -- SIGNED. BDL sends -1 for one loss and 3 for three straight wins; the sign
  -- carries the direction, so storing an absolute value would throw half the
  -- information away.
  streak                  integer,

  playoff_seed            integer,          -- NFL only; NULL elsewhere
  conference              text,             -- 'AFC' | 'SEC' | ...
  division                text,             -- 'EAST' | CFB division | NULL
  classification          text,             -- CFB: 'fbs' | 'fcs' | 'ii' | 'iii'

  data_provider           text    NOT NULL, -- 'cfbd' | 'bdl' | ...
  data_provider_synced_at timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- THE UPSERT TARGET. season_type is part of the key because a team legitimately
-- holds a preseason AND a regular-season record for the same year, and they
-- must not overwrite one another.
CREATE UNIQUE INDEX IF NOT EXISTS team_records_uniq
  ON team_records (league_id, team_id, season, season_type);

CREATE INDEX IF NOT EXISTS team_records_lookup
  ON team_records (league_id, season, season_type);

COMMENT ON TABLE  team_records IS 'W-L-T records with splits. NFL/CFB today; any W-L-T league later. Distinct from league_tables by design — see migration 079 header.';
COMMENT ON COLUMN team_records.season_type IS 'REQUIRED. Set from the calendar by the importer, never from the provider''s framing: BDL returns preseason rows from an endpoint documented as regular-season.';
COMMENT ON COLUMN team_records.streak IS 'Signed: negative is a losing streak. BDL win_streak stored as-is.';

-- ---------------------------------------------------------------------------
-- SHAPE B — LEAGUE TABLE (EPL, and any future position-table league)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS league_tables (
  id                        serial PRIMARY KEY,
  league_id                 integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id                   integer NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  season                    integer NOT NULL,

  rank                      integer NOT NULL,
  played                    integer NOT NULL DEFAULT 0,
  win                       integer NOT NULL DEFAULT 0,
  draw                      integer NOT NULL DEFAULT 0,
  lose                      integer NOT NULL DEFAULT 0,
  goals_for                 integer NOT NULL DEFAULT 0,
  goals_against             integer NOT NULL DEFAULT 0,
  goal_diff                 integer NOT NULL DEFAULT 0,

  -- LEAGUE POINTS, not points scored. The name is unqualified here precisely
  -- because in this table it can only mean one thing — which is the argument
  -- for two tables rather than one.
  points                    integer NOT NULL DEFAULT 0,

  form                      text,   -- 'WWDLW', most recent first per provider
  movement_status           text,   -- 'same' | 'up' | 'down'
  qualification_description text,   -- 'Promotion - Champions League (League phase)'
  group_name                text,   -- 'Premier League'; a group name in cup formats

  data_provider             text    NOT NULL,
  data_provider_synced_at   timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- No season_type here: a league table is the table. A cup group stage gets its
-- own row set via group_name, not via a season_type.
CREATE UNIQUE INDEX IF NOT EXISTS league_tables_uniq
  ON league_tables (league_id, team_id, season);

CREATE INDEX IF NOT EXISTS league_tables_lookup
  ON league_tables (league_id, season, rank);

COMMENT ON TABLE  league_tables IS 'Position tables. EPL today; any ranked-table league later. Distinct from team_records by design — see migration 079 header.';
COMMENT ON COLUMN league_tables.points IS 'LEAGUE points (3/1/0), NOT points scored. team_records.points_for is the scoring column; the two must never share a name.';
COMMENT ON COLUMN league_tables.data_provider_synced_at IS 'OUR fetch time. API-Sports sends an `update` field reading midnight while the payload carries same-afternoon results — it is not a freshness signal and is deliberately not stored.';
