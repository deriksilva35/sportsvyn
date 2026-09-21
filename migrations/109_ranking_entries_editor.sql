-- 109_ranking_entries_editor.sql — GRIDIRON POWER RANKINGS: the editor's layer.
--
-- WHAT 108 LEFT OUT. Migration 108 gave ranking_entries the computed side of a
-- gridiron board: an Elo rating, its three-game change, the AP rank and the
-- curve that turns it into a score. Every one of those is a fact about games
-- that have been played. None of them is a judgement, and a power ranking that
-- is only arithmetic is a standings table with extra steps.
--
-- THE EDITOR'S 25 IS THE JUDGEMENT. content/power/cfb-<season>-w<week>.md is a
-- plain list - rank, team, twenty-five lines - written by a person before each
-- edition. It enters the composite as a dimension beside the Elo-derived
-- result score, and the two are averaged flat: the model and the editor get an
-- equal say about the teams the editor named, and the model has the only say
-- about the 113 it did not.
--
-- TWO COLUMNS, NOT ONE. editor_rank is what the file said; editor_score is
-- that rank through lib/rankings/sitesLayer.js normalizeRankToScore(rank, 25),
-- the same power-floor curve the AP rank goes through and over the same
-- 25-team field, because it IS a 25-team field. Storing both means a reader
-- can see the rank a person actually wrote as well as the number it became,
-- and a change to the curve is visible as a change in one column and not the
-- other.
--
-- WHY NOT REUSE ap_rank / ap_score. They answer a different question and can
-- disagree on purpose - the whole point of showing both is that the editor may
-- have a team ninth that the AP has fifteenth. Overloading one pair of columns
-- would make that disagreement unrepresentable.
--
-- NULL IS THE COMMON CASE AND IT IS NOT A GAP. 113 of 138 FBS teams are not in
-- anybody's 25, and every NFL row is null by construction - there is no editor
-- file for the NFL. A null editor_score means the composite is the result
-- dimension alone, which publishGridironEdition.js does explicitly rather than
-- by treating null as a zero.
--
-- IDEMPOTENT, like 108: ADD COLUMN IF NOT EXISTS, so a re-run is a no-op.

ALTER TABLE ranking_entries
  ADD COLUMN IF NOT EXISTS editor_rank  INTEGER,
  ADD COLUMN IF NOT EXISTS editor_score NUMERIC(4,2);

COMMENT ON COLUMN ranking_entries.editor_rank IS
  'The rank a person gave this team in the edition''s editor file (content/power/<league>-<season>-w<week>.md), 1-25, or NULL when the editor did not rank them. Stored as written, so the published edition keeps saying what the editor said on the day even after the next week''s file replaces it. NULL on every NFL row: there is no editor file for the NFL.';

COMMENT ON COLUMN ranking_entries.editor_score IS
  'editor_rank through lib/rankings/sitesLayer.js normalizeRankToScore(editor_rank, 25) - the power-floor curve, 0-10, over a 25-team field because the editor''s list IS a 25-team field. It is one of the two dimensions the editorial composite averages, the other being the Elo-derived result score; below the editor''s 25 the composite is result alone. NULL wherever editor_rank is NULL, and an unranked team therefore contributes no editorial term rather than a fabricated floor.';
