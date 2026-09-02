-- ============================================================================
-- 086_college_pool.sql — college players in the SAME pool and the SAME board.
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 085 is the highest in the tree, so
-- this is 086. (081 is doubled - 081_news_feeds_seed and 081_news_items - so
-- the count of files is not the number; the highest name is.) Scanned the
-- target object on BOTH databases first: sim_player_pool has `source` from 083
-- and has NEITHER `league` NOR `ncaaf_adp` on DEV (1,976 rows) or PROD (32,281
-- rows), and the only unique constraint on it is
-- sim_player_pool_snapshot_format_teams_player_source_key from 083.
--
-- THE RULING THIS ENCODES. College players are not a second board. They sit in
-- the same pool, on the same snake, at a placement below every NFL player, and
-- the reader filters to NCAA to see them. So they must be ONE source's rows,
-- distinguishable from the NFL rows beside them - which is a different fact
-- from `source`, and needs its own column rather than a fifth source value.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. sim_player_pool.league
--
-- NOT A NEW `source` VALUE, AND THIS IS THE WHOLE DISTINCTION. source says
-- WHERE THE ROW CAME FROM ('ffc', 'fantrax'); league says WHICH POPULATION IT
-- DESCRIBES ('nfl', 'ncaaf'). They are orthogonal, and collapsing them breaks
-- the ruling in the most literal way available: drafts.js:155 loads a board
-- with `WHERE source = $1`, so a college row filed under source='fantrax-ncaaf'
-- would be EXCLUDED from the very board it is supposed to be on. One board
-- means one source and two leagues.
--
-- DEFAULT 'nfl' AND NOT NULL, the same argument 083 made for source: every row
-- in the table today describes an NFL player, so saying so explicitly costs
-- nothing and removes a question. There is no 'unknown' league.
-- ---------------------------------------------------------------------------
ALTER TABLE sim_player_pool ADD COLUMN IF NOT EXISTS league text NOT NULL DEFAULT 'nfl';

ALTER TABLE sim_player_pool DROP CONSTRAINT IF EXISTS sim_player_pool_league_check;
ALTER TABLE sim_player_pool
  ADD CONSTRAINT sim_player_pool_league_check CHECK (league IN ('nfl', 'ncaaf'));

-- THE UNIQUE KEY GAINS league, FOR 083'S OWN REASON. 083 added source to this
-- key because "both id spaces are short opaque strings, so a collision is a
-- coincidence away rather than impossible". The two Fantrax id spaces are the
-- SAME SHAPE as each other - NFL "05rnx" against NCAAF "06k5i" - and they now
-- share a source value, so without league in the key a college player whose
-- fantraxId collided with an NFL one would upsert over him.
--
-- MEASURED, and deliberately NOT relied upon: of the 997 rows getAdp('NCAAF')
-- serves today, ZERO ids appear in the NFL id table. That is the provider's
-- current arrangement, not a guarantee it owes us, and the ingest must not be
-- built on it.
ALTER TABLE sim_player_pool
  DROP CONSTRAINT IF EXISTS sim_player_pool_snapshot_format_teams_player_source_key;
ALTER TABLE sim_player_pool
  ADD CONSTRAINT sim_player_pool_snapshot_format_teams_player_source_league_key
  UNIQUE (snapshot_date, scoring_format, teams_count, ffc_player_id, source, league);

-- ---------------------------------------------------------------------------
-- 2. sim_player_pool.ncaaf_adp — the college market price, kept OFF `adp`.
--
-- A SEPARATE COLUMN IS THE CONTAINMENT. `adp` is a board position and the
-- engine reads it everywhere: it orders `available`, it sets board par
-- (engine.js:544), and in an adp-temperature room it sets T for every
-- candidate. The NCAAF ADP is a DISPLAY AND SORT value for the NCAA filter and
-- must never be any of those things - Caleb Hawkins prices at 3.78 on the
-- college board and would, in `adp`, be the fourth pick of the draft.
--
-- Two columns rather than one is what makes that structural instead of
-- disciplinary: there is no code path that can confuse them, because the wrong
-- one is not there to be read.
--
-- NULL FOR EVERY NFL ROW, which is true rather than lazy: an NFL player has no
-- college ADP, and a 0 or a 999 would be a number the NCAA sort could act on.
-- ---------------------------------------------------------------------------
ALTER TABLE sim_player_pool ADD COLUMN IF NOT EXISTS ncaaf_adp numeric;

COMMENT ON COLUMN sim_player_pool.league IS
  'Which population this row describes: ''nfl'' or ''ncaaf''. Orthogonal to source (WHERE the row came from) - a Fantrax import writes both leagues under source=''fantrax'', onto one board.';
COMMENT ON COLUMN sim_player_pool.ncaaf_adp IS
  'Fantrax getAdp(sport=NCAAF).ADP_PPR: the college market price. DISPLAY AND SORT ONLY, inside the NCAA filter. Never a board position and never read by the engine - `adp` carries the derived placement instead. NULL on every nfl row.';
COMMENT ON COLUMN sim_player_pool.adp IS
  'Board position, and the only ADP the engine reads. For league=''ncaaf'' this is a DERIVED PLACEMENT (10000 + rank by NCAAF ADP), not a provider fact - Fantrax serves no overall rank on any endpoint. See lib/fantrax/import.js.';

-- ---------------------------------------------------------------------------
-- VERIFY (run against DEV first, then PROD):
--
--   SELECT league, count(*), count(ncaaf_adp) FROM sim_player_pool GROUP BY 1;
--     -- expect: nfl <all existing rows> with 0 ncaaf_adp; no ncaaf rows yet.
--   SELECT conname FROM pg_constraint
--    WHERE conrelid='sim_player_pool'::regclass AND contype='u';
--     -- expect: sim_player_pool_snapshot_format_teams_player_source_league_key
--   INSERT INTO sim_player_pool
--     (snapshot_date,scoring_format,teams_count,ffc_player_id,name,position,adp,source,league)
--     VALUES ('2026-09-01','ppr',12,'05rnx','Collision Probe','RB',10000,'fantrax','ncaaf');
--     -- expect: SUCCEEDS despite 05rnx already existing under league='nfl'.
--     -- Then: DELETE FROM sim_player_pool WHERE name='Collision Probe';
--   INSERT ... league='xx';   -- expect: violates sim_player_pool_league_check
-- ---------------------------------------------------------------------------
