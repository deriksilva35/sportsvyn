-- 146_morning_email_pref.sql - the reader's own Morning email switch at /you (thu-1 ruling).
--
-- users.morning_email:
--   NULL   the rule decides: played in the last 30 days, or the account is under
--          14 days old (lib/email/morningAudience.js);
--   true   turned ON at /you - mailed even when dormant;
--   false  turned OFF at /you - never mailed, whatever the rule says.
-- A global unsubscribe (email_opted_out_at) and a hard bounce still win over true.
-- UNDO: ALTER TABLE users DROP COLUMN morning_email;
ALTER TABLE users ADD COLUMN IF NOT EXISTS morning_email boolean;
