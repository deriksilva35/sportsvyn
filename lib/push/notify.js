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
import { DAILY_V2_EPOCH } from '../daily/seasonBoardEditions.js';

const SOURCE = 'push';
const STUCK_AFTER_MINUTES = 10;

/** Today's ET date, Postgres-computed - the same boundary DAILY_V2_EPOCH is stated in. */
async function todayEtHere() {
  const [{ d }] = await sql`SELECT to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d`;
  return d;
}

/**
 * Every live device token, optionally excluding a device whose OWNER has
 * switched every game they follow off (alert_prefs.master = false on every
 * row they have). Exported so a caller can inspect the audience directly
 * (v2's tick test does exactly this) rather than only through a full send.
 *
 * excludeMasterOff DEFAULTS FALSE - v1's own calls never pass it, so v1's
 * audience is byte-identical to before this existed. THE PER-GAME TABLE,
 * REPURPOSED, NOT A NEW GLOBAL COLUMN: alert_prefs has no user-wide toggle,
 * only per-(user, team-or-match) rows (migration 082); a user who has
 * silenced EVERY team/match they've ever configured (at least one row,
 * every row master=false) reads as "off" here. A user with NO alert_prefs
 * rows at all is INCLUDED - resolvePrefs()'s own "no row = DEFAULTS" rule
 * (lib/push/prefs.js), where DEFAULTS.master is true.
 */
export async function liveDeviceTokens(sqlClient, { excludeMasterOff = false } = {}) {
  if (!excludeMasterOff) {
    return (await sqlClient`SELECT token FROM device_tokens WHERE revoked_at IS NULL`).map((r) => r.token);
  }
  return (await sqlClient`
    SELECT d.token FROM device_tokens d WHERE d.revoked_at IS NULL
      AND (
        NOT EXISTS (SELECT 1 FROM alert_prefs ap WHERE ap.user_id = d.user_id)
        OR EXISTS (SELECT 1 FROM alert_prefs ap WHERE ap.user_id = d.user_id AND ap.master = true)
      )`).map((r) => r.token);
}

/**
 * Claim-then-send. Safe to call every tick with the same eventId.
 * @param {object} [opts]
 * @param {boolean} [opts.excludeMasterOff] - see liveDeviceTokens(). Never
 *   set by any v1 caller - the v2 tick is the only caller that passes it.
 * @returns {{sent: number, gone: number, failed: number}|{skipped: string}}
 */
export async function notifyEvent(eventId, { excludeMasterOff = false } = {}) {
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
  const tokens = await liveDeviceTokens(sql, { excludeMasterOff });
  const payload = alertPayload(copy);

  let sent = 0; let gone = 0; let failed = 0;
  for (const token of tokens) {
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
 * Daily board LIVE (v1) - any board whose opens_at passed within the
 * lookback and has not been announced. The lookback bounds the blast
 * radius of a long outage: better to silently miss announcing one board
 * than to announce yesterday's at noon.
 *
 * KILLED FROM DAILY_V2_EPOCH (relay 5b item 4): from that ET date, v2's own
 * tick (lib/daily/seasonBoardTick.js) is the only thing that pushes a
 * daily-live/daily-revealed notification - two systems both pushing the
 * same morning, to the same devices, was the defect this kill prevents.
 * v1's own copy lives under the 'daily-v1-live' prefix now (lib/push/
 * copy.js), never 'daily-live' - that prefix was retargeted wholesale to
 * v2 in relay 5a and this call would otherwise have sent v2's copy and
 * url to v1 players the next time it fired.
 */
export async function notifyDailyLive() {
  if ((await todayEtHere()) >= DAILY_V2_EPOCH) return [];
  const rows = await sql`
    SELECT puzzle_date FROM puzzle_days
     WHERE opens_at <= now() AND opens_at > now() - interval '2 hours'
       AND NOT revealed`;
  const out = [];
  for (const r of rows) out.push(await notifyEvent(`daily-v1-live:${r.puzzle_date}`));
  return out;
}

/** Daily REVEALED (v1) - called with the dates daily-close just closed. Same kill, same reason, as notifyDailyLive above. */
export async function notifyDailyRevealed(dates) {
  if ((await todayEtHere()) >= DAILY_V2_EPOCH) return [];
  const out = [];
  for (const d of dates ?? []) out.push(await notifyEvent(`daily-v1-revealed:${d}`));
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
