-- ============================================================================
-- Migration 022 — Match Events
-- ============================================================================
-- Purpose: Persist per-match live events (goals, cards, subs, VAR reviews)
--          fetched from API-Sports /fixtures/events?fixture=X. The
--          poll-live cron (already fetches the events array every minute
--          and currently throws it away to keep only the count) will
--          start writing the actual rows. Powers the Key Moments
--          timeline + the live Watch Score recompute (downstream
--          consumer, separate slice).
-- Pattern: is_current flip — same shape as odds_markets (014) and
--          match_lineups (021). Disappeared events (e.g. a goal VAR'd
--          off — API-Sports removes the original Goal from the feed and
--          replaces it with a Var "Goal cancelled" event) stay in the
--          table as is_current=false for forensic forever, but page
--          reads filter is_current=true so phantom goals never render.
-- ============================================================================

CREATE TABLE match_events (
  id             serial PRIMARY KEY,
  match_id       integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,

  -- Chronology (API-Sports time.elapsed + time.extra)
  minute         integer NOT NULL,
  minute_extra   integer,                          -- e.g. 45+3, 90+5; NULL when no added time

  -- What happened. Unconstrained — forward-compat for new API-Sports
  -- types (same call we made for odds_markets.market_type). A new
  -- event_type must never poison a sync.
  event_type     text NOT NULL,                    -- 'Goal' | 'Card' | 'subst' | 'Var' | ...
  detail         text,                             -- 'Normal Goal' | 'Yellow Card' | 'Substitution N' | 'Goal cancelled' | ...

  -- Who did it. team_api_id + player_api_id are stable API-Sports IDs
  -- (verified against fixture 1503008). team_side is derived from the
  -- event's team.id vs the fixture's home/away team ids.
  team_side      text NOT NULL CHECK (team_side IN ('home','away')),
  team_api_id    integer,
  player_api_id  integer,
  player_name    text,                             -- denormalized for display
  assist_api_id  integer,                          -- nullable; assist OR sub-off player
  assist_name    text,

  -- Forensics — original event payload, for later debugging of new
  -- types/details or weird API responses.
  raw            jsonb,

  -- is_current flip: every cron tick flips all current rows for this
  -- match to false, then UPSERTs the latest feed with is_current=true.
  -- Survivors get re-flipped to true via ON CONFLICT DO UPDATE.
  -- Disappeared events (e.g. VAR cancellations) stay is_current=false.
  is_current     boolean NOT NULL DEFAULT true,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),

  -- Dedup composite key. NULLS NOT DISTINCT so two events with
  -- minute_extra=NULL still collide on the unique constraint instead
  -- of slipping through as accidental duplicates. Requires Postgres 15+
  -- (Neon is on 16).
  UNIQUE NULLS NOT DISTINCT
    (match_id, minute, minute_extra, event_type, detail, player_api_id)
);

-- Page-side read pattern: "current events for this match, in chrono order".
CREATE INDEX idx_match_events_current
  ON match_events (match_id, minute, minute_extra)
  WHERE is_current = true;
