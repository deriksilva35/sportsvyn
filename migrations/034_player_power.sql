-- migrations/034_player_power.sql
-- Player Power ranking list + stature lookup column.
--
-- These two writes were applied DIRECTLY to PROD on 2026-06-19 ahead of the
-- player-power ed1 publish (PROD ranking_list_id = 2). This file exists for
-- DEV / future-rebuild parity and is idempotent: both statements are safe to
-- replay against any environment.
--
-- On PROD: no-op (the row and column already exist).
-- On DEV / fresh rebuild: creates the row and adds the column.
--
-- Companion: lib/rankings/playerPowerScorer.js (the scorer that produces
-- player composites for this list) and the player-power publish path
-- (separate from team-power's editionRunner, per the publish-writer task).

-- 1) Player Power ranking_lists row
INSERT INTO ranking_lists (
  slug, name, description, league_id, entity_type, list_type,
  composite_type, sort_direction, display_limit, is_active, display_order
) VALUES (
  'player-power',
  'Tournament MVP',
  'Sportsvyn production + impact player composite.',
  1,                  -- fifa-wc-2026
  'player',
  'composite',
  'player_composite', -- CHECK-constraint reserved value for player rubric
  'desc',
  48,
  true,
  0
)
ON CONFLICT (slug) DO NOTHING;

-- 2) Stature lookup column on players.
-- Read by the v5.1 live-rail-card path per tick (fast single-column read);
-- written by the Track 2 deterministic stature backfill (caps + intl goals
-- + age + club tier). NULL until that backfill runs.
ALTER TABLE players ADD COLUMN IF NOT EXISTS current_stature_score numeric(3,2);
