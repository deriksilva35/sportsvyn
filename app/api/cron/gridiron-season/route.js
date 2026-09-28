/**
 * /api/cron/gridiron-season - the daily full-season games re-ingest, 09:00Z.
 *
 * THE OTHER HALF OF THE WINDOW. /api/cron/gridiron-games now writes only games
 * kicking off within GAMES_WINDOW_HOURS of now, so a reschedule three weeks
 * out, a newly-added bowl or a CFB kickoff that loses its TBD would never reach
 * the table from the tick. This run writes every game of both seasons, once a
 * day, at an hour no game is on. It REPLACES NOTHING: the 5-min tick and its
 * 30-min baseline keep their schedule; this only adds the season sweep.
 *
 * Same advisory lock as the tick (per source), so the two can never write the
 * same rows at once; a held lock records 'skipped-locked' and the next day
 * tries again. Broadcasts ride along (a schedule fact, read with the
 * schedule); the CFB live-score and live-line arms do not - nothing is live at
 * 09:00Z and they are the tick's job.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { syncNflGames, syncCfbGames } from '@/lib/gridiron/sync';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision, probeCfbdBudget } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';

export const dynamic = 'force-dynamic';
// 300, NOT THE TICK'S 120: this is the whole of both seasons plus broadcasts -
// the work the old unwindowed tick did, measured at 87.7 s on Vercel and
// 170.7 s from the droplet on DEV. It runs once a day, so headroom is cheap.
export const maxDuration = 300;

const LEAGUES = [
  { slug: 'nfl', source: 'nfl-games', cfbd: false,
    run: (leagueId, season) => syncNflGames(leagueId, season, { broadcasts: true, window: null }) },
  { slug: 'cfb', source: 'cfb-games', cfbd: true,
    run: (leagueId, season) => syncCfbGames(leagueId, season, {
      broadcasts: true, liveScores: false, liveLines: false, window: null,
    }) },
];

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const season = resolveSeasonYear(new Date());
  const decisions = [];
  for (const lg of LEAGUES) {
    const [row] = await sql`SELECT id FROM leagues WHERE slug = ${lg.slug} LIMIT 1`;
    if (row?.id == null) { decisions.push({ source: lg.source, decision: 'no-league-row' }); continue; }

    const outcome = await withAdvisoryLock(lg.source, async () => {
      const res = await recordRun(sql, {
        source: lg.source,
        kind: 'season',
        budget: lg.cfbd ? probeCfbdBudget : null,
        run: () => lg.run(row.id, season),
      });
      const unknown = res.summary?.unknownStatus ?? 0;
      if (!res.ok || unknown > 0) {
        await maybeAlert(sql, {
          source: lg.source,
          subject: `[pollers] ${lg.source} season ${!res.ok ? 'FAILED' : `unknownStatus=${unknown}`}`,
          body: `source: ${lg.source}\nkind: season\nseason: ${season}\n\n${res.error ?? JSON.stringify(res.summary)}`,
        });
      }
      return res;
    });

    if (outcome.locked) {
      await recordDecision(sql, { source: lg.source, kind: 'skipped-locked', summary: { season, run: 'season' } });
      decisions.push({ source: lg.source, decision: 'skipped-locked' });
    } else {
      decisions.push({ source: lg.source, decision: 'season', ok: outcome.result.ok, id: outcome.result.id,
        ingested: outcome.result.summary?.ingested ?? null });
    }
  }
  return Response.json({ season, decisions });
}
