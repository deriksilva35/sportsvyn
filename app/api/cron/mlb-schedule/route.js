/**
 * /api/cron/mlb-schedule — the MLB schedule re-sync (lib/mlb/resync.js).
 *
 * HOURLY AT :50, RUNS WHEN DUE. resyncDue() decides: once a day at 10:00Z,
 * once more on the tick 90-150 min before the day's first pitch, and every two
 * hours while a postseason is on. A tick that is not due costs one read and
 * writes nothing, not even a ledger row.
 *
 * ?force=1 runs it now (same auth) - the operator's lever after a rainout.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { resyncMlbSchedule, resyncDue, firstPitchOfDay, RESYNC_SOURCE } from '@/lib/mlb/resync';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const SOURCE = RESYNC_SOURCE;

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const now = new Date();
  const force = new URL(request.url).searchParams.get('force') === '1';

  const near = await sql`
    SELECT m.kickoff_at, m.season_phase FROM matches m JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
     WHERE m.kickoff_at BETWEEN ${now.toISOString()}::timestamptz - interval '2 days'
                            AND ${now.toISOString()}::timestamptz + interval '7 days'
       AND m.status <> 'cancelled'`;
  const postseason = near.some((m) => m.season_phase === 'POST');
  const firstPitch = firstPitchOfDay(near.map((m) => m.kickoff_at), now);
  const due = force ? { run: true, why: 'forced' } : resyncDue(now, { firstPitch, postseason });
  if (!due.run) return Response.json({ decision: 'not-due', why: due.why });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: due.why,
    run: async () => resyncMlbSchedule(sql, { now }),
  }));
  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { why: due.why } });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  const s = res.summary ?? {};
  // A REFUSED GAME IS LOUD. It is a game BDL has and we cannot shape - an
  // unmapped club or status - and it will be missing from every surface.
  if (!res.ok || s.refused?.length || Object.keys(s.unmapped ?? {}).length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[mlb-schedule] ${!res.ok ? 'FAILED' : `refused ${s.refused?.length ?? 0}, unmapped ${JSON.stringify(s.unmapped ?? {})}`}`,
      body: res.error ?? JSON.stringify(s).slice(0, 4000),
    });
  }
  return Response.json({ ok: res.ok, why: due.why, from: s.from, to: s.to, changes: s.changes?.length ?? 0, cancelled: s.cancelled?.length ?? 0, refused: s.refused?.length ?? 0 });
}
