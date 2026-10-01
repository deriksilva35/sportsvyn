/**
 * /api/cron/nba-schedule - the NBA schedule re-sync (lib/nba/schedule.js).
 *
 * HOURLY AT :52, EVERY TICK. Unlike MLB there is no "is it due" gate: the
 * window (yesterday .. +14 days) is one or two provider calls against a 600/min
 * key, and the 20 Oct opener's tip is filed as a placeholder (BOS @ DET,
 * 19:00Z) that must reach kickoff_at within the hour it changes - every
 * lock reads kickoff_at, so a stale tip is a lock at the wrong time.
 *
 * ?dry=1 plans and writes nothing. Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { resyncNbaSchedule, NBA_RESYNC_SOURCE } from '@/lib/nba/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const SOURCE = NBA_RESYNC_SOURCE;

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const now = new Date();
  const dryRun = new URL(request.url).searchParams.get('dry') === '1';

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: dryRun ? 'dry' : 'hourly',
    run: async () => resyncNbaSchedule(sql, { now, dryRun }),
  }));
  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  const s = res.summary ?? {};
  // A REFUSED GAME IS LOUD: a game the provider has and we cannot shape will be
  // missing from every surface. no-league-row is quiet until the import runs.
  if (!res.ok || s.refused?.length || (s.unmapped ?? []).length) {
    if (s.reason !== 'no-league-row') {
      await maybeAlert(sql, {
        source: SOURCE,
        subject: `[nba-schedule] ${!res.ok ? 'FAILED' : `refused ${s.refused?.length ?? 0}, unmapped ${JSON.stringify(s.unmapped ?? [])}`}`,
        body: res.error ?? JSON.stringify(s).slice(0, 4000),
      });
    }
  }
  const moved = (s.changes ?? []).filter((c) => c.action === 'update' && c.kickoffFrom !== c.kickoffTo);
  return Response.json({ ok: res.ok, from: s.from, to: s.to, changes: s.changes?.length ?? 0, tipsMoved: moved.length, cancelled: s.cancelled?.length ?? 0, refused: s.refused?.length ?? 0, dryRun });
}
