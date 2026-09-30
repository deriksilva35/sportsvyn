/**
 * /api/cron/stuck-live — the gridiron stuck-live net (tue-15). Every 5 min.
 *
 * A live NFL/CFB row is forced final only when the provider says it is over
 * (final, or gone from a feed that answered) AND nothing has written the row
 * for 30 minutes. Time since kickoff never forces anything. The rule and the
 * audit that replaced the old timer live in lib/gridiron/stuckLive.js.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { sweepStuckGridiron } from '@/lib/gridiron/stuckLive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const outcome = await withAdvisoryLock('stuck-live', async () => {
    const res = await recordRun(sql, {
      source: 'stuck-live',
      kind: 'sweep',
      run: () => sweepStuckGridiron(sql, { log: console.log }),
    });
    if (!res.ok) {
      await maybeAlert(sql, {
        source: 'stuck-live',
        subject: '[pollers] stuck-live FAILED',
        body: `source: stuck-live\n\n${res.error}`,
      });
    }
    return res;
  });
  return Response.json(outcome ?? { skipped: 'locked' });
}
