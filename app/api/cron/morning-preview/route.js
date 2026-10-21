/**
 * /api/cron/morning-preview - THE 6 AM PREVIEW (tue-4).
 *
 * Fires HOURLY (0 * * * * UTC) and acts only in the 6 o'clock hour on the
 * Pacific clock (lib/email/schedule.js), so it is 6 AM PT before and after DST
 * ends (Sun 1 Nov): 13:00Z on PDT days, 14:00Z on PST days. Every other firing
 * records 'not-the-hour' (the watchdog's liveness row) and does nothing.
 *
 * Sends ONE preview of today's morning email to the owner address only
 * (lib/email/morningPreview.js), whether or not MORNING_EMAIL is on, and never
 * touches the real send's ledger.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { resendSend } from '@/lib/email/morningSend';
import { runPreview } from '@/lib/email/morningPreview';
import { isPacificHour, PREVIEW_HOUR_PT, pacificHour } from '@/lib/email/schedule';
import { unsubscribeUrlFor } from '@/lib/auth/welcomeEmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SOURCE = 'morning-preview';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const now = new Date();
  if (!isPacificHour(now, PREVIEW_HOUR_PT)) {
    await recordDecision(sql, { source: SOURCE, kind: 'not-the-hour', summary: { pacificHour: pacificHour(now) } });
    return Response.json({ decision: 'not-the-hour' });
  }
  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'run',
    run: async () => runPreview({ now, send: resendSend, unsubscribeUrlFor }),
  }));
  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  const s = res.summary ?? {};
  if (!res.ok || s.decision === 'failed' || s.decision === 'no-account' || s.decision === 'refused-address') {
    await maybeAlert(sql, { source: SOURCE, subject: '[morning-preview] preview did not go out', body: `${res.error ?? ''}\n${JSON.stringify(s)}` });
  }
  return Response.json({ ok: res.ok, ...s });
}
