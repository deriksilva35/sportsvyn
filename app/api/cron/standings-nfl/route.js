/**
 * /api/cron/standings-nfl — NFL team records.
 *
 * ONE CALL, HOURLY - the stats provider returns all 32 teams at once.
 *
 * THE SEASON_TYPE IS DECIDED BY THE CALENDAR, NOT THE ENDPOINT. The provider
 * documents this route as regular-season standings and, asked for the current
 * season before Week 1, returns PRESEASON records - measured 30 Aug 2026: 3-4
 * games per team, 49 league-wide, a playoff seed on a 1-2 team.
 * syncNflStandings reads the first REG kickoff out of our own matches table
 * and labels the snapshot from that; if we hold no REG schedule it writes
 * NOTHING rather than guessing. The vendor is named only in lib/, per the
 * legal guard that keeps it out of app/ and components/ entirely.
 *
 * 21 * * * * UTC — one minute behind standings-cfb so the two never share a
 * tick, and clear of cfb-rankings (:15) and the creator block (:23-:26).
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { syncNflStandings } from '@/lib/standings/nfl';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const SOURCE = 'standings-nfl';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const season = resolveSeasonYear(new Date());
  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'sync',
    run: async () => {
      const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'nfl' LIMIT 1`;
      if (!lg) return { season, reason: 'no-league-row' };
      return syncNflStandings(lg.id, season);
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { season } });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  const unmapped = res.summary?.unmapped ?? [];
  if (!res.ok || unmapped.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[standings] nfl ${!res.ok ? 'FAILED' : `unmapped: ${unmapped.join(',')}`}`,
      body: `season: ${season}\n\n${res.error ?? JSON.stringify(res.summary)}`,
    });
  }
  return Response.json({ ok: res.ok, ...res.summary });
}
