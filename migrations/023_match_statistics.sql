-- ============================================================================
-- Migration 023 — Match Statistics
-- ============================================================================
-- Purpose: Persist per-match statistics (possession, shots, passes, fouls,
--          cards, saves, xG when available) fetched from API-Sports
--          /fixtures/statistics?fixture=X. Powers the Full Match Stats
--          panel in the LIVE tab's right rail. Updates via the same
--          poll-live cron tick that already fetches events.
-- Pattern: jsonb-per-side + is_current flip — same shape as
--          match_lineups (021). Each fetch writes 2 rows (home + away),
--          flipping the prior pair to is_current=false. Old snapshots
--          stay in the table as forensic record but page reads filter
--          is_current=true.
-- ============================================================================

CREATE TABLE match_statistics (
  id           serial PRIMARY KEY,
  match_id     integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_side    text    NOT NULL CHECK (team_side IN ('home', 'away')),

  -- Flat jsonb keyed by API-Sports stat 'type'. Values are mixed-type:
  --   numbers (e.g. "Total Shots": 13)
  --   percentage strings (e.g. "Ball Possession": "45%")
  --   null (e.g. "expected_goals": null for friendlies on the current plan)
  -- The render layer parses + handles all three.
  stats        jsonb   NOT NULL,

  is_current   boolean NOT NULL DEFAULT true,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

-- Page-side read pattern: "current home + away stats for this match".
CREATE INDEX idx_match_statistics_current
  ON match_statistics (match_id, team_side)
  WHERE is_current = true;
