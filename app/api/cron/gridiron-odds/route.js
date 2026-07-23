/**
 * /api/cron/gridiron-odds — The Odds API market poller (NFL + CFB). Fires every 15
 * min. Pre-kickoff only, freeze-at-kickoff by construction (only status='scheduled'
 * matches are join targets). Smart tick, evaluated once for both sports:
 *   · any scheduled gridiron game kicks off within ODDS_FINAL_WINDOW_HOURS (6h)
 *       -> kind 'tight'    (poll both sports now; 15-min cadence into kickoff)
 *   · else top-of-hour tick
 *       -> kind 'baseline' (one hourly poll of both sports)
 *   · else
 *       -> kind 'noop'     (sampled once/hour on the :15 tick to keep the table quiet)
 *
 * Each polled sport: fetchSportOdds (3 credits) -> join events to matches ->
 * upsert h2h/spread/total into odds_markets (is_current flip + movement). Recorded
 * in sync_runs as source 'nfl-odds' / 'cfb-odds' with the full summary incl. the
 * x-requests-remaining / x-requests-used budget headers. Under a per-source
 * advisory lock; a failed run triggers the throttled alert. A daily 00:00-UTC tick
 * stamps the movement baseline (the 24h reference), matching the soccer refresh.
 *
 * Auth: Bearer ${CRON_SECRET} (same secret as the other crons).
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { ingestSportOdds } from '@/lib/gridiron/oddsIngest';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { ODDS_TICK_MIN, ODDS_FINAL_WINDOW_HOURS } from '@/lib/pollers/cadence';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LEAGUES = [
  { sport: 'nfl', slug: 'nfl', source: 'nfl-odds' },
  { sport: 'cfb', slug: 'cfb', source: 'cfb-odds' },
];
const SLUGS = LEAGUES.map((l) => l.slug);

// True when any scheduled gridiron game kicks off in (now, now + hours].
async function anyKickoffWithin(hours) {
  const r = await sql`
    SELECT 1
    FROM matches m
    JOIN leagues l ON l.id = m.league_id
    WHERE l.slug = ANY(${SLUGS})
      AND m.status = 'scheduled'
      AND m.kickoff_at > now()
      AND m.kickoff_at <= now() + (${hours} * interval '1 hour')
    LIMIT 1`;
  return r.length > 0;
}

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const now = new Date();
  const topOfHour = now.getUTCMinutes() < ODDS_TICK_MIN;
  // Stamp the 24h movement baseline once/day at the 00:00-UTC tick.
  const stampBaseline = now.getUTCHours() === 0 && topOfHour;

  const tight = await anyKickoffWithin(ODDS_FINAL_WINDOW_HOURS);
  let kind;
  if (tight) kind = 'tight';
  else if (topOfHour) kind = 'baseline';
  else kind = 'noop';

  if (kind === 'noop') {
    // One noop sample per hour (the :15 tick) for liveness parity with the games cron.
    const recordNoop = now.getUTCMinutes() >= ODDS_TICK_MIN && now.getUTCMinutes() < 2 * ODDS_TICK_MIN;
    if (recordNoop) {
      for (const lg of LEAGUES) await recordDecision(sql, { source: lg.source, kind: 'noop', summary: {} });
    }
    return Response.json({ decision: 'noop' });
  }

  const decisions = [];
  for (const lg of LEAGUES) {
    const outcome = await withAdvisoryLock(lg.source, async () => {
      const res = await recordRun(sql, {
        source: lg.source,
        kind,
        run: () => ingestSportOdds(sql, { sport: lg.sport, leagueSlug: lg.slug, stampBaseline }),
      });
      if (!res.ok) {
        await maybeAlert(sql, {
          source: lg.source,
          subject: `[pollers] ${lg.source} FAILED`,
          body: `source: ${lg.source}\nkind: ${kind}\n\n${res.error}`,
        });
      }
      return res;
    });

    if (outcome.locked) {
      await recordDecision(sql, { source: lg.source, kind: 'skipped-locked', summary: {} });
      decisions.push({ source: lg.source, decision: 'skipped-locked' });
    } else {
      decisions.push({
        source: lg.source,
        decision: kind,
        ok: outcome.result.ok,
        id: outcome.result.id,
        matched: outcome.result.summary?.matched,
        unmatched: outcome.result.summary?.unmatched,
        upserted: outcome.result.summary?.upserted,
      });
    }
  }

  return Response.json({ kind, stampBaseline, decisions });
}
