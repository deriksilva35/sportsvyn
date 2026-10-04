// lib/pollers/playsCadence.js - HOW OFTEN plays-live re-reads each live game.
//
// THE COST (sun-9 f). /live/plays is one CFBD call per game per poll, and it
// was ~54% of the whole CFBD month: with CFB_PLAYS_ALL on, every live FBS game
// was read every 90 s whatever was happening in it - through halftime, after
// CFBD already said Final, and for games no board carries. 3 Oct alone spent
// 3,685 calls here.
//
// THE RULE: the interval depends on the game's state. ONE CONFIG OBJECT, so it
// can be retuned in one place:
//
//   scheduled / pre-kick           not in scope at all (liveBoardGames: status live)
//   live, on an open Pick'em board 90 s   (as before - the board is the product)
//   live, on no board              5 min
//   CFBD says Halftime             12 min after the poll that saw it
//   CFBD says End of Period        as live (a quarter break is a minute or two)
//   CFBD says Delayed              5 min
//   CFBD says Final                one more import (late plays), then never again
//   NFL (BDL, not CFBD quota)      90 s, unchanged
//
// THE USER-VISIBLE COST, STATED: for a CFB game on no open board, the drive
// strip, the plays list and the CFB win-prob (which reads these plays) now
// move every 5 minutes instead of every 90 seconds. The score and clock do
// not - they come from the live poller's /scoreboard, not from here. Board
// games are untouched.
//
// THE STATE comes from the last /live/plays response, recorded on the match as
// metadata.plays_poll = { status, at, finals } (recordPlaysPoll, playsScope.js).
// `at` is also the honest "last polled" time for a game whose feed is still
// empty, which plays.updated_at cannot be.

export const PLAYS_CADENCE = Object.freeze({
  boardSec: 90,
  offBoardSec: 300,
  halftimeSec: 720,
  delayedSec: 300,
  // End of Period polls at the live rate for the game (board or not).
  endOfPeriodAsLive: true,
  // Imports AFTER the first one that saw Final. 1 = one last import, then stop.
  finalExtraImports: 1,
  nflSec: 90,
});

/**
 * PURE. Seconds until this game is due again after its last poll, or null to
 * stop polling it. game: { league, on_board, plays_poll: { status, finals } }.
 */
export function playsIntervalFor(game, cfg = PLAYS_CADENCE) {
  if (game?.league === 'nfl') return cfg.nflSec;
  const live = game?.on_board ? cfg.boardSec : cfg.offBoardSec;
  const poll = game?.plays_poll ?? null;
  switch (poll?.status ?? null) {
    case 'Final': return Number(poll.finals ?? 1) > cfg.finalExtraImports ? null : live;
    case 'Halftime': return cfg.halftimeSec;
    case 'Delayed': return cfg.delayedSec;
    case 'End of Period': return cfg.endOfPeriodAsLive ? live : cfg.offBoardSec;
    default: return live;   // 'In Progress', never polled, or a word we do not know
  }
}

/**
 * PURE. The in-scope games due this tick. lastPolled: Map(id -> plays.updated_at);
 * a game's own plays_poll.at counts too, whichever is later. Never polled ->
 * due now. Each due game carries `interval_sec` for the ledger.
 *
 * OLDEST-DUE FIRST (sun-12): never-polled games, then by how long past due
 * each one is. A game skipped for budget keeps its old poll time, so it is
 * the most overdue on the next tick and goes first - nothing starves.
 */
export function dueByState(games, lastPolled, now = new Date(), cfg = PLAYS_CADENCE) {
  const t = new Date(now).getTime();
  const out = [];
  for (const g of games ?? []) {
    const interval = playsIntervalFor(g, cfg);
    if (interval == null) continue;
    const last = laterOf(lastPolled?.get?.(g.id), g?.plays_poll?.at);
    if (last == null || last <= t - interval * 1000) {
      out.push({ ...g, interval_sec: interval, overdue_ms: last == null ? Infinity : t - interval * 1000 - last });
    }
  }
  // Stable sort: equal overdue keeps the scope's kickoff order.
  return out.sort((a, b) => (b.overdue_ms === a.overdue_ms ? 0 : b.overdue_ms > a.overdue_ms ? 1 : -1));
}

// ---------------------------------------------------------------------------
// THE TIME BUDGET (sun-12, Derik: "a time budget that stops cleanly before 60s").
//
// plays-live is a 60 s Vercel function. On Saturday 3 Oct it was killed 23
// times ("Task timed out after 60 seconds"), each kill leaving a sync_runs row
// with finished_at NULL: p99 39.7 s, max 57.5 s, ~11 games due a tick, three
// at a time because CFBD refuses concurrent /live/plays.
//
//   startCutoffMs  no NEW game starts after this, measured from the handler's
//                  first line;
//   hardStopMs     every in-flight provider call is bounded by what is left
//                  to this (lib/cfbd/client.js deadlineAt), so a call started
//                  at 44.9 s gets ~10 s, not 25 - 45 + 25 > 60 cannot happen;
//   the last 5 s   are for closing the ledger row, the alert, and the reply.
//
// A game not started is COUNTED (skippedForBudget) and, being the most
// overdue, first in line next tick (dueByState's order).
export const PLAYS_BUDGET = Object.freeze({
  startCutoffMs: 45_000,
  hardStopMs: 55_000,
});

/**
 * Work through `queue` (already in priority order), `pool` at a time, starting
 * nothing once clock() - startedAt >= startCutoffMs. Each work(item) gets the
 * hard deadline (epoch ms) to pass to its provider calls. Returns
 * { started, skipped } in queue order. `clock` is injectable for tests.
 */
export async function drainWithBudget(queue, {
  pool = 1, startedAt, work, clock = Date.now, cfg = PLAYS_BUDGET,
}) {
  const items = [...queue];
  const started = [];
  const deadlineAt = startedAt + cfg.hardStopMs;
  const worker = async () => {
    while (items.length && clock() - startedAt < cfg.startCutoffMs) {
      const it = items.shift();
      started.push(it);
      await work(it, { deadlineAt });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(pool, items.length)) }, worker));
  return { started, skipped: items, deadlineAt };
}

/** The later of two instants, either of which may be absent; null if both are. */
function laterOf(a, b) {
  let best = null;
  for (const x of [a, b]) {
    if (x == null) continue;
    const ms = new Date(x).getTime();
    if (Number.isNaN(ms)) continue;
    if (best == null || ms > best) best = ms;
  }
  return best;
}

/** PURE. The next plays_poll value after a poll that saw `status`. */
export function nextPlaysPoll(prev, status, at = new Date()) {
  const finals = status === 'Final' ? Number(prev?.finals ?? 0) + 1 : 0;
  return { status: status ?? null, at: new Date(at).toISOString(), finals };
}
