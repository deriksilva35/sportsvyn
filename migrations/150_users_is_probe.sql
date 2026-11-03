-- 150_users_is_probe.sql - the crew lobby-probe account flag.
--
-- ONE ACCOUNT ON PROD IS A MACHINE, NOT A PERSON: the crew's lobby probe
-- (crew/bin/lobby-probe) signs in as it with a long-lived session token and
-- loads GET / every few minutes to prove the lobby renders for a signed-in
-- reader. Its row is created by scripts/crew-probe-account.mjs and is the only
-- row this flag is ever true on. It never enters a contest, so every
-- entry-based board skips it by construction; what the flag is FOR is the
-- readers that count the users table or pick who gets an email or a push -
-- they filter `NOT is_probe` (docs/reports/2026-11-03-probe-exclusion.md).
--
-- NOT is_house. 101's flag is a LABELLED persona that plays the games in the
-- open and is shown on boards as the house. The probe is the opposite: never
-- shown, never counted, never mailed. Reusing the house flag would put it on
-- the leaderboards.
--
-- NOT NULL DEFAULT false: every existing row and every signup is a person
-- unless something deliberately says otherwise. No index: one row in the
-- table, and every reader that wants the flag already has the users row.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_probe boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_probe IS
  'Crew lobby-probe account - a machine, never a person. Excluded from every count, leaderboard and email/push audience. See scripts/crew-probe-account.mjs.';

-- THE PULSE STATS VIEW (docs/crew/sportsvyn-stats reads crew_stats.users_v, never the
-- base table). Append the flag so the stats script can exclude the probe the way it
-- excludes the house. CREATE OR REPLACE VIEW may only ADD columns at the end, which
-- is all this does; existing grants on the view are kept. A database with no
-- crew_stats schema (a fresh DEV that never ran 143) skips this block.
DO $$
BEGIN
  IF to_regclass('crew_stats.users_v') IS NOT NULL THEN
    CREATE OR REPLACE VIEW crew_stats.users_v AS
      SELECT id, created_at, last_seen_at, coalesce(is_house, false) AS is_house, is_probe FROM public.users;
  END IF;
END $$;
