-- ============================================================================
-- Migration 040 — Market Tag Ledger (public accountability for /market)
-- ============================================================================
-- Purpose: Freeze every model-vs-market TAG at kickoff and grade it at the
--          whistle, in public. One row per (match, market_type, selection).
--          Only non-fair 1X2 tags are frozen (generous / rich / wide); fair
--          prices are not tracked.
--
-- Grading (regulation / 90-minute result — the 1X2 market prices the 90-min
-- result, NOT after-extra-time):
--   · matches.home_score/away_score hold the AFTER-ET score (see
--     lib/syncFixture.js), so regulation_result is derived at grade time from
--     API-Sports score.fulltime, NOT from the stored score.
--   · generous  lands (hit) when the selection HIT.
--   · rich      lands (hit) when the selection MISSED.
--   · wide      is graded the same way but EXCLUDED from public stats (kept
--     for the methodology claim that wide gaps are disagreement, not value).
-- ============================================================================

CREATE TABLE market_tag_ledger (
  id                  serial PRIMARY KEY,

  match_id            integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  market_type         text    NOT NULL,              -- 'match_winner' (Phase 1)
  selection_label     text    NOT NULL,              -- 'home' | 'draw' | 'away'

  -- Frozen price + model at kickoff (the closing line).
  price_american      integer NOT NULL,
  price_decimal       numeric(6,3),
  implied_pct         numeric(5,2) NOT NULL,          -- de-vigged market %
  model_pct           numeric(5,2) NOT NULL,          -- independent model %
  gap                 numeric(5,2) NOT NULL,          -- model - market (signed)
  tag                 text    NOT NULL CHECK (tag IN ('generous', 'rich', 'wide')),

  edition_number      integer,                         -- team-power edition (model provenance)

  frozen_at           timestamptz NOT NULL DEFAULT now(),
  kickoff_at          timestamptz,

  -- Grading (null until the match is final and graded).
  regulation_result   text CHECK (regulation_result IN ('home', 'draw', 'away')),
  result              text CHECK (result IN ('hit', 'miss')),
  graded_at           timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),

  -- One frozen row per selection per market per match. Idempotent freeze
  -- relies on this via ON CONFLICT DO NOTHING.
  UNIQUE (match_id, market_type, selection_label)
);

-- Stats + table read: ungraded (open) rows and graded rows, newest first.
CREATE INDEX idx_market_tag_ledger_grading ON market_tag_ledger(kickoff_at DESC);
CREATE INDEX idx_market_tag_ledger_open ON market_tag_ledger(match_id) WHERE result IS NULL;

COMMENT ON TABLE market_tag_ledger IS 'Public grade sheet for /market. Each non-fair 1X2 tag frozen at kickoff (closing price + model + gap + tag + edition_number) and graded at final against the 90-minute API score.fulltime. generous hits on selection HIT, rich hits on MISS. wide graded but excluded from public stats.';
COMMENT ON COLUMN market_tag_ledger.regulation_result IS 'Home/draw/away by the 90-minute result (API score.fulltime), NOT the stored after-ET score. Null until graded.';
COMMENT ON COLUMN market_tag_ledger.tag IS 'generous | rich | wide. Only these (non-fair) are frozen. wide is graded but excluded from the public hit-rate stats.';
