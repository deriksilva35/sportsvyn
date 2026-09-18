-- 106_token_strikes_and_cron_ledger.sql - a rejected token stops coming back,
-- and a cron push leaves the same evidence a game push does.
--
-- ============================================================================
-- THE INCIDENT, 15-18 SEP 2026
-- ============================================================================
-- Derik's phone registered token 09D6170D... on 15 Sep and received nothing
-- for three days. APNs rejected it with 400/BadDeviceToken on every event.
-- Every part of the revocation machinery worked: apns.js computed gone,
-- senders.js passed it through, dispatch.js stamped revoked_at. And every
-- morning the app launched, called /api/push/register, and the upsert's
-- `revoked_at = NULL` brought the dead token back to life.
--
-- So the row was revoked and revived, revoked and revived, for three days,
-- and NOTHING RECORDED THAT THIS HAD HAPPENED BEFORE. revoked_at holds one
-- timestamp; a token that dies nightly looks exactly like one that died once.
--
-- ============================================================================
-- 1. device_tokens.strikes / last_rejected_at - THE MEMORY REVIVE-IN-PLACE LACKED
-- ============================================================================
-- strikes counts CONSECUTIVE rejections: a gone response increments it, a 200
-- resets it to 0. Register revives a token only while strikes < 2. At two the
-- row stays revoked and the app is told 'token_rejected' rather than ok.
--
-- WHY TWO AND NOT ONE. A single rejection can be a transient APNs answer or a
-- token caught mid-reissue, and refusing a device after one bad night would be
-- worse than the bug. Two consecutive rejections with no successful send in
-- between is not transient - 09D6170D... had eleven.
--
-- WHY THIS CANNOT STRAND A DEVICE. A phone whose token is genuinely dead gets
-- a NEW token string from APNs when the app is reinstalled or re-permissioned
-- - which is exactly what happened at 01:15 on 18 Sep, when 73AC73E8... was
-- registered and took every push since. Strikes are per TOKEN, and a new token
-- is a new row with zero. The refusal blocks the corpse, never the device.
--
-- DEFAULT 0 AND NOT NULL: every existing row is presumed healthy, which is
-- true of all 50 live tokens except the one we already know about.
--
-- ============================================================================
-- 2. push_sends.match_id BECOMES NULLABLE - THE CRON LOOP GETS A LEDGER
-- ============================================================================
-- Game alerts write one push_sends row per device: which token, which event,
-- the status code, the APNs reason. That is why tonight's failure was
-- diagnosable in ten seconds. The Daily, the Weekly, Pick'em and the Draft go
-- through notify.js, which sends in a loop and keeps only totals in a
-- sync_runs summary - so "sent 49, failed 0" was the whole record, and three
-- days of one device receiving nothing was invisible in it.
--
-- The rows are the same shape; a cron event simply has no match. match_id
-- drops NOT NULL and the existing FK stays (NULL satisfies a foreign key).
-- push_sends_once is UNIQUE on (device_token, event_key) and event ids are
-- already unique per event, so the cron loop inherits send-once for free.

ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS strikes integer NOT NULL DEFAULT 0;
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS last_rejected_at timestamptz;

COMMENT ON COLUMN device_tokens.strikes IS
  'Consecutive APNs rejections. A successful send resets it to 0. Register refuses to revive at 2 or more.';
COMMENT ON COLUMN device_tokens.last_rejected_at IS
  'When APNs last rejected this token. Kept after a reset, as history.';

ALTER TABLE push_sends ALTER COLUMN match_id DROP NOT NULL;

COMMENT ON COLUMN push_sends.match_id IS
  'The game this push was about, or NULL for a cron event (the Daily, Weekly, Pickem, Draft).';
