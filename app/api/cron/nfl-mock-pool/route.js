/**
 * /api/cron/nfl-mock-pool - rebuild the NFL mock draft's pool, daily (mon-3).
 *
 * lib/mockNfl/pool.js: the licensed football ADP source's newest full PPR board,
 * this season's and last season's stat totals, games left per team, and the
 * injury report (through the stats feed's door, lib/wire/injuries.js) -> nfl_mock_pool
 * (one row per season). Runs after the 11:00Z ADP snapshot. A pool too small to
 * draft is refused and the old one stays. Auth: Bearer ${CRON_SECRET}.
 */
import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { buildNflMockPool, storeNflMockPool } from '@/lib/mockNfl/pool';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const SOURCE = 'nfl-mock-pool';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'build',
    run: async () => ({ stored: await storeNflMockPool(await buildNflMockPool()) }),
  }));
  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, { source: SOURCE, subject: '[nfl-mock] pool build FAILED', body: String(res.error ?? 'unknown error') });
  }
  return Response.json({ ok: res.ok, ...res.summary });
}
