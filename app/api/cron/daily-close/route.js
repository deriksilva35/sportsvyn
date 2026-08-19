/**
 * /api/cron/daily-close — close any Daily whose deadline has passed.
 *
 * TICKS EVERY 15 MINUTES AND LETS THE ROW DECIDE. The alternative - a cron
 * pinned to "midnight ET" - is wrong twice a year, because Vercel cron
 * expressions are UTC and midnight ET is 04:00Z in EDT and 05:00Z in EST. That
 * is the trap that fired a backstop four hours early on 13 Aug. closes_at was
 * computed in ET when the row was created; this job only asks whether it has
 * passed. A missed tick is self-healing rather than a lost reveal.
 *
 * IDEMPOTENT: the WHERE clause selects `NOT revealed`, and the UPDATE sets it.
 * A second tick in the same window finds nothing to do.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { closeDay } from '@/lib/daily/close';
import { pushEnabled, gateReport } from '@/lib/push/apns';
import { notifyDailyLive, notifyDailyRevealed } from '@/lib/push/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const SOURCE = 'daily-close';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  // PUSH HOOK: "the board is live". Rides THIS cron's tick rather than a cron
  // pinned to midnight ET, for exactly the reason in the header - the row
  // decides. Ahead of the noop return, because a board going live is precisely
  // a tick where nothing is due to close. Gated so the disabled path costs
  // nothing; send-once inside notifyEvent makes the every-tick call safe.
  if (pushEnabled()) await notifyDailyLive().catch(() => {});

  const due = await sql`
    SELECT puzzle_date FROM puzzle_days
     WHERE NOT revealed AND closes_at < now()
     ORDER BY puzzle_date LIMIT 10`;

  if (!due.length) {
    // Sampled, like the other pollers: one row an hour rather than 96 a day.
    const now = new Date();
    // pushArmed rides every sampled row so a dark gate is DIAGNOSABLE from the
    // ledger - the night of Aug 19 the hooks silently no-oped for a whole
    // reveal window and nothing recorded why.
    // A DARK GATE NAMES ITS FAILING FACT (gateReport - booleans and lengths,
    // never values). Only attached while dark: an armed gate needs one bit.
    if (now.getUTCMinutes() < 15) {
      const armed = pushEnabled();
      await recordDecision(sql, {
        source: SOURCE, kind: 'noop',
        summary: { pushArmed: armed, ...(armed ? {} : { gate: gateReport() }) },
      });
    }
    return Response.json({ decision: 'noop', due: 0 });
  }

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'close',
    run: async () => {
      const closed = [];
      for (const d of due) closed.push(await closeDay(d.puzzle_date));
      const pushArmed = pushEnabled();
      // PUSH HOOK: "the answer is up" - only for days that ACTUALLY closed on
      // this tick. closeDay returns { revealed: true } for a fresh close and
      // { alreadyRevealed: true } for a rerun; the rerun must not re-announce
      // (send-once would catch it anyway, but the filter keeps intent visible).
      if (pushEnabled()) {
        const dates = closed.filter((c) => c?.revealed === true).map((c) => c.puzzle_date);
        await notifyDailyRevealed(dates).catch(() => {});
      }
      return { closed, pushArmed };
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  if (!outcome.result.ok) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[daily] close FAILED',
      body: String(outcome.result.error),
    });
  }
  return Response.json({ ok: outcome.result.ok, ...outcome.result.summary });
}
