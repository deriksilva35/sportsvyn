-- 124_users_date_of_birth.sql - the age screen's answer (age-gate, fri-5).
--
-- WHAT IT HOLDS. The date of birth a reader gave on the neutral age screen
-- (/age). It is written ONCE, only for a reader who is 13 or older on the day
-- they answer - an under-13 answer is never stored: the account is deleted in
-- the same request (lib/auth/ageGateDb.js) and nothing about the date survives.
--
-- WHY A FULL DATE AND NOT A BOOLEAN. 18+ prize eligibility is coming and will
-- need the date itself; asking again later would be a second prompt to every
-- reader. Not built now.
--
-- NULL MEANS "NOT ASKED YET". Every account that predates this migration is
-- NULL, and NULL is what the write-door gate refuses (lib/auth/ageGate.js
-- gateVerdict) and what sends a signed-in reader to /age on the next visit.
--
-- PRIVATE, ALWAYS. Never in a public payload, page, API, OG image or board.
-- lib/auth/ageGateDob.test.mjs walks app/, lib/, components/ and auth.js and
-- fails on any file outside its short allowlist that names the column, and
-- auth.js strips it from the session user so the header's RSC payload cannot
-- carry it either.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

COMMENT ON COLUMN users.date_of_birth IS
  'Self-reported on the age screen; written once, only when 13+. NULL = not asked yet (blocked from play). PRIVATE: never in any public payload.';
