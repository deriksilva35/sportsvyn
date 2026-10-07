-- ============================================================================
-- 133_league_pick_format.sql - how a player league scores its Pick'em (S2).
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 132 is the highest in the tree.
--
-- RULING (wed-1): a league's Pick'em is REGULAR (a point per winner, from the
-- lineup) or CONFIDENCE (the board's own rank points). ATS is RESERVED - the
-- value is allowed so S3 needs no constraint change, and no surface offers it.
-- `format` (table|guillotine) is a STANDINGS format and is not overloaded.
--
-- pick_format              'regular' | 'confidence' | 'ats'. DEFAULT 'regular',
--                          so every league that exists keeps scoring as it did.
-- pick_format_prev         the format the weeks BEFORE pick_format_from were
--                          scored on. NULL unless the one-time switch was used.
-- pick_format_from         the first instant the current pick_format applies
--                          to (a contest's locks_at >= it). NULL = from the start.
-- pick_format_switch_open  the commissioner's ONE-TIME switch, offered only to
--                          the leagues that existed before S2 (set true below,
--                          default false for every league made after). Using it
--                          closes it. The switch is effective from the 20 Oct
--                          2026 week at the earliest; earlier weeks stay as scored.
--
-- ADDITIVE AND REVERSIBLE: four columns, no rewrite of any existing value.
--   undo: ALTER TABLE player_leagues DROP COLUMN pick_format, DROP COLUMN pick_format_prev,
--         DROP COLUMN pick_format_from, DROP COLUMN pick_format_switch_open;
-- ============================================================================

ALTER TABLE player_leagues
  ADD COLUMN IF NOT EXISTS pick_format             text    NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS pick_format_prev        text,
  ADD COLUMN IF NOT EXISTS pick_format_from        timestamptz,
  ADD COLUMN IF NOT EXISTS pick_format_switch_open boolean;

ALTER TABLE player_leagues DROP CONSTRAINT IF EXISTS player_leagues_pick_format_check;
ALTER TABLE player_leagues ADD CONSTRAINT player_leagues_pick_format_check
  CHECK (pick_format IN ('regular', 'confidence', 'ats'));
ALTER TABLE player_leagues DROP CONSTRAINT IF EXISTS player_leagues_pick_format_prev_check;
ALTER TABLE player_leagues ADD CONSTRAINT player_leagues_pick_format_prev_check
  CHECK (pick_format_prev IS NULL OR pick_format_prev IN ('regular', 'confidence', 'ats'));

-- THE LEAGUES THAT EXIST NOW get the switch; the column is added without a
-- default first so this line can tell them apart from the ones made later.
UPDATE player_leagues SET pick_format_switch_open = true WHERE pick_format_switch_open IS NULL;
ALTER TABLE player_leagues ALTER COLUMN pick_format_switch_open SET DEFAULT false;
ALTER TABLE player_leagues ALTER COLUMN pick_format_switch_open SET NOT NULL;
