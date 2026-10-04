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
 */
export function dueByState(games, lastPolled, now = new Date(), cfg = PLAYS_CADENCE) {
  const t = new Date(now).getTime();
  const out = [];
  for (const g of games ?? []) {
    const interval = playsIntervalFor(g, cfg);
    if (interval == null) continue;
    const last = laterOf(lastPolled?.get?.(g.id), g?.plays_poll?.at);
    if (last == null || last <= t - interval * 1000) out.push({ ...g, interval_sec: interval });
  }
  return out;
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
