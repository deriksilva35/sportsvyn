/**
 * /api/cron/epl-player-stats — EPL per-player match stats (API-Sports).
 *
 * AFTER FINALS, NEVER A PER-MINUTE POLL. Player stats are settled when the
 * match is; watching a game in progress spends requests to re-read numbers
 * that are still moving. This rides the post-final window like the other
 * settle-shaped jobs: a few times a day, picking up whatever has gone final
 * since the last pass. Re-running is free of consequence because the import is
 * idempotent on (player_id, match_id).
 *
 * ONE SURFACE, ONE SOURCE. This is the API-Sports leg. EPL PRICES come from
 * The Odds API through /api/cron/gridiron-props and /api/cron/gridiron-odds and
 * live in odds_markets. Same league, two vendors, and they never meet.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { importEplPlayerStats } from '@/lib/soccer/playerStatsImport';
import { zeroMatchAlert } from '@/lib/gridiron/propsIngest';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SOURCE = 'epl-player-stats';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => {
    const res = await recordRun(sql, {
      source: SOURCE,
      kind: 'daily',
      run: () => importEplPlayerStats(sql, { limit: 20 }),
    });
    if (!res.ok) {
      await maybeAlert(sql, {
        source: SOURCE,
        subject: `[pollers] ${SOURCE} FAILED`,
        body: `source: ${SOURCE}\n\n${res.error}`,
      });
      return res;
    }
    // ZERO-MATCH GUARD, own source key. Scoped finals with zero fixtures read
    // means the provider ids or the endpoint moved - a run that writes nothing
    // is a failed run, not a quiet one.
    const zero = zeroMatchAlert({
      events: res.summary?.scoped ?? 0,
      matched: res.summary?.fixtures ?? 0,
      source: SOURCE,
    });
    if (zero) {
      await maybeAlert(sql, {
        source: `${SOURCE}-zeromatch`,
        subject: `[pollers] ${SOURCE} MATCHED NOTHING`,
        body: zero,
      });
    }
    return res;
  });

  return Response.json(outcome.locked
    ? { source: SOURCE, decision: 'skipped-locked' }
    : {
      source: SOURCE,
      ok: outcome.result.ok,
      scoped: outcome.result.summary?.scoped,
      fixtures: outcome.result.summary?.fixtures,
      inserted: outcome.result.summary?.inserted,
      updated: outcome.result.summary?.updated,
      unmatchedPlayers: outcome.result.summary?.unmatchedPlayers,
    });
}
