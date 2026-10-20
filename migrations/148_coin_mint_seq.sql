-- 148_coin_mint_seq.sql - ONE MINT PER COIN COUNT (coins-2, after 147).
--
-- The mint's lock (lib/pollers/lock.js) degrades to running UNLOCKED when its
-- connection fails, and two runs that read the same meter would both mint.
-- seq = the user's coins ever minted after this row (147's rows: none exist on
-- PROD). Two runs computing the same mint compute the same seq, and the second
-- INSERT hits UNIQUE (user_id, seq) and does nothing.
-- UNDO: ALTER TABLE coin_mint DROP COLUMN seq;
ALTER TABLE coin_mint ADD COLUMN IF NOT EXISTS seq integer;
UPDATE coin_mint m SET seq = s.seq
  FROM (SELECT id, sum(qty) OVER (PARTITION BY user_id ORDER BY id)::int AS seq FROM coin_mint) s
 WHERE s.id = m.id AND m.seq IS NULL;
ALTER TABLE coin_mint ALTER COLUMN seq SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_coin_mint_user_seq ON coin_mint (user_id, seq);
