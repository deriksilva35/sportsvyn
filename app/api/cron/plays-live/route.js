/**
 * /api/cron/plays-live - live play-by-play: every live NFL game, and the CFB
 * games on an open Pick'em board (lib/pollers/playsScope.js says why).
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
 * Fires every minute; the per-game throttle lives in dueByState
 * (lib/pollers/playsCadence.js, sun-9): a game is polled on the first tick at
 * or past ITS interval since its last poll - 90 s on an open board, 5 min off
 * one, 12 min at halftime, never again after Final plus one.
 *
 * Auth: Bearer ${CRON_SECRET}, the same secret as every other cron.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { liveBoardGames, lastPolledAt, cfbPlaysAll, recordPlaysPoll } from '@/lib/pollers/playsScope';
import { dueByState } from '@/lib/pollers/playsCadence';
import { importPlaysFor } from '@/lib/gridiron/playsImport';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision, probeCfbdBudget } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SOURCE = 'plays-live';

// CFB_PLAYS_ALL WIDENS THE SLATE THREEFOLD, and this route imports one game at
// a time inside a 60 s function: 19 Sep measured ~1 s per game at the median
// and 4 s at p90, so thirty-odd due games in a row would time out. With the
// flag on the due games are imported POOL at a time, and no new game starts
// after DEADLINE_MS - one left over is simply due on the next tick. With the
// flag off the loop below is main's, one at a time, unchanged.
// THREE, NOT SIX (26 Sep): CFBD's /live/plays refuses concurrent requests
// (429), and six at once lost 3-7 games a minute across the slate. Twenty
// games at ~1 s each, three at a time, is still well inside DEADLINE_MS.
const POOL = 3;
const DEADLINE_MS = 45_000;

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
  // CADENCE BY STATE (sun-9 f, lib/pollers/playsCadence.js): 90 s on a board,
  // 5 min off it, 12 min at halftime, stop after Final. NFL stays at 90 s.
  const due = dueByState(inScope, last, now);
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
      const one = async (g) => {
        try {
          const r = await importPlaysFor(g.id);
          plays += r.written; drives += r.drives;
          // What CFBD said decides when we ask again. A failed write here
          // costs only the cadence hint, never the plays just written.
          if (g.league === 'cfb') {
            try { await recordPlaysPoll(g, r.providerStatus); }
            catch (e) { console.warn(`[plays-live] plays_poll not recorded for ${g.slug}: ${String(e?.message ?? e).slice(0, 120)}`); }
          }
          games.push({ slug: g.slug, plays: r.written, drives: r.drives, status: r.providerStatus, every_sec: g.interval_sec });
        } catch (e) {
          // ONE BAD GAME MUST NOT ABANDON THE SLATE. A provider hiccup on one
          // fixture cannot cost the other seven their drive strips; the failure
          // is counted, named, and the run reports it.
          failed += 1;
          games.push({ slug: g.slug, error: String(e?.message ?? e).slice(0, 160) });
          // A failed CFB read is still a poll: stamp it, so a feed that is
          // not up yet ("No plays found") is asked at the game's interval,
          // not every minute.
          if (g.league === 'cfb') await recordPlaysPoll(g, null).catch(() => {});
        }
      };
      const all = cfbPlaysAll();
      const started = [];
      if (!all) {
        for (const g of due) { started.push(g); await one(g); }
      } else {
        const t0 = Date.now(); const queue = [...due];
        const worker = async () => {
          while (queue.length && Date.now() - t0 < DEADLINE_MS) {
            const g = queue.shift(); started.push(g); await one(g);
          }
        };
        await Promise.all(Array.from({ length: Math.min(POOL, due.length) }, worker));
      }
      // CALLS PER CYCLE, so a Saturday's real burn can be summed from the
      // ledger and set against the estimate: one CFBD /live/plays per CFB game
      // started, and one NFL provider request (two past 100 plays) per NFL game.
      const cfbdCalls = started.filter((g) => g.league === 'cfb').length;
      const nflGames = started.filter((g) => g.league === 'nfl').length;
      const skipped = due.length - started.length;
      console.log(`[plays-live] cycle cfb_plays_all=${all ? 'on' : 'off'} in_scope=${inScope.length} due=${due.length} cfbd_calls=${cfbdCalls} nfl_games=${nflGames} skipped_deadline=${skipped}`);
      return {
        in_scope: inScope.length, due: due.length, requests: started.length,
        cfb_plays_all: all, cfbd_calls: cfbdCalls, nfl_games: nflGames, skipped_deadline: skipped,
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
