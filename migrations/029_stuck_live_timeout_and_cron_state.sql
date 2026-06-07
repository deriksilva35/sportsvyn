-- ============================================================================
-- Migration 029 — stuck-live timeout marker + cron_state
-- ============================================================================
-- Two adds for the API-quota launch-blocker fix:
--
--   matches.timer_forced_final_at timestamptz NULL
--     Audit marker for finals that were resolved by the stuck-live sweep
--     (lib/stuckLiveSweep.js) rather than by an API-Sports FT response. NULL
--     means the row's status='final' came from the normal path (apiSports
--     returned FT/AET/PEN and mapStatus flipped it). Non-null means the
--     sweep forced the flip because the match had been status='live' for
--     longer than STUCK_LIVE_TIMEOUT_MIN (180 min) AND either (a) the
--     poll-once-before-flip apiSports.fixture() call failed, or (b) the
--     daily-cap circuit-breaker was tripped at sweep time. Used downstream
--     to re-resolve forced finals from real API data once quota's back.
--
--   cron_state (key text PK, value jsonb, updated_at timestamptz)
--     Generic cron sentinel store. First user: the daily-cap circuit
--     breaker (key='poll_live_daily_cap_tripped'). Value carries the UTC
--     date the trip happened so isDailyCapTripped() returns true ONLY when
--     the stored trippedFor matches today's UTC date — auto-clear at UTC
--     midnight without TTL machinery.
--
-- Both are nullable / non-destructive adds. ADD COLUMN with no default is
-- instant on Postgres 11+; CREATE TABLE IF NOT EXISTS is idempotent.
-- ============================================================================

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS timer_forced_final_at timestamptz;

COMMENT ON COLUMN matches.timer_forced_final_at IS
  'NULL when status=''final'' came from an API-Sports FT response (normal path). Non-null when the stuck-live sweep (lib/stuckLiveSweep.js) forced the flip after kickoff_at + 180min with no API confirmation. Set to the timestamp of the forced flip. Used downstream to re-resolve from real API data once quota is restored.';

CREATE TABLE IF NOT EXISTS cron_state (
  key        text PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cron_state IS
  'Generic key/value store for cron sentinels. First consumer: daily-cap circuit breaker (key=''poll_live_daily_cap_tripped'', value={trippedFor: ''YYYY-MM-DD'', trippedAt: timestamp}). Use sparingly — this isn''t a config table.';
