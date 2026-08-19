-- 071: "The Weekly Six" preset becomes The Weekly's actual six.
--
-- THE PRESET WAS REHEARSING THE WRONG GAME. It shipped (068) as practice for
-- The Draft's ranked room - QB/RB2/WR3/TE/FLEX, eight rounds - and the drift
-- test pinned it to exactly that, so the wrongness was load-bearing: the name
-- said The Weekly, the shape said The Draft, and the test enforced the
-- mismatch. Ruled 19 Aug: a preset named The Weekly Six practices THE WEEKLY -
-- six picks, The Weekly's own slots (lib/weekly/rules.js SLOTS: QB, RB, WR,
-- TE, FLEX, FLEX2 -> one each plus two flexes).
--
-- The Draft's 8-round law is untouched: that is contest 3's shape, held by
-- DRAFT_CONFIG in lib/draft/contest.js, and its own tests still assert it.
-- Scoring stays PPR (The Weekly is PPR drop-worst) and the room stays 12
-- teams - a practice mock needs opponents; The Weekly itself has none.

UPDATE draft_configs
   SET roster_slots = '{"QB":1,"RB":1,"WR":1,"TE":1,"FLEX":2}'::jsonb
 WHERE is_preset = true AND name = 'The Weekly Six';
