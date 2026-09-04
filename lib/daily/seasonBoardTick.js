// lib/daily/seasonBoardTick.js — the one thing that creates v2 editions and
// fires their two pushes. Every timing decision reads a column off the
// board row (live_notify_at, closes_at) - THE TICK CARRIES NO HOUR CONSTANTS
// AND NO DST LOGIC. Those live exactly once, in ensureBoardForDate, via
// easternLocalToUtc.
//
// BOARDS EXIST BECAUSE THE TICK MADE THEM, never because a visitor arrived
// first. ensureBoardForDate is idempotent either way (090's own doctrine),
// but running every 5 minutes (services/live-poller's own cadence, see the
// systemd unit) is what actually wins that race in practice.
//
// notify IS INJECTABLE (default notifyEvent, lib/push/notify.js) so the
// decision logic - which boards need which event, called once, not twice -
// is testable with a spy, decoupled from APNs/PUSH_ENABLED/sync_runs. The
// real notifyEvent already has its own send-once claim (a repeat call is a
// safe no-op); this module's own NOT EXISTS check is what keeps a claimed
// board from generating a notify() CALL at all on a later tick, not just a
// safe one.
//
// { excludeMasterOff: true } ON EVERY notify() CALL BELOW (relay 5b item 3):
// a device whose owner has switched every game they follow off (alert_
// prefs.master = false on every row they have) is excluded from the v2
// audience. notifyEvent's default (v1's own calls, unaffected) is
// unrestricted - this module is the only caller that opts in.

import { ensureBoardForDate, isEditionLive, DAILY_V2_EPOCH } from './seasonBoardEditions.js';
import { notifyEvent } from '../push/notify.js';

/** UTC instant -> its ET calendar date, entirely Postgres-computed. */
async function etDateOf(sql, nowUtc) {
  const [{ d }] = await sql`SELECT to_char(${nowUtc}::timestamptz AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d`;
  return d;
}

/**
 * One tick. PURE given `now` (never Date.now() internally - a caller
 * supplies it, so a test can drive any instant deterministically).
 *
 * @param sql a neon() tagged-template client
 * @param nowUtc an ISO instant string ('2026-09-08T14:00:00Z') or Date
 * @returns { ensured, live: [...notify results], revealed: [...notify results] }
 */
export async function tick(sql, nowUtc, { notify = notifyEvent } = {}) {
  const now = nowUtc instanceof Date ? nowUtc.toISOString() : nowUtc;
  const today = await etDateOf(sql, now);
  const out = { ensured: null, live: [], revealed: [] };

  // (a) BOARDS EXIST BECAUSE THE TICK MADE THEM.
  if (isEditionLive(today, DAILY_V2_EPOCH)) {
    out.ensured = await ensureBoardForDate(sql, today);
  }

  // (b) DAILY-LIVE at live_notify_at (10:00 AM ET, amendment) - never opens_at.
  const liveDue = await sql`
    SELECT to_char(edition_date, 'YYYY-MM-DD') AS edition_date
      FROM daily_boards
     WHERE live_notify_at <= ${now}::timestamptz
       AND NOT EXISTS (
         SELECT 1 FROM sync_runs
          WHERE source = 'push'
            AND summary->>'eventId' = 'daily-live:' || to_char(daily_boards.edition_date, 'YYYY-MM-DD'))`;
  for (const r of liveDue) {
    out.live.push({ edition: r.edition_date, result: await notify(`daily-live:${r.edition_date}`, { excludeMasterOff: true }) });
  }

  // (c) DAILY-REVEALED at closes_at (unchanged).
  const revealedDue = await sql`
    SELECT to_char(edition_date, 'YYYY-MM-DD') AS edition_date
      FROM daily_boards
     WHERE closes_at <= ${now}::timestamptz
       AND NOT EXISTS (
         SELECT 1 FROM sync_runs
          WHERE source = 'push'
            AND summary->>'eventId' = 'daily-revealed:' || to_char(daily_boards.edition_date, 'YYYY-MM-DD'))`;
  for (const r of revealedDue) {
    out.revealed.push({ edition: r.edition_date, result: await notify(`daily-revealed:${r.edition_date}`, { excludeMasterOff: true }) });
  }

  return out;
}
