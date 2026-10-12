-- 140_mock_nfl.sql - the NFL mock draft at /mock/nfl (mon-3).
--
-- nfl_mock_pool: one row per season, the pool the page drafts from - ADP per
--   scoring format from the licensed football ADP source, this season's and last
--   season's stat totals, games left per team, the injury status (built daily by
--   /api/cron/nfl-mock-pool, lib/mockNfl/pool.js).
-- The NBA mock's per-reader tables gain a SPORT column so one account keeps an
-- NBA and an NFL setup side by side: nba_mock_setups (names unique per account
-- AND sport), nba_mock_settings (one row per account and sport), and the
-- anonymous nba_mock_drafts record. Existing rows are NBA. The table names stay.
--
-- ADDITIVE. UNDO: DROP TABLE nfl_mock_pool; the sport columns can stay (default 'nba').
CREATE TABLE IF NOT EXISTS nfl_mock_pool (
  season_year integer PRIMARY KEY,
  built_at    timestamptz NOT NULL DEFAULT now(),
  rows        jsonb NOT NULL
);

ALTER TABLE nba_mock_setups ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'nba' CHECK (sport IN ('nba', 'nfl'));
DROP INDEX IF EXISTS nba_mock_setups_user_name_idx;
CREATE UNIQUE INDEX IF NOT EXISTS nba_mock_setups_user_sport_name_idx ON nba_mock_setups (user_id, sport, lower(name));

ALTER TABLE nba_mock_settings ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'nba' CHECK (sport IN ('nba', 'nfl'));
ALTER TABLE nba_mock_settings DROP CONSTRAINT IF EXISTS nba_mock_settings_pkey;
ALTER TABLE nba_mock_settings ADD PRIMARY KEY (user_id, sport);

ALTER TABLE nba_mock_drafts ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'nba' CHECK (sport IN ('nba', 'nfl'));
