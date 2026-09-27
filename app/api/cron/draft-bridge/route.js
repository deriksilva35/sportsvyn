/**
 * /api/cron/draft-bridge - store every locked Draft contest's rosters (lib/draft/lockBridge.js).
 *
 * Hourly at :45, every day. Most firings find every roster already stored and
 * write nothing; the one that follows Thursday's lock does the week's work, and
 * any room that finishes late is picked up an hour later instead of on Tuesday.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { bridgeLockedDrafts } from '@/lib/draft/lockBridge';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'draft-bridge';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'bridge',
    run: async () => bridgeLockedDrafts({ now: new Date() }),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const summary = res.summary ?? {};
  const errored = (summary.results ?? []).filter((r) => r.error);
  if (!res.ok || errored.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[draft] roster bridge FAILED',
      body: [res.error ?? '', ...errored.map((e) => `contest ${e.contestId}: ${e.error}`)].filter(Boolean).join('\n'),
    });
  }
  return Response.json({ ok: res.ok, ...summary });
}
