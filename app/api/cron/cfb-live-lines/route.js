/**
 * /api/cron/cfb-live-lines — the live CFB box score (cfb_live_player_lines),
 * every live CFB game, league-wide. Ruling sun-8, 4 Oct 2026.
 *
 * ITS OWN CRON, NOT A PASSENGER. Until sun-8 this rode the gridiron-games
 * tick, inside syncCfbGames, after the games upsert. That tick's cfb-games run
 * already takes 87-112 s of its 120 s on a Saturday, and widening the box score
 * to every live game (sun-7) would have spent the same budget twice. Here it
 * has its own maxDuration, its own advisory lock and its own ledger source
 * ('cfb-live-lines' - the same source it always wrote, so the history reads
 * straight through the move).
 *
 * AT MINUTE 2, NOT MINUTE 0. "2-59/5" fires at :02, :07, :12 ... so it never
 * shares a tick with gridiron-games (*\/5, at :00, :05 ...). Two minutes
 * after a games tick is also when that tick has usually written the statuses
 * this reads: it enumerates matches.status = 'live', which gridiron-games and
 * the live poller set. A game that went final in between is skipped by the
 * write-time status re-check inside syncCfbLiveLines.
 *
 * NO LIVE GAME, NO CALL, (ALMOST) NO ROW. The live count is checked first; a
 * tick with nothing live makes no provider call and records a 'noop' decision
 * only on the first tick of each hour, the same sampling gridiron-games uses,
 * so an off-day leaves ~24 rows rather than 288.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { syncCfbLiveLines, LIVE_LINES_BUDGET_MS } from '@/lib/cfb/bdlLive';
import { LIVE_INTERVAL_MIN } from '@/lib/pollers/cadence';

export const dynamic = 'force-dynamic';
// 60 s, pinned to LIVE_LINES_MAX_DURATION_S in lib/cfb/bdlLive.js by
// lib/cfb/bdlLive.test.mjs. No game is started after LIVE_LINES_BUDGET_MS
// (40 s) from the top of this handler.
export const maxDuration = 60;

export const SOURCE = 'cfb-live-lines';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  // The deadline counts from HERE, not from inside the lock: the league
  // lookup, the lock's own connection and the ledger insert all spend the
  // same 60 s.
  const startedAt = Date.now();
  const now = new Date(startedAt);

  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'cfb' LIMIT 1`;
  if (!lg) return Response.json({ decision: 'no-league-row' });
  const leagueId = lg.id;

  const [{ live }] = await sql`
    SELECT count(*)::int AS live FROM matches WHERE league_id = ${leagueId} AND status = 'live'`;
  if (!live) {
    if (now.getUTCMinutes() < LIVE_INTERVAL_MIN) {
      await recordDecision(sql, { source: SOURCE, kind: 'noop', summary: { live: 0 } });
    }
    return Response.json({ decision: 'noop', live: 0 });
  }

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'live-poll',
    run: () => syncCfbLiveLines(leagueId, { deadlineAt: startedAt + LIVE_LINES_BUDGET_MS }),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { live } });
    return Response.json({ decision: 'skipped-locked', live });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[pollers] cfb-live-lines FAILED',
      body: `source: ${SOURCE}\nleagueId: ${leagueId}\n\n${res.error}`,
    });
  }
  return Response.json({ decision: 'live-poll', ok: res.ok, id: res.id, ...(res.ok ? {
    liveGames: res.summary.liveGames, written: res.summary.written,
    skippedForBudget: res.summary.skippedForBudget, timedOut: res.summary.timedOut,
    elapsedMs: res.summary.elapsedMs,
  } : {}) });
}
