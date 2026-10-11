/**
 * /api/cron/nba-mock-pool - rebuild the NBA mock draft's pool, daily (sun-5).
 *
 * lib/mockNba/pool.js: BDL active rosters + last season's averages (about 13
 * calls through the BDL door) -> the ranked pool -> nba_mock_pool (one row per
 * season). A pool too small to draft is refused and the old one stays.
 * Auth: Bearer ${CRON_SECRET}.
 */
import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { buildNbaMockPool, storeNbaMockPool } from '@/lib/mockNba/pool';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const SOURCE = 'nba-mock-pool';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'build',
    run: async () => ({ stored: await storeNbaMockPool(await buildNbaMockPool()) }),
  }));
  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, { source: SOURCE, subject: '[nba-mock] pool build FAILED', body: String(res.error ?? 'unknown error') });
  }
  return Response.json({ ok: res.ok, ...res.summary });
}
