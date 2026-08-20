/**
 * /api/cron/pickem-board — create the next Pick 'em board when its open
 * arrives.
 *
 * DAILY, AND ALMOST ALWAYS A NO-OP, by design. The builder gates on the
 * board's own opens_at (Tuesday morning ET before the window's first kickoff)
 * and is idempotent against 067's unique index, so every fire is safe: before
 * the open it reports before-open, after creation it reports exists, and the
 * one fire in between creates. A daily cadence means a failed Tuesday gets
 * retried Wednesday instead of costing the week.
 *
 * MONDAY CANNOT PASS SILENTLY: every fire lands a recordRun row in sync_runs
 * whose summary names the outcome (created / exists / before-open /
 * no-upcoming-games), and a run that throws alerts through maybeAlert - the
 * daily-puzzle pattern, inherited whole.
 *
 * 13:23 UTC = 9:23 AM ET in EDT (8:23 in EST): deliberately after the
 * 9:00 AM ET open gate, so the board is created the same morning it opens.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { ensurePickemBoard } from '@/lib/pickem/create';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const SOURCE = 'pickem-board';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'create',
    run: async () => ensurePickemBoard(),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[pickem] board creation FAILED',
      body: String(res.error ?? 'unknown error'),
    });
  }
  return Response.json({ ok: res.ok, ...res.summary });
}
