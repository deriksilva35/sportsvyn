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

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const SOURCE = 'daily-close';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const due = await sql`
    SELECT puzzle_date FROM puzzle_days
     WHERE NOT revealed AND closes_at < now()
     ORDER BY puzzle_date LIMIT 10`;

  if (!due.length) {
    // Sampled, like the other pollers: one row an hour rather than 96 a day.
    const now = new Date();
    if (now.getUTCMinutes() < 15) await recordDecision(sql, { source: SOURCE, kind: 'noop', summary: {} });
    return Response.json({ decision: 'noop', due: 0 });
  }

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'close',
    run: async () => {
      const closed = [];
      for (const d of due) closed.push(await closeDay(d.puzzle_date));
      return { closed };
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
