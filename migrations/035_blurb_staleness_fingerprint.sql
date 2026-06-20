-- migrations/035_blurb_staleness_fingerprint.sql
-- Staleness fingerprint column on editorial_blurbs.
--
-- The fingerprint is a per-player, league-scoped integer:
--   COUNT(*) of match_events rows where (player_api_id = player.api OR
--   assist_api_id = player.api) AND is_current = true AND match_id in
--   the player's league.
--
-- It is computed by the writer at blurb insert time and re-computed
-- inside getPlayerRankingsForPage at render time. The reader's LEFT JOIN
-- on editorial_blurbs adds:
--   AND (b.approved_against_fingerprint IS NULL
--        OR b.approved_against_fingerprint = current_fingerprint)
-- NULL = legacy/unstamped row, shown (fail-safe toward visible
-- editor-approved prose). Stamped-but-mismatched = staleness, hidden
-- (the card renders bare automatically).
--
-- Phase 1 covers the player-power list (the in-tournament reader);
-- team-power continues to render blurbs without the staleness guard
-- until Phase 2 extends the team reader the same way.
--
-- Idempotent: safe to replay against PROD or DEV.

ALTER TABLE editorial_blurbs
  ADD COLUMN IF NOT EXISTS approved_against_fingerprint integer;
