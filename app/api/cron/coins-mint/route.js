/**
 * /api/cron/coins-mint - THE COIN MINT (Rules v0.1 s3, ruling coins-2).
 *
 * 7 * * * * UTC - hourly. Off unless COINS=on: an off firing records
 * 'skipped-off'. On: lib/coins/mint.js runMint - settled contests and closed
 * Daily boards become arcade points (once per user, contest and event), and
 * whole hundreds become coins (10 a week at most). Shares the 'coins' lock
 * with the Tuesday close, so a mint never runs inside a drawing.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { runMint, coinsEnabled } from '@/lib/coins/mint';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SOURCE = 'coins-mint';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  if (!coinsEnabled()) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-off', summary: {} });
    return Response.json({ decision: 'skipped-off' });
  }
  const outcome = await withAdvisoryLock('coins', async () => recordRun(sql, { source: SOURCE, kind: 'run', run: async () => runMint() }));
  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  if (!res.ok) await maybeAlert(sql, { source: SOURCE, subject: '[coins-mint] run failed', body: String(res.error ?? '') });
  return Response.json({ ok: res.ok, ...(res.summary ?? {}) });
}
