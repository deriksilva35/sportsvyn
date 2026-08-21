/**
 * /api/cron/weekly-board — create the next Weekly board when its open
 * arrives. The Pick'em builder's cron, verbatim pattern (the preseason
 * rehearsal's F2: ensureWeek had no caller, so Sep 8 would have passed with
 * no board and no sound).
 *
 * DAILY, AND ALMOST ALWAYS A NO-OP: the builder derives its week from the
 * calendar, gates on the Tuesday-morning open, and is idempotent against
 * 067's unique index. Every fire lands a recordRun row naming the outcome
 * (created / exists / before-open / week_mismatch / no-upcoming-games /
 * raced); a throw alerts. Sep 8 cannot pass silently.
 *
 * 24 13 * * * UTC = 9:24 AM ET in EDT - ONE MINUTE after pickem-board's
 * 13:23, a deliberate stagger: the two creators never contend for the same
 * tick and their ledger rows read apart at a glance.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { ensureWeek } from '@/lib/weekly/create';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const SOURCE = 'weekly-board';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'create',
    run: async () => ensureWeek(),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[weekly] board creation FAILED',
      body: String(res.error ?? 'unknown error'),
    });
  }
  return Response.json({ ok: res.ok, ...res.summary });
}
