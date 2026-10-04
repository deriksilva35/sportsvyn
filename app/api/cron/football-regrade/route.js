/**
 * /api/cron/football-regrade — the daily football sweep (sat-5, area A).
 *
 * TWO JOBS, both in lib/settle/regrade.js footballSweep():
 *
 *   1. THE LATE SETTLE (the void rule). A Weekly, Draft or football Pick'em
 *      contest with a game still not final at settles_at + 48h settles with
 *      that game VOID. The cutoff falls on Thursday for an NFL week, after the
 *      Tuesday crons have stopped, so this daily firing is what reaches it.
 *      Before the cutoff the same settle functions refuse exactly as they do
 *      on Tuesday - the ordinary cadence is unchanged.
 *
 *   2. THE 7-DAY RE-GRADE. Every settled contest with a game kicked off in
 *      the last 7 days is recomputed and compared; only a moved point or
 *      result is written (meta.regraded_at / perfect.regraded_at), settled_at
 *      stays the first settle.
 *
 * Each settle step runs under the advisory lock of the cron that owns it
 * (weekly-settle, draft-settle, pickem-settle), so this never grades a
 * contest at the same moment a Tuesday firing does.
 *
 * 14:30Z daily: after the Tuesday sweep's stats (08Z) and after any overnight
 * score correction, and inside the working day for anyone the alarm wakes.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { footballSweep } from '@/lib/settle/regrade';
import { pushEnabled } from '@/lib/push/apns';
import { notifyWeeklySettled, notifyDraftSettled, notifyPickemSettled } from '@/lib/push/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'football-regrade';

const settledIds = (part) => (part?.results ?? []).filter((r) => r.settled).map((r) => r.contestId);
const erroredOf = (part) => [
  ...(part?.error ? [{ contestId: '-', error: part.error }] : []),
  ...(part?.results ?? []).filter((r) => r.error),
];

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const lock = (source, fn) => withAdvisoryLock(source, fn);
  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'settle',
    run: async () => footballSweep({ lock }),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const summary = res.summary ?? {};
  const errored = ['weekly', 'draft', 'pickem', 'regrade'].flatMap((k) => erroredOf(summary[k]).map((e) => ({ k, ...e })));
  if (!res.ok || errored.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[football] settle sweep FAILED',
      body: [res.error ?? '', ...errored.map((e) => `${e.k} contest ${e.contestId}: ${e.error}`)].filter(Boolean).join('\n'),
    });
  }
  // PUSH HOOK: only what THIS sweep settled (a late, void-cutoff settle). A
  // re-grade announces nothing - the result was already announced.
  if (res.ok && pushEnabled()) {
    const w = settledIds(summary.weekly); const d = settledIds(summary.draft); const p = settledIds(summary.pickem);
    if (w.length) await notifyWeeklySettled(w).catch(() => {});
    if (d.length) await notifyDraftSettled(d).catch(() => {});
    if (p.length) await notifyPickemSettled(p).catch(() => {});
  }
  return Response.json({ ok: res.ok, ...summary });
}
