/**
 * /api/cron/nfl-stats-sweep — weekly NFL player + stat sweep. Tue 08:00 UTC
 * (post-MNF). ingestAllPlayers (roster identities) then syncNflSeason (per-game
 * stat lines) for the RESOLVED season. Heavy (~300 upstream calls), so maxDuration
 * 300. Under an advisory lock; failure -> throttled alert.
 *
 * NOTE: syncNflSeason is now season-parameterized (default 2025); the name is a
 * legacy misnomer kept minimal — it takes { season }.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { ingestAllPlayers, syncNflSeason } from '@/lib/gridiron/nflStatsSync';
import { sweepGameStats } from '@/lib/gridiron/gameStatsSync';
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
        const stats = await syncNflSeason({ season, log: console.log });
        // BESIDE THE SEASON SWEEP, NOT INSTEAD: any final this season still
        // holding no stats rows gets one per-game pull (a game the live
        // poller missed, or one the season feed had not scored yet).
        const weeks = await sql`
          SELECT DISTINCT m.week FROM matches m JOIN leagues l ON l.id = m.league_id
           WHERE l.slug = 'nfl' AND m.season_year = ${season} AND m.season_phase = 'REG' AND m.status = 'final'
             AND m.external_ids ? 'bdl_game_id'
             AND NOT EXISTS (SELECT 1 FROM nfl_player_game_stats s WHERE s.match_id = m.id) ORDER BY 1`;
        const gameSweeps = [];
        for (const w of weeks) gameSweeps.push(await sweepGameStats(w.week, { season, log: console.log }));
        return { season, players, stats, gameSweeps: gameSweeps.map((g) => ({ week: g.week, candidates: g.candidates, synced: g.synced.length })) };
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
