-- 121: EPL Weekly 5 - the stats its scorer needs that were never stored, and
-- the feed's availability flags.
--
-- 1. FOUR COLUMNS ON player_match_stats, ALL NULLABLE. The scorer (ruled
--    thu-13, lib/eplWeekly5/scoring.js) prices own goals, penalty saves,
--    penalty misses and a clean sheet kept WHILE THE PLAYER WAS ON THE PITCH.
--    None of the four was stored:
--      penalties_saved / penalties_missed   the per-player payload's
--                                           penalty.{saved,missed}
--      own_goals                            the fixture's events ('Own Goal')
--      conceded_on_pitch                    goals his team conceded between
--                                           his came_on and came_off minutes,
--                                           walked from the events
--    (came_on_at_minute / came_off_at_minute already exist and were always
--    NULL; the importer fills them now from the same walk.)
--    NULL means "not derived" - an import before this migration, or a fixture
--    with no events - and is never read as zero by the clean sheet.
--
-- 2. epl_player_availability: API-Sports /injuries per fixture (injured,
--    suspended, doubtful), replaced whole for a fixture on every fetch. Its
--    own table rather than a jsonb key: a list keyed by (match, player) is a
--    table, and the jsonb merge laws (CLAUDE.md) have nothing to catch here.
--
-- IDEMPOTENT. Additive only: no existing column, constraint or reader moves.

ALTER TABLE player_match_stats ADD COLUMN IF NOT EXISTS own_goals integer;
ALTER TABLE player_match_stats ADD COLUMN IF NOT EXISTS penalties_saved integer;
ALTER TABLE player_match_stats ADD COLUMN IF NOT EXISTS penalties_missed integer;
ALTER TABLE player_match_stats ADD COLUMN IF NOT EXISTS conceded_on_pitch integer;

CREATE TABLE IF NOT EXISTS epl_player_availability (
  match_id       integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_api_id  integer NOT NULL,
  player_name    text,
  -- the provider's own words: type 'Missing Fixture' | 'Questionable',
  -- reason 'Knee Injury' | 'Suspended' | 'Red Card' ...
  kind           text,
  reason         text,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, player_api_id)
);

COMMENT ON TABLE epl_player_availability IS
  'API-Sports /injuries per EPL fixture, replaced whole per fixture on each fetch (lib/eplWeekly5/availability.js). EPL Weekly 5''s pool flags injured/suspended rows from it.';
COMMENT ON COLUMN player_match_stats.conceded_on_pitch IS
  'Goals the player''s team conceded while he was on the pitch, from the fixture events (lib/soccer/playerMatchFacts.js). NULL = not derived. EPL Weekly 5''s clean sheet reads it.';

-- 3. epl_live_lines: ONE ROW PER FIXTURE IN PLAY, the per-player lines the
--    live poller's own tick already carries (/fixtures?ids= embeds players
--    and events), mapped to player_match_stats' column names and replaced
--    whole on each tick that wrote the fixture. EPL Weekly 5's live chips
--    read it until the full-time import lands the real rows in
--    player_match_stats - which no other reader is shown mid-match, exactly
--    as before. One statement per fixture per tick.
CREATE TABLE IF NOT EXISTS epl_live_lines (
  match_id    integer PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  -- { "<provider player id>": { minutes_played, goals, assists, ... } }
  lines       jsonb NOT NULL DEFAULT '{}'::jsonb,
  elapsed     integer,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
