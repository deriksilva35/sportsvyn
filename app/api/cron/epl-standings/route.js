/**
 * /api/cron/epl-standings — refresh the Premier League table.
 *
 * ONE REQUEST, DAILY. The provider recomputes the table itself, deductions and
 * tiebreaks included, so this is a fetch-and-store rather than a calculation.
 *
 * 26 13 * * * UTC = 9:26 AM ET in EDT (8:26 EST) - the fourth creator minute,
 * behind pickem-board (23), weekly-board (24) and epl-fixtures (25). Running
 * a minute AFTER the fixtures sync is deliberate: results land first, the
 * table that reflects them second.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { syncEplStandings } from '@/lib/soccer/standings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const SOURCE = 'epl-standings';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'sync',
    run: async () => syncEplStandings(),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[epl] standings sync FAILED',
      body: String(res.error ?? 'unknown error'),
    });
  }
  return Response.json({ ok: res.ok, ...res.summary });
}
