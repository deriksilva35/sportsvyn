-- ============================================================================
-- Migration 047 — sim_player_pool: ADP stdev + bye week
-- ============================================================================
-- Two FFC fields the 046 spec left out, now needed by the AI draft engine and
-- the Read:
--
--   · stdev — FFC's per-player ADP standard deviation, i.e. MEASURED market
--     disagreement (how much real drafters diverge on where the player goes).
--     The engine scales its per-candidate sampling temperature by this value, so
--     a polarizing player genuinely gets reached for and slid past while a
--     consensus player goes near ADP. METHODOLOGY RULE: the variance expresses a
--     STATED PRINCIPLE — real market spread — not a tuned magic constant. Storing
--     the real stdev (vs inventing a variance knob) is what keeps the engine
--     honest to /methodology.
--   · bye — the player's bye week, for roster construction logic (bye-stack
--     warnings) and the Read.
--
-- Both nullable (a feed row may omit either). Additive: no existing column is
-- changed; existing 046 pool rows get NULL until the next snapshot upsert fills
-- them in place (same snapshot_date, idempotent). Reversible by DROP COLUMN.
-- Depends: 046 (sim_player_pool).
-- ============================================================================

ALTER TABLE sim_player_pool
  ADD COLUMN stdev numeric,
  ADD COLUMN bye   integer;

COMMENT ON COLUMN sim_player_pool.stdev IS 'FFC per-player ADP standard deviation = measured market disagreement. Feeds the AI engine sampling temperature (real market spread, not a tuned constant).';
COMMENT ON COLUMN sim_player_pool.bye   IS 'Player bye week (from FFC). Roster-construction logic (bye stacks) + the Read.';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying + re-snapshot):
--   SELECT scoring_format, teams_count,
--          count(*) FILTER (WHERE stdev IS NOT NULL) AS with_stdev,
--          count(*) FILTER (WHERE bye   IS NOT NULL) AS with_bye,
--          count(*) AS total
--     FROM sim_player_pool GROUP BY scoring_format, teams_count;
-- ----------------------------------------------------------------------------
