/**
 * /api/cron/nba-opener - THE NBA OPENER BROADCAST, Tue 20 Oct 2026 only (mon-5).
 *
 * 5-45 15 20 10 * UTC - every minute from 15:05Z. Off unless
 * BROADCAST_NBA_OPENER=on (default OFF until Derik's GO). Each firing sends at
 * most ONE batch of 50 of Group B, after the 15:00Z morning run (Group A) has
 * finished, a minute after the last batch, and never once the stop rule
 * (complaints > 1, hard bounces > 5%) has tripped. lib/email/nbaOpener.js.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { resendSend } from '@/lib/email/morningSend';
import { runOpenerBatch, openerEnabled } from '@/lib/email/nbaOpener';
import { unsubscribeUrlFor, clickUrlFor, unsubscribeHeaders } from '@/lib/auth/welcomeEmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SOURCE = 'nba-opener';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  if (!openerEnabled()) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-off', summary: {} });
    return Response.json({ decision: 'skipped-off' });
  }
  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'run',
    run: async () => runOpenerBatch({ send: resendSend, unsubscribeUrlFor, clickUrlFor, unsubscribeHeaders }),
  }));
  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  const s = res.summary ?? {};
  if (s.justStopped) {
    await maybeAlert(sql, { source: SOURCE, subject: '[nba-opener] STOPPED: the rest of Group B is not sent', body: JSON.stringify(s) });
  } else if (!res.ok || s.failed > 0) {
    await maybeAlert(sql, { source: SOURCE, subject: '[nba-opener] batch had failures', body: `${res.error ?? ''}\n${JSON.stringify(s)}` });
  }
  return Response.json({ ok: res.ok, ...s });
}
