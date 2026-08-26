/**
 * /api/cron/cfb-player-stats — CFB box scores, one call per week that has
 * played.
 *
 * WEEKLY, NOT ALWAYS-ON. This is a once-a-week cron, not a poller: the relay's
 * "+1 call per week" budget, and it costs exactly that in the steady state.
 *
 * 30 14 * * 1 UTC = 10:30 AM ET in EDT (9:30 in EST), Monday — fifteen minutes
 * after cfb-rankings' Monday fire, the same deliberate stagger pickem-board and
 * weekly-board use so two CFB jobs never contend for a tick and their ledger
 * rows read apart. Monday because a CFB week's last game is Saturday night at
 * the earliest, and this must run AFTER games settle rather than after the
 * calendar day turns — the sports-day law.
 *
 * "COMPLETED" IS NOT "THE WEEK IS OVER", and that distinction is load-bearing
 * here. 2026 week 1 opens Saturday Aug 29 and does not finish until Monday
 * Sep 7: 99 games across ten days. Gating on "every game in the week is final"
 * would leave a player who played on the 29th with no game log until the 8th.
 * So the gate is PER WEEK WITH ANY FINAL GAME, and a partially-played week is
 * re-imported on later fires until it stops changing. The upsert makes that
 * free, and the inserted/updated split in the ledger makes it visible: a
 * topped-up week reports inserts, a settled one reports updates only.
 *
 * At most MAX_WEEKS calls per fire, so a catch-up after an outage cannot turn
 * one cron into a hundred requests.
 *
 * Its own alarm source, per the standing pattern: maybeAlert rate-limits per
 * source, and the payload dedupe means a week that keeps failing identically
 * mails once and then counts.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { importCfbWeek, rosterMap, matchMap } from '@/lib/cfb/gameStatsImport';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'cfb-player-stats';
export const MAX_WEEKS = 3;

/**
 * Which weeks are worth a call: those with at least one FINAL game, newest
 * first. A week whose games have all been imported and have not changed simply
 * reports updates and no inserts, which is the cheap steady state.
 */
export async function weeksToImport(season, { limit = MAX_WEEKS } = {}) {
  return sql`
    SELECT m.season_phase, m.week,
           count(*) FILTER (WHERE m.status = 'final')::int AS finals,
           count(*)::int AS games
      FROM matches m JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = 'cfb' AND m.season_year = ${season}
     GROUP BY m.season_phase, m.week
    HAVING count(*) FILTER (WHERE m.status = 'final') > 0
     ORDER BY max(m.kickoff_at) DESC
     LIMIT ${limit}`;
}

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const season = resolveSeasonYear(new Date());
  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'import',
    run: async () => {
      const weeks = await weeksToImport(season);
      if (!weeks.length) return { season, weeks: 0, reason: 'no-final-games' };
      // The two maps are read ONCE and passed in: three weeks would otherwise
      // re-read a 26,700-row roster three times for no new information.
      const roster = await rosterMap();
      const matches = await matchMap(season);
      const per = [];
      let inserted = 0, updated = 0, requests = 0;
      for (const w of weeks) {
        const r = await importCfbWeek(season, w.week, {
          seasonPhase: w.season_phase, roster, matches,
        });
        requests += r.requests; inserted += r.inserted; updated += r.updated;
        per.push({ week: w.week, phase: w.season_phase, seasonType: r.seasonType,
          inserted: r.inserted, updated: r.updated, noGame: r.noGame, noPlayer: r.noPlayer });
      }
      return { season, weeks: weeks.length, requests, inserted, updated, per };
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { season } });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[cfb] player game-stats import FAILED',
      body: `season: ${season}\n\n${String(res.error ?? 'unknown error')}`,
    });
  }
  return Response.json({ ok: res.ok, ...res.summary });
}
