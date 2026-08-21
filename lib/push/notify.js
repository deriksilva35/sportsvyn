// lib/push/notify.js - fire one event to every live device, exactly once.
//
// ============================================================================
// THE LEDGER ROW IS WRITTEN BEFORE THE SEND - "ledger-inversion"
// ============================================================================
// The welcome mail records after sending; a push cannot, because the crons
// that fire these tick every 15 minutes and a crash between send and record
// would replay the event to every device on the next tick. So the order is
// INVERTED: claim the event id in sync_runs first, send only if the claim
// was won, finish the row with counts. A crash mid-send leaves a 'sending'
// row that blocks replay until STUCK_AFTER_MINUTES passes - the failure mode
// is "some devices missed one push", never "every device got it twice",
// and that is the right way round for a courtesy.
//
// SEND-ONCE IS KEYED ON THE EVENT ID ('daily-revealed:2026-08-19'), not on
// tokens: delivery to individual devices is fail-soft and unrecorded per
// device, because the per-device fact that matters - a dead token - is
// recorded where it lives, as revoked_at on the token row.
//
// EVERYTHING HERE IS A NO-OP UNTIL PUSH_ENABLED=1 and the APNs env is
// complete. The hooks in the crons call this unconditionally; this is the
// single gate.

import { sql } from '../db.js';
import { apnsConfig, sendToToken, alertPayload } from './apns.js';
import { copyFor } from './copy.js';

const SOURCE = 'push';
const STUCK_AFTER_MINUTES = 10;

/**
 * Claim-then-send. Safe to call every tick with the same eventId.
 * @returns {{sent: number, gone: number, failed: number}|{skipped: string}}
 */
export async function notifyEvent(eventId) {
  const cfg = apnsConfig();
  if (!cfg.enabled) return { skipped: 'push disabled' };

  const copy = copyFor(eventId);
  if (!copy) return { skipped: `no copy for ${eventId}` };

  // ---- the claim ----------------------------------------------------------
  // INSERT ... WHERE NOT EXISTS, not ON CONFLICT: sync_runs has no unique
  // index on the event id and does not need one - every caller sits behind
  // its cron's advisory lock, so the race this guards is between TICKS, not
  // between concurrent writers.
  const claimed = await sql`
    INSERT INTO sync_runs (source, kind, started_at, ok, summary)
    SELECT ${SOURCE}, 'event', now(), true,
           ${JSON.stringify({ eventId, outcome: 'sending' })}::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM sync_runs
        WHERE source = ${SOURCE} AND summary->>'eventId' = ${eventId}
          AND (summary->>'outcome' = 'sent'
               OR (summary->>'outcome' = 'sending'
                   AND started_at > now() - (${STUCK_AFTER_MINUTES} || ' minutes')::interval)))
    RETURNING id`;
  if (claimed.length === 0) return { skipped: 'already sent' };
  const rowId = claimed[0].id;

  // ---- the fan-out --------------------------------------------------------
  const tokens = await sql`
    SELECT token FROM device_tokens WHERE revoked_at IS NULL`;
  const payload = alertPayload(copy);

  let sent = 0; let gone = 0; let failed = 0;
  for (const { token } of tokens) {
    const r = await sendToToken(cfg, token, payload);
    if (r.ok) { sent += 1; continue; }
    if (r.gone) {
      // APNs said this device is dead. Revoked, not deleted - the row is the
      // record of when it died, and revive-in-place clears it on re-register.
      await sql`UPDATE device_tokens SET revoked_at = now() WHERE token = ${token}`.catch(() => {});
      gone += 1;
      continue;
    }
    failed += 1;
  }

  await sql`
    UPDATE sync_runs SET finished_at = now(), ok = true,
           summary = ${JSON.stringify({ eventId, outcome: 'sent', sent, gone, failed, devices: tokens.length })}::jsonb
     WHERE id = ${rowId}`;
  return { sent, gone, failed };
}

// ---------------------------------------------------------------------------
// THE THREE HOOKS. Each derives its own event ids from state and calls
// notifyEvent per id; send-once makes every one of them safe on a 15-minute
// tick, which is the whole design - no cron is pinned to an instant, the row
// decides (the daily-close lesson, applied to push).
// ---------------------------------------------------------------------------

/**
 * Daily board LIVE - any board whose opens_at passed within the lookback and
 * has not been announced. The lookback bounds the blast radius of a long
 * outage: better to silently miss announcing one board than to announce
 * yesterday's at noon.
 */
export async function notifyDailyLive() {
  const rows = await sql`
    SELECT puzzle_date FROM puzzle_days
     WHERE opens_at <= now() AND opens_at > now() - interval '2 hours'
       AND NOT revealed`;
  const out = [];
  for (const r of rows) out.push(await notifyEvent(`daily-live:${r.puzzle_date}`));
  return out;
}

/** Daily REVEALED - called with the dates daily-close just closed. */
export async function notifyDailyRevealed(dates) {
  const out = [];
  for (const d of dates ?? []) out.push(await notifyEvent(`daily-revealed:${d}`));
  return out;
}

/**
 * Pick 'em board open - called by the pickem-board cron on the one fire that
 * actually creates (relay 4 closed the caller gap the relay-1 recon named).
 */
export async function notifyPickemOpen(boardId) {
  return notifyEvent(`pickem-open:${boardId}`);
}

/**
 * Pick 'em lock reminder - KEYED TO THE NEXT KICKOFF: any open, unsettled
 * board whose first kickoff (locks_at, the snapshotted "day begins" moment)
 * sits within the next two hours gets ONE reminder, ever - the send-once key
 * is the board id, and the 2h window plus the lookback-free future bound
 * means a board announced late is skipped, not announced at noon (the
 * notifyDailyLive lesson). Rides daily-close's 15-minute tick.
 */
export async function notifyPickemReminder() {
  const rows = await sql`
    SELECT id FROM contests
     WHERE game_type = 'pickem' AND NOT settled
       AND opens_at <= now()
       AND locks_at > now() AND locks_at <= now() + interval '2 hours'`;
  const out = [];
  for (const r of rows) out.push(await notifyEvent(`pickem-reminder:${r.id}`));
  return out;
}

/** Pick 'em settled - called by pickem-settle with the ids it just graded. */
export async function notifyPickemSettled(boardIds) {
  const out = [];
  for (const id of boardIds ?? []) out.push(await notifyEvent(`pickem-settled:${id}`));
  return out;
}
