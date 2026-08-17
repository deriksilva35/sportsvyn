-- 068_weekly_practice_preset.sql — "The Weekly Six": the ranked format, unranked.
--
-- WHY A PRESET ROW AND NOT A CONSTANT. StartForm starts a preset through
-- startDraftFor(presetId), which loads the config from draft_configs by id, so a
-- synthetic preset with no row could not be started. Free like every preset;
-- the members-only gate is on the CUSTOM console, not on the deck.
--
-- NO NEW UPSTREAM COST. lib/fantasy/config.js caps the daily ADP snapshot at
-- four (scoringFormat, teamsCount) pairs as gentle-client discipline toward FFC.
-- This preset is ppr/12, which is already LAUNCH_PRESET_PAIRS[0] - the pool it
-- drafts against is the one the snapshot already fetches. A preset on a fifth
-- pair would have needed that cap raised deliberately.
--
-- IT MUST MATCH lib/draft/contest.js DRAFT_CONFIG EXACTLY, because the whole
-- point is rehearsing the ranked format. There is no way to make a SQL file and
-- a JS constant share a definition, so the link is a test:
-- lib/draft/preset.test.mjs reads this row and asserts it against DRAFT_CONFIG.
-- If the ranked format changes and this does not, that test fails.
--
-- 8 ROUNDS, NOT 6 - RULED. An early spec described the ranked format as six
-- rounds, matching the six-slot lineup. They are different numbers:
-- 8 picks feed a best-6; the lineup grammar is scoring law, not draft law.
-- The draft is deliberately larger than the lineup, and that gap is the
-- construction game. See lib/draft/contest.js for the full reasoning; this
-- preset follows the shipped contest, since a practice format that differs
-- from the ranked one would be the opposite of rehearsal.

INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots,
                           pick_timer_seconds, is_preset, source)
SELECT NULL, 'The Weekly Six', 12, 'ppr',
       '{"QB":1,"RB":2,"WR":3,"TE":1,"FLEX":1}'::jsonb, 30, true, 'launch'
WHERE NOT EXISTS (
  SELECT 1 FROM draft_configs WHERE is_preset = true AND name = 'The Weekly Six'
);
