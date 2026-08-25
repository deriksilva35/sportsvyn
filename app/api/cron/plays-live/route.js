/**
 * /api/cron/plays-live - live play-by-play for Pick'em board games (CFB).
 *
 * ============================================================================
 * STRUCTURAL CALL: ITS OWN POLLER, NOT A RIDER ON gridiron-games.
 * ============================================================================
 * The sibling-not-extension law, applied to cadence. Folding this into the
 * existing five-minute games cron was the alternative, and it fails on four counts:
 *
 *   CADENCE. gridiron-games polls a LEAGUE every 5 minutes. This polls a GAME
 *   every 90 seconds. Merging them means either plays run 3.3x too slow or the
 *   score sync runs 3.3x too often - one of the two has to lose.
 *
 *   GRANULARITY. A score tick is ONE request covering every game in a league.
 *   A plays tick is one request PER GAME. They are different shapes of work,
 *   and a loop of N provider calls does not belong inside a route built around
 *   a single call - gridiron-games declares maxDuration 60 and already does two
 *   leagues.
 *
 *   FAILURE DOMAIN. A plays fetch failing must not stop scores syncing. Scores
 *   are the product; the drive strip is a garnish on top of them. Sharing a
 *   route means sharing a try/catch, a ledger row and an advisory lock.
 *
 *   SCOPE. gridiron-games is deliberately league-wide. This one is deliberately
 *   board-bounded (lib/pollers/playsScope.js). Putting a narrow scope inside a
 *   wide one invites the next edit to widen it by accident.
 *
 * Fires every minute; the 90s per-game throttle lives in dueForPoll, so a game
 * is polled on the first tick at or past 90s since its last successful write.
 *
 * Auth: Bearer ${CRON_SECRET}, the same secret as every other cron.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { liveBoardGames, lastPolledAt, dueForPoll } from '@/lib/pollers/playsScope';
import { PLAYS_POLL_INTERVAL_SEC } from '@/lib/pollers/cadence';
import { importCfbPlays } from '@/lib/gridiron/playsImport';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision, probeCfbdBudget } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SOURCE = 'plays-live';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const now = new Date();

  // THE SCOPE IS THE QUERY. Nothing outside an open Pick'em board is even
  // enumerated here, let alone fetched.
  const inScope = await liveBoardGames();
  if (!inScope.length) {
    // Sampled like gridiron-games' noop: one row per hour, so an idle week does
    // not bury the ledger - but the poller's silence stays explainable.
    if (now.getUTCMinutes() === 0) {
      await recordDecision(sql, { source: SOURCE, kind: 'noop', summary: { in_scope: 0 } });
    }
    return Response.json({ inScope: 0, polled: 0, decision: 'noop' });
  }

  const last = await lastPolledAt(inScope.map((g) => g.id));
  const due = dueForPoll(inScope, last, PLAYS_POLL_INTERVAL_SEC, now);
  if (!due.length) {
    return Response.json({ inScope: inScope.length, polled: 0, decision: 'throttled' });
  }

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'live-plays',
    budget: probeCfbdBudget,
    run: async () => {
      const games = [];
      let plays = 0, drives = 0, failed = 0;
      for (const g of due) {
        try {
          const r = await importCfbPlays(g.id);
          plays += r.written; drives += r.drives;
          games.push({ slug: g.slug, plays: r.written, drives: r.drives, status: r.providerStatus });
        } catch (e) {
          // ONE BAD GAME MUST NOT ABANDON THE SLATE. A provider hiccup on one
          // fixture cannot cost the other seven their drive strips; the failure
          // is counted, named, and the run reports it.
          failed += 1;
          games.push({ slug: g.slug, error: String(e?.message ?? e).slice(0, 160) });
        }
      }
      return {
        in_scope: inScope.length, due: due.length, requests: due.length,
        plays, drives, failed, games,
      };
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { in_scope: inScope.length } });
    return Response.json({ inScope: inScope.length, decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const failed = res.summary?.failed ?? 0;
  // ITS OWN ALARM SOURCE, per the kickoff-guard pattern: maybeAlert rate-limits
  // per source, so sharing one with the games poller would let an unrelated
  // failure silence this for six hours.
  if (!res.ok || failed > 0) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[pollers] ${SOURCE} ${!res.ok ? 'FAILED' : `${failed} game(s) failed`}`,
      body: `source: ${SOURCE}\nin scope: ${inScope.length}\ndue: ${res.summary?.due ?? '?'}\n\n`
        + (res.error ?? JSON.stringify(res.summary?.games ?? [], null, 1)),
      detail: (res.summary?.games ?? []).filter((g) => g.error),
    });
  }

  return Response.json({
    inScope: inScope.length, polled: res.summary?.due ?? 0,
    plays: res.summary?.plays ?? 0, failed, ok: res.ok, id: res.id,
  });
}
