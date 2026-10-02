-- 122: Leagues V1 - a player league gets its settings, its games, its invite
-- door and (for P3) the guillotine's one persisted decision. (fri-1, Phase P1)
--
-- NAMING LANDMINE (073): `leagues` is the SPORTS table. Everything here is
-- player_leagues / league_members / player_league_*.
--
-- THE SETTINGS ARE COLUMNS, THE GAMES ARE ROWS.
--   span        daily | weekly | season - how long one league "edition" runs
--   scoring     total | rank            - add the game's own score, or rank
--                                         points per game per period. A BUNDLE
--                                         (more than one game_type) MUST be
--                                         'rank': two games' scores are not one
--                                         unit. App-enforced in
--                                         lib/leagues/settings.js (a CHECK
--                                         cannot see the child table).
--   drop_worst  each member's worst period is not counted (season span only)
--   format      table | guillotine
--   max_members the cap; joins past it are refused (lib/leagues/invite.js)
--   late_joins  may a reader join once starts_at has passed
--   starts_at   the moment the first counted period begins (the late-join
--               line). start_season/start_week anchor an NFL-week league,
--               start_date (ET) a day-period one; standings (P2) count from
--               them and never from created_at.
--   invite_token the LINK token (/j/<token>), rotatable; join_code stays the
--               typed six-character code. A reset rotates both, stamps
--               code_reset_at, and the old ones are simply gone - there is no
--               history table, so a dead link cannot be revived.
--
-- RULINGS THIS SCHEMA IS SHAPED FOR (thu-14, applied by the P2/P3 readers):
--   (a) no entry in a period = 0 rank points - nothing is stored for a miss;
--   (b) ties share the higher place's points (RANK(), competition ranking);
--   (c) guillotine: a tie on the period AND the season total -> both survive,
--       so a period may chop nobody; player_league_eliminations holds one row
--       per chopped member and a period with no row chopped nobody;
--   (d) the leagues that exist before this migration become Daily-only,
--       total points - the backfill at the bottom.

BEGIN;

ALTER TABLE player_leagues
  ADD COLUMN IF NOT EXISTS span          text    NOT NULL DEFAULT 'season',
  ADD COLUMN IF NOT EXISTS scoring       text    NOT NULL DEFAULT 'total',
  ADD COLUMN IF NOT EXISTS drop_worst    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS format        text    NOT NULL DEFAULT 'table',
  ADD COLUMN IF NOT EXISTS max_members   integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS late_joins    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS starts_at     timestamptz,
  ADD COLUMN IF NOT EXISTS start_season  integer,
  ADD COLUMN IF NOT EXISTS start_week    integer,
  ADD COLUMN IF NOT EXISTS start_date    date,
  ADD COLUMN IF NOT EXISTS invite_token  text,
  ADD COLUMN IF NOT EXISTS code_reset_at timestamptz;

ALTER TABLE player_leagues DROP CONSTRAINT IF EXISTS player_leagues_span_check;
ALTER TABLE player_leagues ADD CONSTRAINT player_leagues_span_check
  CHECK (span IN ('daily', 'weekly', 'season'));
ALTER TABLE player_leagues DROP CONSTRAINT IF EXISTS player_leagues_scoring_check;
ALTER TABLE player_leagues ADD CONSTRAINT player_leagues_scoring_check
  CHECK (scoring IN ('total', 'rank'));
ALTER TABLE player_leagues DROP CONSTRAINT IF EXISTS player_leagues_format_check;
ALTER TABLE player_leagues ADD CONSTRAINT player_leagues_format_check
  CHECK (format IN ('table', 'guillotine'));
ALTER TABLE player_leagues DROP CONSTRAINT IF EXISTS player_leagues_max_members_check;
ALTER TABLE player_leagues ADD CONSTRAINT player_leagues_max_members_check
  CHECK (max_members BETWEEN 2 AND 100);

CREATE UNIQUE INDEX IF NOT EXISTS player_leagues_invite_token_key
  ON player_leagues (invite_token) WHERE invite_token IS NOT NULL;

-- One row per (game, sport) a league counts. A multi-sport game (Pick'em: NFL
-- and CFB) is one row per sport; a game with no sport (The Daily) is 'all'.
-- "One game" for the scoring rule is one DISTINCT game_type.
-- NO CHECK ON game_type: the registry is lib/leagues/gameTypes.js and it grows
-- (epl_weekly_5 and six both landed in the week this was written). A CHECK
-- list here would be a second registry that every new game has to remember;
-- lib/leagues/settings.js refuses an unregistered key before any write.
CREATE TABLE IF NOT EXISTS player_league_games (
  league_id  integer NOT NULL REFERENCES player_leagues(id) ON DELETE CASCADE,
  game_type  text    NOT NULL,
  sport      text    NOT NULL DEFAULT 'all',
  PRIMARY KEY (league_id, game_type, sport)
);
ALTER TABLE player_league_games DROP CONSTRAINT IF EXISTS player_league_games_game_type_check;

-- GUILLOTINE (P3): the ONE persisted decision, so a chop never flips on a
-- re-read after a stat correction. One row per chopped member.
CREATE TABLE IF NOT EXISTS player_league_eliminations (
  league_id     integer NOT NULL REFERENCES player_leagues(id) ON DELETE CASCADE,
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key    text    NOT NULL,
  period_total  numeric,
  season_total  numeric,
  decided_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id)
);
CREATE INDEX IF NOT EXISTS player_league_eliminations_period_idx
  ON player_league_eliminations (league_id, period_key);

-- ---------------------------------------------------------------------------
-- RULING (d): EVERY LEAGUE THAT HAS NO GAMES YET IS A PRE-V1 LEAGUE, and it
-- becomes The Daily, total points, a season table counted from the day it was
-- made. IDEMPOTENT: the guard is "has no player_league_games row", so a re-run
-- touches nothing, and a league made by the V1 create flow (which always
-- writes its games) is never touched. late_joins stays TRUE for these - before
-- V1 a code joined at any time, and a migration must not shut a door a member
-- already handed out. The cap is never below today's size.
-- The ET date of OUR OWN created_at (not a provider time - see
-- lib/gridiron/ingest.js for those).
-- ---------------------------------------------------------------------------
UPDATE player_leagues l
   SET span = 'season', scoring = 'total', drop_worst = false, format = 'table',
       late_joins = true,
       starts_at = l.created_at,
       start_date = (l.created_at AT TIME ZONE 'America/New_York')::date,
       max_members = GREATEST(12, (SELECT count(*)::int FROM league_members m WHERE m.league_id = l.id))
 WHERE NOT EXISTS (SELECT 1 FROM player_league_games g WHERE g.league_id = l.id);

INSERT INTO player_league_games (league_id, game_type, sport)
SELECT l.id, 'daily', 'all' FROM player_leagues l
 WHERE NOT EXISTS (SELECT 1 FROM player_league_games g WHERE g.league_id = l.id)
ON CONFLICT DO NOTHING;

COMMIT;
