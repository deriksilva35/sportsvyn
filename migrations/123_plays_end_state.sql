-- 123_plays_end_state.sql - the feed's END-OF-PLAY state on every play row.
--
-- WHY. plays held only the PRE-SNAP state (down, distance, yards_to_goal). The
-- state a play LEAVES - where the next snap is - had to be inferred from the
-- next row, which on a change of possession is a different team in a
-- different frame, and on the newest row of a live game does not exist yet.
-- BDL publishes it outright (end_down, end_distance, end_yards_to_endzone);
-- it is stored as given rather than re-derived.
--
-- THE FRAME. end_yards_to_goal is measured from the side in possession AFTER
-- the play, which on a handoff row is NOT offense_team_id: PHI@CHI's goal-line
-- interception (offense PHI) ends "1st & 10 at CHI 20", end_yards_to_goal 80
-- - CHI's distance. That is the next snap's state, which is the point of it.
--
-- NULL means no snap is pending (after a score, at a kickoff - BDL's -1 / 0
-- sentinel downs are not stored as downs) or a provider that does not publish
-- it (CFBD /live/plays, every non-gridiron sport).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.

ALTER TABLE plays
  ADD COLUMN IF NOT EXISTS end_down          INTEGER,
  ADD COLUMN IF NOT EXISTS end_distance      INTEGER,
  ADD COLUMN IF NOT EXISTS end_yards_to_goal INTEGER;

COMMENT ON COLUMN plays.end_down IS
  'Down of the NEXT snap as the feed states it (BDL end_down), 1-4; NULL when no snap is pending or the provider does not publish it.';
COMMENT ON COLUMN plays.end_distance IS
  'Distance of the NEXT snap (BDL end_distance); NULL with end_down.';
COMMENT ON COLUMN plays.end_yards_to_goal IS
  'Yards to goal of the NEXT snap (BDL end_yards_to_endzone), in the frame of the side in possession AFTER the play - on a handoff row that is not offense_team_id. NULL with end_down.';
