/**
 * /api/cron/survivor-grade - grade Survivor picks, assign missed ones, count lives.
 *
 * HOURLY AT :25, EVERY DAY. NFL kickoffs land on :00, :05, :15, :20, :25 and
 * :30, so the :25 firing is the first one after most of them: a Thursday 8:15 PM
 * ET opener (00:15Z) gets its auto-picks at 00:25Z, ten minutes after the week's
 * first kickoff, chosen from the games still to come - which is the ruling ("at
 * the week's first kickoff, among games still scheduled"). Grading is the same
 * firing: a pick turns win/loss within the hour of its final, and the next week
 * opens once every pick of the last one is graded (lib/survivor/rules.js
 * openWeek). Every step is idempotent (lib/survivor/grade.js), so a firing that
 * finds nothing to do writes nothing but its sync_runs row.
 *
 * NOT pickem-settle's window: that cron fires only on Sunday and Monday UTC,
 * and Monday night's final lands on Tuesday UTC.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { gradeAllPools } from '@/lib/survivor/grade';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'survivor-grade';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'grade',
    run: async () => ({ pools: await gradeAllPools({ now: new Date() }) }),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const pools = res.summary?.pools ?? [];
  const errored = pools.filter((p) => p.error);
  if (!res.ok || errored.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[survivor] grade FAILED',
      body: [res.error ?? '', ...errored.map((p) => `pool ${p.poolId}: ${p.error}`)].filter(Boolean).join('\n'),
    });
  }
  return Response.json({ ok: res.ok, pools });
}
