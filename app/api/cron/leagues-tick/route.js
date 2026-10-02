/**
 * /api/cron/leagues-tick - decide every finished guillotine bucket (Leagues V1 P3).
 *
 * THE ONE PERSISTED LEAGUE DECISION. Standings are derived on every read; a
 * chop is written once (player_league_eliminations, migration 122) so a stat
 * correction can never un-chop or re-chop anybody. lib/leagues/guillotine.js
 * does the work; a bucket is decided only when its time is up AND every result
 * in it is final, so most firings write nothing - the expected state.
 *
 * 25 * * * * UTC - hourly, on a minute no settle cron claims, so it reads
 * whatever the settles wrote in the hour before.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { settleAllGuillotines } from '@/lib/leagues/guillotine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'leagues-tick';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'settle',
    run: async () => ({ results: await settleAllGuillotines({ now: new Date() }) }),
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
      subject: '[leagues] guillotine tick FAILED',
      body: [res.error ?? '', ...errored.map((e) => `league ${e.leagueId}: ${e.error}`)].filter(Boolean).join('\n'),
    });
  }
  return Response.json({ ok: res.ok, ...summary });
}
