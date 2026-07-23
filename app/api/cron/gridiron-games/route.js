/**
 * /api/cron/gridiron-games — smart-tick games poller. Fires every 5 min; for each
 * of CFB + NFL it runs a games-only sync only when it should:
 *   · live window  -> kind 'live-poll'  (a game is on; 5-min cadence)
 *   · else baseline -> kind 'baseline'  (last ok games run older than
 *                       BASELINE_INTERVAL_MIN)
 *   · else          -> kind 'noop'      (nothing to do; sampled to keep the table
 *                       quiet — recorded only on the top-of-hour tick, so ~1
 *                       noop row per source per hour)
 * Runs under a per-source advisory lock; if held, records 'skipped-locked'.
 * Season is resolved at runtime (2026), so the first runs bootstrap the 2026
 * schedule (idempotent upserts). Every decision lands in sync_runs. A failed run
 * OR unknownStatus > 0 (fail-loud mapStatus miss — e.g. an unverified NFL live
 * token) triggers the throttled alert.
 *
 * Auth: Bearer ${CRON_SECRET} (same secret as the soccer crons).
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { syncNflGames, syncCfbGames } from '@/lib/gridiron/sync';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';
import { isLiveWindow } from '@/lib/pollers/liveWindow';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision, lastGamesRunAt, probeCfbdBudget } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { BASELINE_INTERVAL_MIN, LIVE_INTERVAL_MIN } from '@/lib/pollers/cadence';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LEAGUES = [
  { slug: 'nfl', source: 'nfl-games', run: (leagueId, season) => syncNflGames(leagueId, season), cfbd: false },
  { slug: 'cfb', source: 'cfb-games', run: (leagueId, season) => syncCfbGames(leagueId, season), cfbd: true },
];

async function leagueIdBySlug(slug) {
  const r = await sql`SELECT id FROM leagues WHERE slug = ${slug} LIMIT 1`;
  return r[0]?.id ?? null;
}

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const now = new Date();
  const season = resolveSeasonYear(now);
  // Sample noop rows: only the first tick of each hour records one.
  const recordNoop = now.getUTCMinutes() < LIVE_INTERVAL_MIN;
  const decisions = [];

  for (const lg of LEAGUES) {
    const leagueId = await leagueIdBySlug(lg.slug);
    if (leagueId == null) { decisions.push({ source: lg.source, decision: 'no-league-row' }); continue; }

    const live = await isLiveWindow(sql, leagueId, now);
    let kind;
    if (live) {
      kind = 'live-poll';
    } else {
      const last = await lastGamesRunAt(sql, lg.source);
      const elapsedMin = last ? (now.getTime() - new Date(last).getTime()) / 60000 : Infinity;
      kind = elapsedMin >= BASELINE_INTERVAL_MIN ? 'baseline' : 'noop';
    }

    if (kind === 'noop') {
      if (recordNoop) await recordDecision(sql, { source: lg.source, kind: 'noop', summary: { season } });
      decisions.push({ source: lg.source, decision: 'noop', season });
      continue;
    }

    const outcome = await withAdvisoryLock(lg.source, async () => {
      const res = await recordRun(sql, {
        source: lg.source,
        kind,
        budget: lg.cfbd ? probeCfbdBudget : null,
        run: () => lg.run(leagueId, season),
      });
      const unknown = res.summary?.unknownStatus ?? 0;
      if (!res.ok || unknown > 0) {
        await maybeAlert(sql, {
          source: lg.source,
          subject: `[pollers] ${lg.source} ${!res.ok ? 'FAILED' : `unknownStatus=${unknown}`}`,
          body: `source: ${lg.source}\nkind: ${kind}\nseason: ${season}\n\n${res.error ?? JSON.stringify(res.summary)}`,
        });
      }
      return res;
    });

    if (outcome.locked) {
      await recordDecision(sql, { source: lg.source, kind: 'skipped-locked', summary: { season } });
      decisions.push({ source: lg.source, decision: 'skipped-locked' });
    } else {
      decisions.push({ source: lg.source, decision: kind, ok: outcome.result.ok, id: outcome.result.id });
    }
  }

  return Response.json({ season, decisions });
}
