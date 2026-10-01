// lib/six/score.js - a card against the box score, and the perfect six. PURE.
//
// PER SLOT, AS THE BOX DOES. A slot's points move while its game is live and
// stop when it goes final; the night settles only when every game is final AND
// its box is in (lib/six/settle.js), but a reader watching the 7:00 game does
// not wait for the 10:30 one to see their guard's line.
//
// A DNP IS A ZERO, NOT A DNF (ruling thu-17). A player picked before the tip
// who then does not play - the late scratch - has a box row with no minutes,
// or no row at all, in a final game: he scores 0 and the slot says DNP. A DNF
// is a different fact (an EMPTY slot at the night's last tip, rules.js
// nightState) and it costs the whole night.
//
// A VOID GAME (postponed / cancelled / not_needed) scores its slot 0, and the
// slot says so - it is neither a DNP (he did not choose not to play) nor a DNF.

import { SLOTS, CARD_SIZE, eligible, isVoidStatus } from './rules.js';
import { linePoints, statChips, nbaLine, round1 } from '../nba/fantasyPoints.js';

/**
 * @param lineup   { slot: { playerId, matchId, ... } }
 * @param statBy   Map(`${matchId}:${playerId}` -> nba_player_game_stats row)
 * @param matchBy  Map(String(matchId) -> { status })
 */
export function scoreCard(lineup = {}, statBy = new Map(), matchBy = new Map()) {
  const slots = SLOTS.map((slot) => {
    const pick = lineup?.[slot] ?? null;
    if (!pick?.playerId) return { slot, state: 'empty', points: null, chips: [], line: null, dnp: false };
    const status = matchBy.get(String(pick.matchId))?.status ?? 'scheduled';
    const row = statBy.get(`${pick.matchId}:${pick.playerId}`) ?? null;
    if (isVoidStatus(status)) {
      return { slot, playerId: pick.playerId, matchId: pick.matchId, state: 'void', points: 0, chips: [], line: null, dnp: false };
    }
    const final = status === 'final';
    const live = status === 'live';
    // DNP: the game is over and he has no minutes. Only a FINAL makes it a DNP -
    // mid-game a bench player with no minutes YET is "not yet", not "did not".
    const dnp = final && (!row || row.dnp === true);
    const points = row && !row.dnp ? linePoints(row) : (final ? 0 : live ? 0 : null);
    return {
      slot, playerId: pick.playerId, matchId: pick.matchId,
      state: final ? 'final' : live ? 'live' : 'pending',
      points,
      chips: row && !row.dnp ? statChips(row) : [],
      line: final && dnp ? 'DNP' : nbaLine(row && !row.dnp ? row : null),
      dnp,
    };
  });
  const filled = slots.filter((s) => s.state !== 'empty').length;
  const done = slots.filter((s) => s.state === 'final' || s.state === 'void').length;
  const total = round1(slots.reduce((a, s) => a + (s.points ?? 0), 0));
  return { slots, total, filled, done, complete: filled === CARD_SIZE && done === CARD_SIZE };
}

/** Can these players be seated in the six slots? Tiny bipartite matching. PURE. */
export function seatable(players = []) {
  if (players.length > CARD_SIZE) return null;
  const seat = {};
  const order = [...players].sort((a, b) => slotCount(a) - slotCount(b));
  const go = (i) => {
    if (i === order.length) return true;
    for (const s of SLOTS) {
      if (seat[s] || !eligible(s, order[i].position)) continue;
      seat[s] = order[i];
      if (go(i + 1)) return true;
      delete seat[s];
    }
    return false;
  };
  return go(0) ? seat : null;
}
const slotCount = (p) => SLOTS.filter((s) => eligible(s, p.position)).length;

/**
 * THE PERFECT SIX: the best legal card the night allowed - six who played,
 * seated G G F F C UTIL by their positions, no more than `cap` from one team.
 * PURE.
 *
 * EXACT OVER ITS CANDIDATES, and the candidates are the top 24 overall plus the
 * top 12 of each position class (G, F, C). A player outside all of those would
 * need a dozen better players at every slot he can fill to be shut out by the
 * team cap at once - not a night the NBA plays - so the trim costs nothing and
 * keeps a 15-game slate's ~400 box lines from becoming a 400-choose-6 search.
 * Branch and bound in points order: the bound is what is chosen plus the best
 * still unseen, so a branch that cannot beat the best so far is dropped.
 *
 * @param players [{ playerId, name, position, teamId, team, matchId, points }]
 * @returns { total, picks: [{ slot, ...player }] } or null when no legal six exists
 */
export function perfectSix(players = [], { cap = 2 } = {}) {
  const sorted = [...players].filter((p) => Number.isFinite(Number(p.points)))
    .sort((a, b) => b.points - a.points || String(a.playerId).localeCompare(String(b.playerId)));
  const keep = new Map();
  for (const p of sorted.slice(0, 24)) keep.set(p.playerId, p);
  for (const slot of ['g1', 'f1', 'c']) {
    for (const p of sorted.filter((x) => eligible(slot, x.position)).slice(0, 12)) keep.set(p.playerId, p);
  }
  const cand = [...keep.values()].sort((a, b) => b.points - a.points);
  let best = null; let bestTotal = -Infinity;
  const chosen = []; const perTeam = new Map();
  const dfs = (i, sum) => {
    if (chosen.length === CARD_SIZE) {
      if (sum > bestTotal) { const seat = seatable(chosen); if (seat) { bestTotal = sum; best = seat; } }
      return;
    }
    if (i >= cand.length) return;
    let bound = sum;
    for (let k = i, n = 0; k < cand.length && n < CARD_SIZE - chosen.length; k += 1, n += 1) bound += cand[k].points;
    if (bound <= bestTotal) return;
    const p = cand[i];
    const t = String(p.teamId);
    if ((perTeam.get(t) ?? 0) < cap) {
      chosen.push(p); perTeam.set(t, (perTeam.get(t) ?? 0) + 1);
      if (seatable(chosen)) dfs(i + 1, sum + p.points);
      chosen.pop(); perTeam.set(t, perTeam.get(t) - 1);
    }
    dfs(i + 1, sum);
  };
  dfs(0, 0);
  if (!best) return null;
  return {
    total: round1(bestTotal),
    picks: SLOTS.map((slot) => ({ slot, ...best[slot] })),
  };
}

/**
 * RANKS, ties shared: 1 + the number of strictly better scores. A DNF night
 * scores 0 and ranks where 0 ranks - it is on the board, saying DNF. PURE.
 */
export function rankScores(rows = []) {
  const scores = rows.map((r) => Number(r.points) || 0);
  return rows.map((r, i) => ({ ...r, rank: 1 + scores.filter((s) => s > scores[i]).length }));
}
