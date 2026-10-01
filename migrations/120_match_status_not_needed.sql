-- 120: matches.status gains 'not_needed' (thu-26).
--
-- A POSTSEASON GAME THAT WILL NEVER BE PLAYED, BY OUR DECISION. When a series
-- is decided, its remaining if-necessary games are not cancelled by anybody -
-- the feed simply stops listing them, or lists them 'scheduled' for days.
-- mlb-advance now marks them 'not_needed' the run after the clinch
-- (lib/mlb/notNeeded.js) instead of waiting on the provider, and every reader
-- that draws or scores a game skips the status.
--
-- NOT 'cancelled', deliberately: cancelled is a provider's word about a game
-- that was meant to be played (a rainout nobody made up). not_needed is ours,
-- and the schedule writer must never flip it back (lib/mlb/schedule.js).
--
-- The constraint is replaced, not altered - Postgres has no ALTER for a CHECK
-- body. One statement each way, so a failed apply leaves the old one in place.
BEGIN;
ALTER TABLE matches DROP CONSTRAINT matches_status_check;
ALTER TABLE matches ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled', 'live', 'final', 'postponed', 'cancelled', 'not_needed'));
COMMIT;
