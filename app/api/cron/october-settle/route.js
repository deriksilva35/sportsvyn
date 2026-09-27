/**
 * /api/cron/october-settle - settle every October day whose games are all final.
 *
 * NOTHING CALLED settleDueOctober. lib/october/settle.js has had the whole
 * settle since the game shipped - per-slot scoring, the DNF rule, the day's gate
 * - and no cron, route or script invoked it, so on 27 Sep every October day on
 * PROD (six preview days, 22 entries) was still unsettled with no score, and the
 * October board, which sums settled days, had nothing to sum. This is the
 * missing caller, and nothing else.
 *
 * THE GATE DECIDES, NOT THE CLOCK (the run-settle law): a day settles only when
 * every match on its board is final - a postponed game holds its day open until
 * the makeup is played. Most firings find a day still waiting and write nothing,
 * which is the expected state, not a failure.
 *
 * 30 6-20 * * * UTC - hourly, half past, so it never shares a minute with
 * run-settle's top-of-the-hour firing against the same box scores. Every day of
 * the week: the postseason plays daily.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { settleDueOctober } from '@/lib/october/settle';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'october-settle';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'settle',
    run: async () => settleDueOctober({ now: new Date() }),
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
      subject: '[october] settle FAILED',
      body: [res.error ?? '', ...errored.map((e) => `contest ${e.contestId}: ${e.error}`)].filter(Boolean).join('\n'),
    });
  }
  return Response.json({ ok: res.ok, ...summary });
}
