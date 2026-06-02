-- ============================================================================
-- Migration 025 — match_watch_score_history
-- ============================================================================
-- Per-tick history of the Live Watch Score (lib/liveWatchScore.js v1).
-- Populated by /api/cron/poll-live's per-match loop (piggyback after
-- syncFixture, own try/catch, status IN ('live','final') only).
--
-- One row per poll-live tick that observed a live (or just-finalized)
-- match. Source of truth for the sparkline render in Slice 3, and the
-- replay substrate for tuning the formula to v2 once we have ~20+
-- matches of real captured data.
--
-- Raw inputs stored alongside composite_score so a later formula_version
-- can be re-derived from the same source data without re-querying the
-- match_events / matches state (which is a moving target — poll-live
-- keeps writing). composite_score is a cached value; the inputs are
-- the source of truth.
--
-- Idempotency: live ticks are append-only (forensic — multiple ticks
-- at the same minute are valid, e.g. during HT pause every cron tick
-- stamps minute=45). One terminal-state tick per match is enforced via
-- the partial unique index on status_short IN ('FT','AET','PEN') —
-- belt-and-suspenders against any double-fire from poll-live during
-- the live→final transition tick.
-- ============================================================================

CREATE TABLE match_watch_score_history (
  id              serial PRIMARY KEY,
  match_id        integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,

  -- Tick stamp
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  minute          integer,                         -- API-Sports time.elapsed at tick (NULL if syncFixture didn't expose it)
  minute_extra    integer,                         -- stoppage time when present (typically NULL for live ticks)
  status_short    text,                            -- '1H' | 'HT' | '2H' | 'ET' | 'BT' | 'P' | 'FT' | 'AET' | 'PEN' | ...

  -- Raw inputs the formula consumed at this tick (so future v2 can
  -- re-derive composite_score without touching match_events).
  home_score      integer NOT NULL,
  away_score      integer NOT NULL,
  goals_count     integer NOT NULL DEFAULT 0,     -- is_current Goal events (excludes Missed Penalty)
  lead_changes    integer NOT NULL DEFAULT 0,     -- chronological count of equalizers + reversals
  yellow_cards    integer NOT NULL DEFAULT 0,
  red_cards       integer NOT NULL DEFAULT 0,

  -- Computed score + provenance
  composite_score numeric(3,1) NOT NULL,          -- 0.0 – 10.0, one decimal
  formula_version text    NOT NULL DEFAULT 'v1',
  components      jsonb                           -- {base, goals, closeness, lead_changes, cards, late_drama, raw_total, clipped}
);

-- Render path: "per-minute curve for this match, in time order" → reads
-- by (match_id, recorded_at). Sparkline query is small enough to skip
-- a covering index — just an ordered scan.
CREATE INDEX idx_mwsh_match_recorded ON match_watch_score_history(match_id, recorded_at);
CREATE INDEX idx_mwsh_match_minute   ON match_watch_score_history(match_id, minute);

-- Race-safe terminal-tick enforcement: one terminal row per match
-- (FT for regulation, AET for extra-time, PEN for penalty-decided).
-- Live ticks (status_short NOT IN the terminal set) don't match this
-- partial index and remain append-only. The piggyback INSERT uses
-- ON CONFLICT ... DO NOTHING with this same WHERE predicate.
CREATE UNIQUE INDEX idx_mwsh_one_terminal_per_match
  ON match_watch_score_history(match_id)
  WHERE status_short IN ('FT', 'AET', 'PEN');

COMMENT ON TABLE match_watch_score_history IS
  'Per-tick history of lib/liveWatchScore composite. One row per poll-live tick for live+final matches. Raw inputs preserved so future formula versions can re-derive composite_score without re-querying match_events.';

COMMENT ON COLUMN match_watch_score_history.components IS
  'Forensic breakdown: {base, goals, closeness, lead_changes, cards, late_drama, raw_total, clipped}. Lets a future debugger trace why a specific tick scored what it did.';

COMMENT ON INDEX idx_mwsh_one_terminal_per_match IS
  'Race-safe idempotency for the terminal tick. One FT/AET/PEN row per match; live ticks unconstrained for forensic detail.';
