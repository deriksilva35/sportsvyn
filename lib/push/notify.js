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
import { copyFor, renderCopy } from './copy.js';
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

/** One user's live device tokens - the personalized-send counterpart to
 * liveDeviceTokens()'s global fan-out list. */
async function deviceTokensForUser(userId) {
  return (await sql`SELECT token FROM device_tokens WHERE user_id = ${userId} AND revoked_at IS NULL`).map((r) => r.token);
}

/**
 * Claim-then-send, PERSONALIZED: one send-once claim per eventId (identical
 * mechanism to notifyEvent's own claim below - same sync_runs source 'push',
 * kind 'event', same summary->>'eventId' key, same STUCK_AFTER_MINUTES
 * replay guard), but the BODY is computed per recipient rather than shared.
 * Needed for weekly-reminder/weekly-settled/draft-reminder/draft-settled -
 * "One hour to lock, {n_set} of 6 set" is a different sentence for every
 * reader, so one shared payload cannot say it.
 *
 * @param eventId a contest-scoped id, e.g. 'weekly-reminder:217' - ONE claim
 *   for the whole wave, not one per recipient (a per-recipient key would let
 *   the SAME reminder re-fire for everyone whenever a new user1 joined).
 * @param recipients [{userId, params}] - one entry per user this send
 *   reaches; params are that user's OWN {placeholder} substitutions.
 */
export async function notifyPersonalized(eventId, recipients) {
  const cfg = apnsConfig();
  if (!cfg.enabled) return { skipped: 'push disabled' };
  if (!recipients?.length) return { skipped: 'no recipients' };

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

  let sent = 0; let gone = 0; let failed = 0; let noDevice = 0;
  for (const { userId, params } of recipients) {
    const copy = renderCopy(eventId, params);
    if (!copy) { failed += 1; continue; }
    const tokens = await deviceTokensForUser(userId);
    if (!tokens.length) { noDevice += 1; continue; }
    const payload = alertPayload(copy);
    for (const token of tokens) {
      const r = await sendToToken(cfg, token, payload);
      if (r.ok) { sent += 1; continue; }
      if (r.gone) {
        await sql`UPDATE device_tokens SET revoked_at = now() WHERE token = ${token}`.catch(() => {});
        gone += 1;
        continue;
      }
      failed += 1;
    }
  }

  await sql`
    UPDATE sync_runs SET finished_at = now(), ok = true,
           summary = ${JSON.stringify({ eventId, outcome: 'sent', sent, gone, failed, noDevice, recipients: recipients.length })}::jsonb
     WHERE id = ${rowId}`;
  return { sent, gone, failed, noDevice };
}

/**
 * Claim-then-send. Safe to call every tick with the same eventId.
 * @param {object} [opts]
 * @param {boolean} [opts.excludeMasterOff] - see liveDeviceTokens(). Never
 *   set by any v1 caller - the v2 tick is the only caller that passes it.
 * @param {object} [opts.params] - {placeholder} substitutions for a GLOBAL
 *   fact every recipient shares (e.g. weekly-open's {lock_local} - the
 *   contest's own lock time, identical for everyone). A PER-RECIPIENT body
 *   (weekly-reminder's {n_set}, weekly-settled's {pts}/{rank}) cannot go
 *   through this bulk fan-out at all - see notifyPersonalized() below.
 * @returns {{sent: number, gone: number, failed: number}|{skipped: string}}
 */
export async function notifyEvent(eventId, { excludeMasterOff = false, params = null } = {}) {
  const cfg = apnsConfig();
  if (!cfg.enabled) return { skipped: 'push disabled' };

  const copy = params ? renderCopy(eventId, params) : copyFor(eventId);
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

// ---------------------------------------------------------------------------
// THE WEEKLY / THE DRAFT (relay D1). Open is a GLOBAL fact - the contest's
// own lock time is the same sentence for every recipient - so it rides the
// bulk notifyEvent() path exactly like the pickem trio, just with one param.
// Reminder and settled are PER-RECIPIENT (a different sentence for every
// reader), so they go through notifyPersonalized() instead - see that
// function's own header for why one shared payload cannot say either.
// ---------------------------------------------------------------------------

const ET_STAMP = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
});
/** A push has no per-viewer timezone to render into (unlike the hero's own
 * StandaloneDate, which runs in the reader's browser) - ET, the house's own
 * sports-time convention, the same zone every kickoff/lock time on this site
 * is already stated in. */
function etStamp(iso) {
  return ET_STAMP.format(new Date(iso));
}

/** The Weekly OPEN - called by the weekly-board route right after
 * ensureWeek() creates both contests. */
export async function notifyWeeklyOpen(contestId) {
  const [c] = await sql`SELECT locks_at FROM contests WHERE id = ${contestId}`;
  if (!c) return { skipped: 'no such contest' };
  return notifyEvent(`weekly-open:${contestId}`, { params: { lock_local: etStamp(c.locks_at) } });
}

/** The Draft OPEN - same call shape as notifyWeeklyOpen, same route, same
 * lock time (the two contests share opens_at/locks_at exactly). */
export async function notifyDraftOpen(contestId) {
  const [c] = await sql`SELECT locks_at FROM contests WHERE id = ${contestId}`;
  if (!c) return { skipped: 'no such contest' };
  return notifyEvent(`draft-open:${contestId}`, { params: { lock_local: etStamp(c.locks_at) } });
}

/**
 * The Weekly lock reminder - KEYED TO THE NEXT LOCK, a NARROWER window than
 * Pick'em's own 2 hours: [45, 60] minutes before locks_at, ruled. Rides
 * daily-close's 15-minute tick, same as notifyPickemReminder - a 15-minute
 * window inside a 15-minute-wide band guarantees the tick catches it exactly
 * once without needing a finer cadence.
 */
export async function notifyWeeklyReminder() {
  const rows = await sql`
    SELECT id FROM contests
     WHERE game_type = 'weekly' AND NOT settled AND opens_at <= now()
       AND locks_at > now() + interval '45 minutes' AND locks_at <= now() + interval '60 minutes'`;
  const out = [];
  for (const c of rows) {
    const entries = await sql`SELECT user_id, lineup FROM contest_entries WHERE contest_id = ${c.id}`;
    const recipients = entries.map((e) => ({
      userId: e.user_id,
      params: { n_set: Object.values(e.lineup ?? {}).filter((v) => v != null).length },
    }));
    out.push(await notifyPersonalized(`weekly-reminder:${c.id}`, recipients));
  }
  return out;
}

/** The Draft lock reminder - same [45, 60]-minute window as the Weekly's
 * (the two contests share locks_at), seat_state from the linked room's own
 * pick_position via contest_entries.meta.draftId. */
export async function notifyDraftReminder() {
  const rows = await sql`
    SELECT id FROM contests
     WHERE game_type = 'draft' AND NOT settled AND opens_at <= now()
       AND locks_at > now() + interval '45 minutes' AND locks_at <= now() + interval '60 minutes'`;
  const out = [];
  for (const c of rows) {
    const entries = await sql`
      SELECT e.user_id, d.pick_position
        FROM contest_entries e LEFT JOIN drafts d ON d.id = (e.meta->>'draftId')::int
       WHERE e.contest_id = ${c.id}`;
    const recipients = entries.map((e) => ({
      userId: e.user_id,
      params: { seat_state: e.pick_position != null ? `Seat ${e.pick_position} drafting` : 'No seat yet' },
    }));
    out.push(await notifyPersonalized(`draft-reminder:${c.id}`, recipients));
  }
  return out;
}

/** The Weekly settled - called by weekly-settle with the contest ids
 * settleDue just reported ok. rank/field come from the same ORDER BY score
 * DESC, user_id ASC the season table itself would use. */
export async function notifyWeeklySettled(contestIds) {
  const out = [];
  for (const id of contestIds ?? []) {
    const [c] = await sql`SELECT week, perfect FROM contests WHERE id = ${id}`;
    if (!c) continue;
    const entries = await sql`
      SELECT user_id, score FROM contest_entries
       WHERE contest_id = ${id} AND score IS NOT NULL
       ORDER BY score DESC, user_id ASC`;
    const field = entries.length;
    const perfectScore = Number(c.perfect?.score ?? 0) || null;
    const recipients = entries.map((e, i) => ({
      userId: e.user_id,
      params: {
        week: c.week, pts: Number(e.score),
        pct: perfectScore ? Math.round((Number(e.score) / perfectScore) * 1000) / 10 : null,
        rank: i + 1, field,
      },
    }));
    out.push(await notifyPersonalized(`weekly-settled:${id}`, recipients));
  }
  return out;
}

/**
 * The Draft settled - called by draft-settle with the contest ids settleDue
 * just reported ok.
 *
 * room_rank HAS NO EXISTING DATA SOURCE, ON PURPOSE LEFT UNFILLED. A ranked
 * room's other 11 seats are AI-filled draft_picks, not scored
 * contest_entries - nothing today ranks a user against their own room's
 * field, only against the WHOLE season's real entrants (rank/field below,
 * same shape as the Weekly's). renderCopy() renders the literal
 * "{room_rank}" rather than a guessed number until that scoring exists -
 * flagged in this relay's own report as a real, unresolved gap.
 */
export async function notifyDraftSettled(contestIds) {
  const out = [];
  for (const id of contestIds ?? []) {
    const [c] = await sql`SELECT week FROM contests WHERE id = ${id}`;
    if (!c) continue;
    const entries = await sql`
      SELECT user_id, score FROM contest_entries
       WHERE contest_id = ${id} AND score IS NOT NULL
       ORDER BY score DESC, user_id ASC`;
    const field = entries.length;
    const recipients = entries.map((e, i) => ({
      userId: e.user_id,
      params: { week: c.week, rank: i + 1, field },
    }));
    out.push(await notifyPersonalized(`draft-settled:${id}`, recipients));
  }
  return out;
}
