-- 137_nba_mock_pool.sql - the NBA mock draft's player pool (sun-5).
--
-- ONE ROW PER SEASON, rebuilt daily by /api/cron/nba-mock-pool from BDL (active
-- rosters + last season's averages + draft slots; lib/mockNba/pool.js). The
-- public page /mock/nba reads this one row and runs the whole draft in the
-- browser, so no BDL call ever sits in a page render or a build.
--
-- ADDITIVE. UNDO: DROP TABLE nba_mock_pool;
CREATE TABLE IF NOT EXISTS nba_mock_pool (
  season_year integer PRIMARY KEY,
  built_at    timestamptz NOT NULL DEFAULT now(),
  rows        jsonb NOT NULL
);
COMMENT ON TABLE nba_mock_pool IS
  'The NBA mock draft pool, one row per season, rebuilt daily by /api/cron/nba-mock-pool (lib/mockNba/pool.js).';
