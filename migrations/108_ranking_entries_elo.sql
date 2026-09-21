-- 108_ranking_entries_elo.sql — GRIDIRON POWER RANKINGS: the computed columns.
--
-- WHAT THIS TABLE ALREADY HELD, AND WHY IT IS NOT ENOUGH. ranking_entries
-- carries 38 columns of editorial machinery — five scored dimensions, a sites
-- layer, weights, movement, blurbs — and the World Cup's team-power board
-- fills all of it. The two GRIDIRON boards do not. nfl-power and cfb-top25
-- were seeded by hand from content/preseason-edition-0.md on 27 Jul 2026, and
-- scripts/seed-preseason-editions.mjs writes their score as
--
--     score = 99.99 - rank
--
-- into BOTH `score` and `editorial_composite`. That number carries no
-- information at all: it is the rank, re-encoded so a DESC sort reproduces
-- rank order. Every gridiron row on PROD today has previous_rank, rank_movement,
-- result_score, process_score, squad_score, momentum_score and sites_composite
-- NULL. There is nothing in the table a second edition could move against.
--
-- THE FIVE COLUMNS BELOW ARE THE COMPUTED SIDE OF THAT BOARD. They are added to
-- ranking_entries rather than given a table of their own for the same reason
-- 075_rankings.sql refused to put the AP poll HERE: the question is whether the
-- rows describe the same THING. An Elo rating and a published editorial rank
-- are two readings of one team in one edition — they are produced together,
-- published together, superseded together, and every reader that wants one
-- wants the other on the same row. A sibling table would be a join that can
-- only ever be 1:1 and a second thing to keep in step when an edition is
-- replaced.
--
-- NUMERIC, NOT DOUBLE PRECISION, and numeric(7,2) not numeric(4,2). The
-- existing score columns are numeric(4,2), which caps at 99.99 — correct for a
-- 0–10 or a 0–100 composite and WRONG for an Elo, which lives around 1500 and
-- reaches ~1800 for a top NFL side. 7,2 holds ±99999.99 with the two decimals
-- the ratings actually carry. elo_delta3 is signed and small but gets the same
-- type so the two are comparable without a cast.
--
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS throughout, so re-running this file on a
-- database that already has it is a no-op rather than an error — the same
-- property every migration in this directory has, and the reason a re-run
-- during a deploy is safe.

ALTER TABLE ranking_entries
  ADD COLUMN IF NOT EXISTS elo         NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS elo_delta3  NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS ap_rank     INTEGER,
  ADD COLUMN IF NOT EXISTS ap_score    NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS inputs      JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN ranking_entries.elo IS
  'The team''s Elo rating at the moment this edition was computed, from lib/ratings/elo.js over every chronological final the league holds. NULL on an editorial (hand-seeded) edition, which has no rating behind it. NOT a score on any 0-10 or 0-100 scale - it is the raw rating, ~1500 at the start of the ladder, and it is stored so a reader can see the number the dimensions were derived FROM rather than only the derived values.';

COMMENT ON COLUMN ranking_entries.elo_delta3 IS
  'Signed change in elo over the team''s last three rated games, the momentum dimension''s raw input. Positive means the team has been gaining rating. NULL when the team has played fewer than one rated game in this edition''s window, or on an editorial edition. Three games is the window the momentum dimension is defined over; a different window would be a different dimension, not a re-tuning of this column.';

COMMENT ON COLUMN ranking_entries.ap_rank IS
  'The team''s rank in the newest AP poll week held at publish time, 1-25, or NULL when the AP does not rank them. CFB ONLY: the NFL has no poll and this column is NULL on every nfl-power row by construction, not by accident. Stored rather than joined so a published edition keeps saying what the poll said on the day it was published, even after the next week''s poll lands.';

COMMENT ON COLUMN ranking_entries.ap_score IS
  'ap_rank put through lib/rankings/sitesLayer.js normalizeRankToScore(ap_rank, 25) - the power-floor curve, 0-10, field size 25 because the AP poll IS a 25-team field. This is the sites-layer value for a gridiron edition; sites_composite stays NULL because there is exactly one source and a mean over one source would imply a blend that does not exist. NULL wherever ap_rank is NULL, and an unranked team therefore contributes no sites term at all rather than a fabricated floor.';

COMMENT ON COLUMN ranking_entries.inputs IS
  'Everything the published number was computed from, frozen at publish time: {elo, delta3, last3:[{opp,result,margin}], ap:{rank,score}|null, weights:{editorial,sites}}. It exists so a reader can expand a row and see the working, and so a disputed rank can be audited months later without re-running the model against data that has since moved. NOT NULL DEFAULT ''{}'' so a hand-seeded or legacy row reads as "no working recorded" rather than as NULL, which every jsonb operator would then have to guard.';
