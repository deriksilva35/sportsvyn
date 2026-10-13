-- 143_crew_stats_views.sql - the crew's stats surface: views, not base tables (tue-4).
--
-- crew_reader (the read-only role behind ~/crew/bin/sportsvyn-stats) reads ONLY
-- crew_stats.*_v. Each view exposes just the columns docs/crew/sportsvyn-stats
-- uses, so no email, name, session token, device id, IP or pick payload is
-- reachable through it. The views run with their OWNER's rights (the default), so
-- crew_reader needs no grant on the base tables behind them - and
-- scripts/crew-reader-grants.mjs revokes users, sessions, daily_guest_runs and
-- daily_board_runs from it.
--
-- Derived columns replace payloads: finished = picks IS NOT NULL, board_len,
-- picks_n and slots_filled are counts of the jsonb, never the jsonb itself.
--
-- Grants to crew_reader are made when the role exists (DEV may not have it);
-- scripts/crew-reader-grants.mjs re-grants on every run.
-- UNDO: DROP SCHEMA crew_stats CASCADE;
CREATE SCHEMA IF NOT EXISTS crew_stats;

CREATE OR REPLACE VIEW crew_stats.users_v AS
  SELECT id, created_at, last_seen_at, coalesce(is_house, false) AS is_house FROM public.users;

CREATE OR REPLACE VIEW crew_stats.sessions_v AS
  SELECT "userId" AS user_id, expires FROM public.sessions;

CREATE OR REPLACE VIEW crew_stats.daily_boards_v AS
  SELECT id, edition_date FROM public.daily_boards;

CREATE OR REPLACE VIEW crew_stats.daily_board_runs_v AS
  SELECT user_id, board_id, started_at, (picks IS NOT NULL) AS finished FROM public.daily_board_runs;

CREATE OR REPLACE VIEW crew_stats.daily_guest_runs_v AS
  SELECT started_at, claimed_at, (picks IS NOT NULL) AS finished FROM public.daily_guest_runs;

CREATE OR REPLACE VIEW crew_stats.contests_v AS
  SELECT id, game_type,
         CASE WHEN jsonb_typeof(board) = 'array' THEN jsonb_array_length(board) END AS board_len
    FROM public.contests;

CREATE OR REPLACE VIEW crew_stats.contest_entries_v AS
  SELECT contest_id, user_id, created_at, score,
         CASE WHEN jsonb_typeof(lineup) = 'object' THEN (SELECT count(*) FROM jsonb_object_keys(lineup)) END AS picks_n,
         CASE WHEN jsonb_typeof(lineup) = 'object' THEN (SELECT count(*) FROM jsonb_each(lineup) j WHERE j.value <> 'null'::jsonb) END AS slots_filled
    FROM public.contest_entries;

CREATE OR REPLACE VIEW crew_stats.nba_mock_drafts_v AS
  SELECT sport, created_at, grade FROM public.nba_mock_drafts;

CREATE OR REPLACE VIEW crew_stats.nba_mock_setups_v AS
  SELECT created_at FROM public.nba_mock_setups;

CREATE OR REPLACE VIEW crew_stats.player_leagues_v AS
  SELECT id, created_at FROM public.player_leagues;

CREATE OR REPLACE VIEW crew_stats.league_members_v AS
  SELECT league_id FROM public.league_members;

REVOKE ALL ON SCHEMA crew_stats FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_reader') THEN
    GRANT USAGE ON SCHEMA crew_stats TO crew_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA crew_stats TO crew_reader;
  END IF;
END $$;
