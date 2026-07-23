/**
 * /api/cron/gridiron-teams — weekly team + membership sync, both leagues,
 * resolved season. Wed 07:00 UTC. Catches CFB conference realignment cheaply
 * (~3 CFBD calls) and keeps NFL team rows fresh. bootstrapLeagues() first so the
 * league rows exist (idempotent). Under an advisory lock; failure -> alert.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { bootstrapLeagues, syncNflTeams, syncCfbTeams } from '@/lib/gridiron/sync';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision, probeCfbdBudget } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const season = resolveSeasonYear(new Date());

  const outcome = await withAdvisoryLock('gridiron-teams', async () =>
    recordRun(sql, {
      source: 'gridiron-teams',
      kind: 'teams',
      budget: probeCfbdBudget,
      run: async () => {
        const { nfl, cfb } = await bootstrapLeagues();
        const nflTeams = await syncNflTeams(nfl.id, season);
        const cfbTeams = await syncCfbTeams(cfb.id, season);
        return { season, nfl: nflTeams, cfb: cfbTeams };
      },
    }),
  );

  if (outcome.locked) {
    await recordDecision(sql, { source: 'gridiron-teams', kind: 'skipped-locked', summary: { season } });
    return Response.json({ decision: 'skipped-locked', season });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: 'gridiron-teams',
      subject: '[pollers] gridiron-teams FAILED',
      body: `source: gridiron-teams\nseason: ${season}\n\n${res.error}`,
    });
  }
  return Response.json({ season, ok: res.ok, id: res.id });
}
