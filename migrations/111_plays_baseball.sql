-- 111_plays_baseball.sql — the six things a baseball play knows that a
-- football play does not.
--
-- WHY plays AND NOT mlb_plays. A play row is a play row: one game, one
-- provider id, an ordinal, a period, the text, the score after, and whether it
-- scored. Every one of those columns already exists and already means the same
-- thing for baseball - `period` IS the inning. What differs is six fields, and
-- six nullable columns on a shared table beats a second table whose readers
-- would have to re-implement "the newest play of this game" and "every play in
-- order", which is the read both sports issue.
--
-- THE COST IS HONEST AND SMALL: six nulls on every football row. The
-- alternative - a jsonb detail column - would have been six nulls in a blob
-- plus a per-read parse, and would have made "outs" unindexable and
-- untypecheckable for the sake of not naming it.
--
-- inning_type IS THE HALF AND IT HAS FOUR VALUES, not two: Top, Bottom, Mid
-- and End. Mid and End are the provider's own between-halves markers and are
-- the state a card shows when nobody is batting. Folding them into the half
-- either side would lose exactly the fact a reader wants at that moment.
--
-- batter_id AND pitcher_id ARE THE PROVIDER'S, AS TEXT, and not foreign keys -
-- the same call migration 110 makes for bdl_player_id and for the same reason:
-- there is no mlb_players table yet, and a foreign key to a table that does
-- not exist is a migration that cannot apply.
--
-- NO DEFAULTS. outs 0 and a count of 0-0 are REAL STATES - the start of an
-- at-bat - so a default of 0 would be indistinguishable from "the provider did
-- not say". NULL means unknown, 0 means nobody out.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS throughout.

ALTER TABLE plays
  ADD COLUMN IF NOT EXISTS inning_type TEXT,
  ADD COLUMN IF NOT EXISTS outs        INTEGER,
  ADD COLUMN IF NOT EXISTS balls       INTEGER,
  ADD COLUMN IF NOT EXISTS strikes     INTEGER,
  ADD COLUMN IF NOT EXISTS batter_id   TEXT,
  ADD COLUMN IF NOT EXISTS pitcher_id  TEXT;

COMMENT ON COLUMN plays.inning_type IS
  'Baseball only: the half of the inning, from the provider''s own field. FOUR values, not two - Top, Bottom, Mid, End - where Mid and End are the between-halves states a card shows when nobody is batting. NULL on every football row, where `period` is a quarter and has no halves.';

COMMENT ON COLUMN plays.outs IS
  'Baseball only: outs AS OF THIS PLAY, 0-2. NO DEFAULT - 0 is a real state (the start of a half) and a default would make it indistinguishable from "the provider did not say". NULL means unknown.';

COMMENT ON COLUMN plays.balls IS
  'Baseball only: balls in the count as of this play. 0 is a real count; NULL is unknown. See plays.outs.';

COMMENT ON COLUMN plays.strikes IS
  'Baseball only: strikes in the count as of this play. 0 is a real count; NULL is unknown. See plays.outs.';

COMMENT ON COLUMN plays.batter_id IS
  'Baseball only: the provider''s player id for the batter, as text. NOT a foreign key - there is no mlb_players table yet, the same call migration 110 makes for bdl_player_id.';

COMMENT ON COLUMN plays.pitcher_id IS
  'Baseball only: the provider''s player id for the pitcher, as text. NOT a foreign key - see plays.batter_id.';

CREATE INDEX IF NOT EXISTS plays_match_inning_idx
  ON plays (match_id, period, inning_type) WHERE inning_type IS NOT NULL;
