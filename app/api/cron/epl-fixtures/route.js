/**
 * /api/cron/epl-fixtures — keep the Premier League season in sync.
 *
 * DAILY, WHOLE-SEASON. Two provider requests (teams + fixtures) refresh every
 * kickoff time, score and status for the season - so a rescheduled fixture, a
 * corrected score and a completed matchweek all self-heal without a per-match
 * poll. Idempotent by slug; a re-run changes nothing that has not moved.
 *
 * 25 13 * * * UTC = 9:25 AM ET in EDT (8:25 EST) - one minute past
 * weekly-board's 13:24 and two past pickem-board's 13:23. The stagger is
 * deliberate: three creators, three distinct minutes, three legible ledgers.
 *
 * THE SOCCER METER IS NOT THE GRIDIRON METER. api-football (v3.football) is a
 * separate Ultra subscription at 75,000 requests/day; the 2,000/day cap that
 * governs the american-football poller cannot be touched from here.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { syncEpl } from '@/lib/soccer/epl';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'epl-fixtures';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'sync',
    run: async () => syncEpl(),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const summary = res.summary ?? {};
  if (!res.ok || (summary.skipped ?? 0) > 0) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[epl] fixture sync ${res.ok ? 'incomplete' : 'FAILED'}`,
      body: [res.error ?? '', ...(summary.skippedReasons ?? [])].filter(Boolean).join('\n'),
    });
  }
  return Response.json({ ok: res.ok, ...summary });
}
