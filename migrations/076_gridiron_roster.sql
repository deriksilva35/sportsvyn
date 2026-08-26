-- 076_gridiron_roster.sql - the columns a gridiron roster needs.
--
-- ADDITIVE ONLY. The players table already holds 1,248 World Cup players and
-- five columns a gridiron roster wants verbatim: slug, full_name, position,
-- current_team_id and current_team_jersey_number. height_cm already exists too,
-- which decides the unit question below. Nothing here alters an existing column,
-- so the soccer rows are untouched by construction.
--
-- UNITS ARE METRIC, because height_cm already is. The two providers disagree
-- with each other AND with the column:
--     BDL   height "6' 4\""   weight "225 lbs"   - display STRINGS
--     CFBD  height 72          weight 210         - numbers, inches and pounds
-- Both normalise to cm/kg in the importer so the column means one thing. A
-- roster that rendered 72 for one player and 193 for another would be the
-- yards-to-goal problem again: two providers, one column, two meanings.
--
-- WEIGHT IS NUMERIC(5,2), NOT AN INTEGER. 225 lb is 102.06 kg; rounding to
-- whole kilos and converting back lands on 224.9 lb, which would display as a
-- weight the provider never stated. Two decimals round-trip cleanly.

ALTER TABLE players ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5,2);

-- Where they played before this team. BDL gives it for the NFL; CFBD does not
-- carry it on /roster, so college is NULL for college players - which is
-- correct rather than missing, since a college player's college IS their team.
ALTER TABLE players ADD COLUMN IF NOT EXISTS college TEXT;

-- Seasons of experience, as an integer.
--   BDL   "17th Season" -> 17, "Rookie" -> 1
--   CFBD  year 3        -> 3
-- One scale, so a roster can sort by it without knowing the provider.
ALTER TABLE players ADD COLUMN IF NOT EXISTS experience_years INTEGER;

-- THE BUCKETING COLUMN. SquadList groups by GK/DEF/MID/ATT, a vocabulary in
-- which every gridiron position falls through to OTHER - a 53-man roster would
-- render as one undifferentiated list. position_group is the sport-appropriate
-- grouping, derived at import from the provider's position string and stored so
-- the render never re-derives it.
ALTER TABLE players ADD COLUMN IF NOT EXISTS position_group TEXT;

-- The roster read: one team's players, in group then jersey order.
CREATE INDEX IF NOT EXISTS players_team_group_idx
  ON players (current_team_id, position_group, current_team_jersey_number);

-- IDEMPOTENCE NEEDS A REAL INDEX, not a SELECT-then-branch. Upserting 26,703
-- CFB rows one at a time over HTTP measured ~4 rows/sec - roughly 110 minutes,
-- and two round trips per player. These partial unique indexes let the whole
-- import run as multi-row INSERT ... ON CONFLICT, one statement per chunk.
--
-- PARTIAL, because the predicate is what keeps them off the 1,248 soccer rows:
-- a World Cup player carries neither key, so they are not in either index and
-- cannot collide with a gridiron player.
CREATE UNIQUE INDEX IF NOT EXISTS players_bdl_player_uniq
  ON players ((external_ids->>'bdl_player_id'))
  WHERE external_ids ? 'bdl_player_id';

CREATE UNIQUE INDEX IF NOT EXISTS players_cfbd_player_uniq
  ON players ((external_ids->>'cfbd_player_id'))
  WHERE external_ids ? 'cfbd_player_id';
