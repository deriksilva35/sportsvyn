/**
 * /api/cron/pickem-settle — settle every due Pick 'em board.
 *
 * SAT-SHAPED, GATE-DECIDED. A board's games run Thursday night through late
 * Saturday (Sunday in UTC); CFBD flips `completed` within the gridiron-games
 * cadence, so the ordinary settle lands Sunday morning. The cron fires hourly
 * across SUNDAY AND MONDAY (a window's slate can reach Sunday-evening ET,
 * final near 04Z Monday) and the completeness gate - every snapshot game
 * final - decides which firing actually settles. A refusal is not a failure
 * (the weekly-settle law verbatim).
 *
 * 0 6-20 * * 0,1 UTC = hourly 2 AM-4 PM ET Sundays and Mondays in EDT
 * (1 AM-3 PM in EST); the window runs long enough either way.
 *
 * THE STALE ALARM is this route's second job: a cancelled game never turns
 * final in CFBD's vocabulary, so a board that cannot complete would
 * otherwise wait in silence forever. settles_at + 48h without a settle
 * pages instead.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { settleDuePickem, stalePickemBoards } from '@/lib/pickem/settle';
import { pushEnabled } from '@/lib/push/apns';
import { notifyPickemSettled } from '@/lib/push/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'pickem-settle';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'settle',
    run: async () => settleDuePickem(),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const summary = res.summary ?? {};
  const errored = (summary.results ?? []).filter((r) => r.error);
  const stale = await stalePickemBoards().catch(() => []);
  if (!res.ok || errored.length || stale.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[pickem] settle ${!res.ok || errored.length ? 'FAILED' : 'STALLED'}`,
      body: [
        res.error ?? '',
        ...errored.map((e) => `contest ${e.contestId}: ${e.error}`),
        ...stale.map((s) => `contest ${s.id}: unsettled ${new Date(s.settles_at).toISOString()} + 48h - a game may never turn final`),
      ].filter(Boolean).join('\n'),
    });
  }
  // PUSH HOOK: results, for the boards THIS fire graded. Send-once keys on
  // the board id; caught so push can never un-settle a settle.
  const settled = (summary.results ?? []).filter((r) => r.settled).map((r) => r.contestId);
  if (settled.length && pushEnabled()) {
    await notifyPickemSettled(settled).catch(() => {});
  }
  return Response.json({ ok: res.ok, ...summary });
}
