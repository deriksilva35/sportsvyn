-- ============================================================================
-- Migration 041 — user_player_follows
-- ============================================================================
-- Purpose: Per-user PLAYER follows for the My Sportsvyn track. Exact mirror of
--          user_team_follows (migration 033), swapping team_id -> player_id.
--
-- Schema notes (identical to 033):
--   · users."id" needs the camelCase-quoted form per the @auth/pg-adapter
--     convention. players.id is plain snake-cased. Both INTEGER SERIAL PKs.
--   · ON DELETE CASCADE on both FKs.
--   · notification_pref carries over for schema symmetry; UNUSED in the launch
--     slice. Nullable, no default.
--   · Composite PK (user_id, player_id) — natural uniqueness, no surrogate id.
--   · Descending followed_at index supports the "most-recently-followed first"
--     list view without a separate sort.
-- ============================================================================

CREATE TABLE user_player_follows (
  user_id            INTEGER     NOT NULL REFERENCES users("id")  ON DELETE CASCADE,
  player_id          INTEGER     NOT NULL REFERENCES players(id)  ON DELETE CASCADE,
  followed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  notification_pref  TEXT,
  PRIMARY KEY (user_id, player_id)
);

CREATE INDEX idx_user_player_follows_user
  ON user_player_follows(user_id, followed_at DESC);
