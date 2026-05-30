-- ============================================================================
-- Migration 021 — Match Lineups
-- ============================================================================
-- Purpose: Persist per-match starting XI + bench fetched from API-Sports
--          /fixtures/lineups?fixture=X. One row per team per fetch; the
--          poll-lineups cron flips is_current on the prior row before
--          inserting the new one — same is_current pattern odds_markets
--          uses (migration 014).
-- Powers:  - /match/[slug] "Lineups & Injuries" tab (lineups only;
--            injuries deferred to a later slice).
-- ============================================================================

CREATE TABLE match_lineups (
  id           serial PRIMARY KEY,
  match_id     integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_side    text    NOT NULL CHECK (team_side IN ('home', 'away')),

  formation    text,           -- e.g. '4-2-3-1'. Nullable because API-Sports
                               -- occasionally omits it for less-covered fixtures.
  players      jsonb   NOT NULL,
                               -- Flat array of player objects:
                               --   { number, name, pos, grid, role }
                               -- where role ∈ {'starting','bench'}.
                               -- grid (e.g. "1:1", "2:1") is API-Sports's
                               -- formation-position hint for a future
                               -- visual lineup diagram.

  is_current   boolean NOT NULL DEFAULT true,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

-- Partial index on the page-side read pattern: "current home + away row
-- for this match". Matches how /match/[slug]'s getLineups() queries.
CREATE INDEX idx_match_lineups_current
  ON match_lineups (match_id, team_side)
  WHERE is_current = true;
