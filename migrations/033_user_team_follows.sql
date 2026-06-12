-- ============================================================================
-- Migration 033 — user_team_follows
-- ============================================================================
-- Purpose: Per-user team follows for the My Sportsvyn track. Copy of the
--          existing tag_follows shape (migration 011's general-follows
--          pattern), swapping tag_id → team_id.
--
-- Schema notes:
--   · users."id" needs the camelCase-quoted form per the @auth/pg-adapter
--     convention (migration 026's adapter tables). teams.id is plain
--     snake-cased. Both are INTEGER SERIAL PKs.
--   · ON DELETE CASCADE on both FKs — if a user is deleted, their
--     follows go with them; if a team is hard-deleted (rare, but possible
--     if a duplicate-slug team is consolidated), the follow rows go too.
--   · notification_pref carries over from tag_follows for schema symmetry
--     and forward-compat with a future notify-on-follow feature. UNUSED in
--     the launch slice — follow and notify are deliberately separate
--     concerns. Stays nullable; no default.
--   · Composite PK (user_id, team_id) — natural uniqueness, no surrogate
--     id column. Mirrors tag_follows exactly.
--   · The descending followed_at index supports the My Sportsvyn list view
--     (most-recently-followed first) without a separate sort step.
-- ============================================================================

CREATE TABLE user_team_follows (
  user_id            INTEGER     NOT NULL REFERENCES users("id") ON DELETE CASCADE,
  team_id            INTEGER     NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  followed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  notification_pref  TEXT,
  PRIMARY KEY (user_id, team_id)
);

CREATE INDEX idx_user_team_follows_user
  ON user_team_follows(user_id, followed_at DESC);
