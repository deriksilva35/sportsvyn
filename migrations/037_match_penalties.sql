-- 037_match_penalties.sql
-- Penalty-shootout capture for knockout matches.
--
-- Two nullable integer columns hold the shootout score for matches decided
-- on penalties. home_score/away_score keep the end-of-regulation/ET score;
-- these hold the shootout tally. NULL means "no shootout" (every group-stage
-- match and any KO decided in regulation/ET).
--
-- Reversible: DROP COLUMN home_penalties, away_penalties. No backfill — no
-- knockout match has been played yet (first R32 is 2026-06-28).

ALTER TABLE matches ADD COLUMN IF NOT EXISTS home_penalties integer;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS away_penalties integer;
