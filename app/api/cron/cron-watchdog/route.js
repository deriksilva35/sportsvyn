/**
 * /api/cron/cron-watchdog - is every critical cron still running? (sun-5)
 *
 * Once a day, read each watched job's last successful sync_runs row against
 * the schedule it is supposed to keep, and every contest still unsettled 48h
 * past settles_at. Anything overdue: one email (maybeAlert) and one push to
 * the admin account, once per job - and per contest - per UTC day. The rule,
 * the watched list and why each row kind counts or not: lib/ops/cronWatchdog.js.
 *
 * OUTSIDE EVERY OTHER JOB, ON PURPOSE. NFL Pick'em week 3 sat unsettled five
 * days because pickem-settle did not fire and its stale alarm lived inside
 * pickem-settle. This route imports no watched route and shares no lock or
 * source with one; it reads only the rows they already write.
 *
 * 17 15 * * * UTC - daily, an off minute no other cron claims.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { notifyPersonalized } from '@/lib/push/notify';
import { ADMIN_USER_IDS } from '@/lib/admin/gate';
import { runWatchdog, WATCHDOG_SOURCE } from '@/lib/ops/cronWatchdog';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const SOURCE = WATCHDOG_SOURCE;

// The two channels. Email is the house operator alert; the push goes to the
// admin account only, and notifyPersonalized claims each event id once.
const sendEmail = ({ source, subject, body }) => maybeAlert(sql, { source, subject, body });
const sendPush = (eventId, params) => notifyPersonalized(eventId, ADMIN_USER_IDS.map((userId) => ({ userId, params })));

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'daily',
    run: async () => runWatchdog({ sql, now: new Date(), sendEmail, sendPush }),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const errors = res.summary?.errors ?? [];
  // A WATCHDOG THAT CANNOT READ IS ITSELF AN ALARM: a failed pass, or a job
  // whose rows could not be read, is a job nobody checked today.
  if (!res.ok || errors.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[watchdog] ${!res.ok ? 'FAILED' : `${errors.length} check(s) errored`}`,
      body: res.error ?? errors.map((e) => `${e.what}: ${e.error}`).join('\n'),
    });
  }
  return Response.json({ ok: res.ok, ...(res.summary ?? {}) });
}
