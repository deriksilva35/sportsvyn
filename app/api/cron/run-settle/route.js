/**
 * /api/cron/run-settle — settle the round that is over, and open the one that
 * follows it.
 *
 * ONE JOB, BOTH HALVES, and that is deliberate: "the next round opens the
 * morning after the round's last series is decided" is not a statement about
 * the calendar, it is a statement about the games. The job that notices a
 * round is decided is the only thing that knows when that morning is. Two
 * crons would mean a second one guessing.
 *
 * THE GATE DECIDES, NOT THE CLOCK (the weekly-settle law verbatim): a round
 * settles only when EVERY SERIES in it has a winner, which is exactly when no
 * club in it can play another game. A refusal is the expected state for most
 * firings and is not a failure.
 *
 * 0 6-20 * * * UTC = hourly 2 AM-4 PM ET. Baseball's postseason plays every
 * day for a month and a west-coast game can end near 05Z, so unlike Pick'em's
 * Sunday-and-Monday window this runs every day of the week. Hourly is safe
 * here for the same reason it is safe there - a firing that finds an undecided
 * round writes nothing.
 *
 * run-open FIRES FROM HERE, on the rounds this firing actually created. It is
 * a global fact - the same sentence for everyone - so it rides the bulk
 * notifyEvent path, and its send-once key is the contest id.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { settleDueRun } from '@/lib/run/settle';
import { ensureRunRounds } from '@/lib/run/create';
import { roundSettleAlerts } from '@/lib/run/alerts';
import { pushEnabled } from '@/lib/push/apns';
import { notifyEvent, notifyPersonalized } from '@/lib/push/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'run-settle';

/** The season the postseason belongs to. */
const seasonNow = (now = new Date()) => new Date(now).getUTCFullYear();

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'settle',
    run: async () => {
      const settled = await settleDueRun();
      // OPENED AFTER THE SETTLE, IN THE SAME FIRING. A round can only be
      // opened once the one before it is decided, which the settle above has
      // just established - so this is the earliest honest moment for it.
      const opened = await ensureRunRounds(seasonNow());
      return { ...settled, opened };
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const summary = res.summary ?? {};
  const errored = (summary.results ?? []).filter((r) => r.error);
  if (!res.ok || errored.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[run] settle FAILED',
      body: [res.error ?? '', ...errored.map((e) => `contest ${e.contestId}: ${e.error}`)].filter(Boolean).join('\n'),
    });
  }

  if (pushEnabled()) {
    // THE RESULT, per reader: every sentence carries its own points and rank.
    for (const r of (summary.results ?? []).filter((x) => x.settled)) {
      const recipients = await roundSettleAlerts(r.contestId).catch(() => []);
      if (recipients.length) {
        await notifyPersonalized(`run-settled:${r.contestId}`, recipients).catch(() => {});
      }
    }
    // THE OPEN, in bulk: one sentence for everyone, once per round.
    for (const o of (summary.opened ?? []).filter((x) => x.created)) {
      await notifyEvent(`run-open:${o.id}`, { params: { round: o.round } }).catch(() => {});
    }
  }
  return Response.json({ ok: res.ok, ...summary });
}
