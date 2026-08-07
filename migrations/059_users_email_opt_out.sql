-- 059_users_email_opt_out.sql
--
-- Suppression for account email (the welcome send, and anything after it).
--
--   users.email_opted_out_at  timestamptz NULL  - set when the reader unsubscribes
--
-- WHY A LOCAL COLUMN AND NOT RESEND'S SUPPRESSION LIST
--
-- 1. Resend suppression applies to BROADCASTS to an audience. A transactional
--    send through the API - which is what this is - does not consult it. Relying
--    on it would mean the check silently does nothing, which is the worst kind
--    of suppression: one that looks present in the code and is absent in fact.
--
-- 2. The check runs inside the signup path. A Resend API round trip there adds
--    latency and a second failure mode to the one flow that must not wobble.
--    A column is data we already have in hand when we load the new user.
--
-- 3. An unsubscribe link needs a durable target we own and can query offline.
--    Writing a reader's stated intent only into a third party means we cannot
--    answer "did they opt out?" without the network, and cannot answer it at all
--    if we ever leave that vendor.
--
-- The cost is two places a reader could be suppressed if they ALSO unsubscribe
-- inside Resend. That is accepted for v1 and is the right way round: this column
-- is authoritative for whether WE send, and Resend remains authoritative for
-- whether IT delivers.
--
-- NULL means "has not opted out" - the honest default for every existing row,
-- and no backfill is needed or wanted. A timestamp rather than a boolean so the
-- record says WHEN, which is what a consent question actually asks.
--
-- Reversible: ALTER TABLE users DROP COLUMN email_opted_out_at;

ALTER TABLE users ADD COLUMN email_opted_out_at timestamptz;

COMMENT ON COLUMN users.email_opted_out_at IS
  'When this reader opted out of account email. NULL means they have not. '
  'Authoritative for whether WE send; Resend remains authoritative for delivery.';
