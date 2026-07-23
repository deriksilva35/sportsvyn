/**
 * /api/cron/nfl-stats-sweep — weekly NFL player + stat sweep. Tue 08:00 UTC
 * (post-MNF). ingestAllPlayers (roster identities) then syncNfl2025 (per-game
 * stat lines) for the RESOLVED season. Heavy (~300 upstream calls), so maxDuration
 * 300. Under an advisory lock; failure -> throttled alert.
 *
 * NOTE: syncNfl2025 is now season-parameterized (default 2025); the name is a
 * legacy misnomer kept minimal — it takes { season }.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { ingestAllPlayers, syncNfl2025 } from '@/lib/gridiron/nflStatsSync';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const season = resolveSeasonYear(new Date());

  const outcome = await withAdvisoryLock('nfl-stats', async () =>
    recordRun(sql, {
      source: 'nfl-stats',
      kind: 'stats',
      run: async () => {
        const players = await ingestAllPlayers({ log: console.log });
        const stats = await syncNfl2025({ season, log: console.log });
        return { season, players, stats };
      },
    }),
  );

  if (outcome.locked) {
    await recordDecision(sql, { source: 'nfl-stats', kind: 'skipped-locked', summary: { season } });
    return Response.json({ decision: 'skipped-locked', season });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: 'nfl-stats',
      subject: '[pollers] nfl-stats FAILED',
      body: `source: nfl-stats\nseason: ${season}\n\n${res.error}`,
    });
  }
  return Response.json({ season, ok: res.ok, id: res.id });
}
