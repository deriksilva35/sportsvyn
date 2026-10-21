/**
 * /api/cron/morning-email - THE MORNING EMAIL (ruling thu-1, built sun-2).
 *
 * HOURLY (0 * * * * UTC), acting only in the 8 o'clock hour on the Pacific clock
 * (lib/email/schedule.js; tue-4) - 8 AM PT / 11 AM ET all year: 15:00Z while PDT,
 * 16:00Z after DST ends (Sun 1 Nov 2026). Every other firing records
 * 'not-the-hour' (the watchdog's liveness row) and does nothing. Off unless MORNING_EMAIL=on (the kill
 * switch, default OFF until Derik's GO): an off firing records 'skipped-off' and
 * sends nothing. On: lib/email/morningSend.js runMorning - the thu-1 audience,
 * hard bounces suppressed, once per user per ET day (the ledger is written
 * before each send, so a retried or doubled firing mails nobody twice).
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { runMorning, morningEnabled, resendSend } from '@/lib/email/morningSend';
import { unsubscribeUrlFor, clickUrlFor, unsubscribeHeaders } from '@/lib/auth/welcomeEmail';
import { isPacificHour, SEND_HOUR_PT, pacificHour } from '@/lib/email/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SOURCE = 'morning-email';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const now = new Date();
  if (!isPacificHour(now, SEND_HOUR_PT)) {
    await recordDecision(sql, { source: SOURCE, kind: 'not-the-hour', summary: { pacificHour: pacificHour(now) } });
    return Response.json({ decision: 'not-the-hour' });
  }
  if (!morningEnabled()) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-off', summary: {} });
    return Response.json({ decision: 'skipped-off' });
  }
  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'run',
    run: async () => runMorning({ now, send: resendSend, unsubscribeUrlFor, clickUrlFor, unsubscribeHeaders }),
  }));
  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  const s = res.summary ?? {};
  if (!res.ok || s.failed > 0) {
    await maybeAlert(sql, { source: SOURCE, subject: '[morning-email] run had failures', body: `${res.error ?? ''}\n${JSON.stringify(s)}` });
  }
  return Response.json({ ok: res.ok, ...s });
}
