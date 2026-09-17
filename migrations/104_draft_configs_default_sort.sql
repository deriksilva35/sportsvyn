-- 104_draft_configs_default_sort.sql — the sort a preset's room opens on.
--
-- WHY A COLUMN AND NOT A JSONB KEY. draft_configs has two jsonb columns and
-- neither is free: `roster_slots` IS the format (every reader of a config
-- derives rounds and slot caps from it, and a stray key there would be counted
-- as a slot by deriveRounds), and `teams` is the Fantrax import's franchise
-- list, written and read as an array of league teams. There is no spare bag to
-- put this in, so it is its own column - plain text, nullable, no default.
--
-- NULL MEANS "THE ROOM DECIDES", which is what every existing row wants: the
-- four launch presets and The Weekly Six open on the board's own order and must
-- keep doing so. Only a row that names a sort changes anything, so this
-- migration cannot move a single room by itself.
--
-- THE VALUE IS A SORT KEY from lib/fantasy/statView.js UNIVERSAL - 'adp',
-- 'ppg', 'points'. It is not validated in SQL on purpose: the list lives in one
-- JS module, a CHECK constraint here would be a second copy of it, and the room
-- already ignores a key it does not offer (see DraftRoom's activeSort). A test
-- pins the seeded value against that module instead.

ALTER TABLE draft_configs ADD COLUMN IF NOT EXISTS default_sort text;

-- NO SEMICOLON INSIDE THE LITERAL. Every naive migration runner in this repo
-- splits a file on ';', and one inside a quoted string cuts the statement in
-- half - which is exactly how this line failed the first time it was applied.
COMMENT ON COLUMN draft_configs.default_sort IS
  'Sort key the room opens on, from lib/fantasy/statView.js UNIVERSAL. NULL means the board order.';
