-- ============================================================================
-- Migration 014 — Odds Markets (futures + match + player props)
-- ============================================================================
-- Purpose: Refined odds model superseding the Phase 2 stub (odds_snapshots).
--          Captures American odds, implied probability, source-book consensus,
--          and 24h movement for all three market scopes.
-- Powers:  - Team page odds tiles: Tournament Winner + Next Match
--          - Player page awards odds: Golden Ball + Golden Boot
--          - Match page Odds tab (live + pre-match)
--          - "Where Sportsvyn disagrees with the market" editorial framing
-- ============================================================================

CREATE TABLE odds_markets (
  id                      serial PRIMARY KEY,

  -- Market classification
  market_scope            text NOT NULL CHECK (market_scope IN ('futures', 'match', 'player_prop')),
  market_type             text NOT NULL,                  -- e.g. 'tournament_winner', 'match_winner', 'golden_ball', 'golden_boot', 'anytime_scorer', 'spread', 'total', 'draw_no_bet'

  -- Polymorphic references (the scope determines which is populated)
  league_id               integer REFERENCES leagues(id) ON DELETE CASCADE,
  match_id                integer REFERENCES matches(id) ON DELETE CASCADE,
  team_id                 integer REFERENCES teams(id) ON DELETE CASCADE,
  player_id               integer REFERENCES players(id) ON DELETE CASCADE,

  -- The selection being priced
  selection_label         text NOT NULL,                  -- 'Argentina to win tournament' | 'Mbappé Golden Boot' | 'Argentina -1.5'
  selection_value         text,                           -- For spread/total: '-1.5' | 'Over 2.5'

  -- Pricing
  american_odds           integer NOT NULL,               -- +250, -280, etc.
  implied_probability     numeric(5,2) NOT NULL,          -- 0.00 - 100.00
  decimal_odds            numeric(6,3),                   -- 3.500, 1.357 — convenience for international users

  -- Consensus source
  source_books            text[],                         -- ['DraftKings', 'FanDuel', 'BetMGM']
  num_books               integer,                        -- count of source_books
  consensus_method        text NOT NULL DEFAULT 'mean' CHECK (consensus_method IN ('mean', 'median', 'best')),

  -- 24h movement
  previous_american_odds  integer,
  previous_implied_prob   numeric(5,2),
  movement_24h_odds       integer,                        -- delta in american odds
  movement_24h_prob       numeric(5,2),                   -- delta in implied probability
  previous_snapshot_at    timestamptz,

  -- Visibility / lifecycle
  is_current              boolean NOT NULL DEFAULT true,
  geofence_blocked        text[],                         -- US state codes where odds rendering is regulated (e.g., {'WA', 'HI'})

  -- Provenance
  fetched_at              timestamptz NOT NULL DEFAULT now(),
  fetcher_version         text,                           -- 'odds-api-v4' etc.

  created_at              timestamptz NOT NULL DEFAULT now(),

  -- Scope-correct entity reference
  CHECK (
    (market_scope = 'futures' AND league_id IS NOT NULL) OR
    (market_scope = 'match' AND match_id IS NOT NULL) OR
    (market_scope = 'player_prop' AND player_id IS NOT NULL AND (match_id IS NOT NULL OR league_id IS NOT NULL))
  )
);

CREATE INDEX idx_odds_markets_team_current ON odds_markets(team_id, market_type) WHERE team_id IS NOT NULL AND is_current = true;
CREATE INDEX idx_odds_markets_player_current ON odds_markets(player_id, market_type) WHERE player_id IS NOT NULL AND is_current = true;
CREATE INDEX idx_odds_markets_match_current ON odds_markets(match_id) WHERE match_id IS NOT NULL AND is_current = true;
CREATE INDEX idx_odds_markets_futures ON odds_markets(league_id, market_type) WHERE market_scope = 'futures' AND is_current = true;
CREATE INDEX idx_odds_markets_fetched ON odds_markets(fetched_at DESC);

COMMENT ON TABLE odds_markets IS 'Consensus odds across DraftKings, FanDuel, BetMGM (or whichever books are configured). Phase 1 source: The Odds API. Refreshed every 15 minutes. Brand presentation locked May 27 2026: American odds + implied % + 24h movement chip + source line. Informational not affiliate.';
COMMENT ON COLUMN odds_markets.geofence_blocked IS 'US state codes where this market''s rendering is suppressed for regulatory compliance. Phase 1 default empty array. Populated for affiliate transition.';
COMMENT ON COLUMN odds_markets.movement_24h_odds IS 'Delta in American odds vs the snapshot 24h ago. Positive = odds got longer (less favored), negative = odds got shorter (more favored). The chip color in the UI (volt for shorter, terra for longer) is computed from this column.';

-- Keep the Phase 2 stub table alive for raw_data archival; the new odds_markets
-- table is the consumer-facing source of truth.
-- (No DROP TABLE odds_snapshots — keep both for now.)
