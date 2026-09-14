-- 101_users_is_house.sql - the house flag.
--
-- FIVE SPORTSVYN-LABELLED ACCOUNTS play the games alongside everybody else,
-- and every leaderboard has to be able to say so. This is the whole schema
-- change: one boolean on users, defaulting false, so every existing row and
-- every future signup is a person unless something deliberately says
-- otherwise.
--
-- WHY A BOOLEAN AND NOT A PERSONA COLUMN. The five also need a persona key
-- and a method line per game, and those are COPY - they belong in a diff a
-- human reads (lib/house/personas.js), not in rows somebody has to query to
-- review. The flag is the only thing the database needs to answer, and the
-- question it answers is "is this row the house", which is a boolean.
--
-- NOT NULL DEFAULT false is safe on this table at its current size (252 rows)
-- and Postgres has not rewritten a table for a non-volatile default since 11.
--
-- NO INDEX. Five rows out of 252, and every reader that wants the flag is
-- already joining users by primary key for the handle. An index here would be
-- a thing to maintain that nothing would ever use.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_house boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_house IS
  'Sportsvyn house account - a labelled persona that plays the games. Never a person. See lib/house/personas.js.';
