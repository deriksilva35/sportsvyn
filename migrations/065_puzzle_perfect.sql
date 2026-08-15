-- 065_puzzle_perfect.sql — the perfect lineup gets its own column.
--
-- WHY NOT INSIDE board jsonb. The first cut merged it with
-- `board || jsonb_build_object('__perfect', ...)`, which is wrong in a way that
-- type-checks: board is a jsonb ARRAY, and `array || object` in Postgres
-- APPENDS the object as an element rather than merging it. The perfect lineup -
-- which carries every player's score - would have become a 65th entry in the
-- player list. Verified before it shipped:
--
--   '[{"id":1}]'::jsonb || jsonb_build_object('__perfect', ...)
--     -> [{"id":1},{"__perfect":{...}}]
--
-- A column says what it is, cannot be confused for a player, and makes the
-- "is this day closed" read a NULL check rather than a key probe.
--
-- Computed ONCE at close rather than per reader: brute force is ~300ms on a
-- 64-player board, and storing it means the badge a player screenshots cannot
-- drift from the one the next reader sees.

ALTER TABLE puzzle_days ADD COLUMN IF NOT EXISTS perfect jsonb;

COMMENT ON COLUMN puzzle_days.perfect IS
  'The optimal six-slot lineup and its drop-worst total, brute-forced once at close. NULL until revealed.';
