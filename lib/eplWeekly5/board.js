// lib/eplWeekly5/board.js - the national board, a reader's rank, and the
// perfect five.
//
// SETTLED, THE BOARD IS contest_entries.score. Before that it is every card
// scored as it stands ("rank 412 of 2,980 so far") through the same scoreSlot the
// card uses - one arithmetic, two moments.
//
// A LEAGUE BOARD IS THIS BOARD WITH memberIds (lib/october/board.js's rule):
// one card per reader per gameweek, shown on every board they belong to.

import { sql } from '../db.js';
import { SLOTS, SLOT_LABEL, MAX_PER_CLUB } from './rules.js';
import { fixturesNow, linesFor, scoreSlot, pickPairs } from './data.js';

/** Every entry's total as it stands. Settled: the stored score. */
export async function standings(contest, { memberIds = null } = {}) {
  const entries = memberIds != null
    ? await sql`
      SELECT e.user_id, e.lineup, e.score, u.handle, u.name, u.is_house
        FROM contest_entries e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.contest_id = ${contest.id} AND e.user_id = ANY(${memberIds})`
    : await sql`
      SELECT e.user_id, e.lineup, e.score, u.handle, u.name, u.is_house
        FROM contest_entries e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.contest_id = ${contest.id}`;
  let totals;
  if (contest.settled) {
    totals = entries.map((e) => ({ e, total: Number(e.score ?? 0) }));
  } else {
    const fx = await fixturesNow(contest.board ?? []);
    const board = contest.board ?? [];
    const pairs = entries.flatMap((e) => SLOTS.flatMap((s) => pickPairs(e.lineup?.[s], board)));
    const lines = await linesFor(pairs);
    totals = entries.map((e) => ({
      e,
      total: SLOTS.reduce((a, s) => {
        const p = e.lineup?.[s];
        if (!p?.playerId) return a;
        return a + (scoreSlot(p, board, fx, lines).points ?? 0);
      }, 0),
    }));
  }
  // Only cards with a pick on them stand on the board.
  const ranked = totals.filter(({ e }) => SLOTS.some((s) => e.lineup?.[s]?.playerId))
    .sort((a, b) => b.total - a.total || String(a.e.handle ?? '').localeCompare(String(b.e.handle ?? '')));
  // COMPETITION RANKING: ties share a rank (1, 2, 2, 4).
  let prev = null; let rank = 0;
  return ranked.map((r, i) => {
    if (prev === null || r.total !== prev) { rank = i + 1; prev = r.total; }
    return { userId: r.e.user_id, handle: r.e.handle ?? r.e.name ?? 'player', house: r.e.is_house === true, total: r.total, rank };
  });
}

export async function rankOf(contest, userId) {
  const all = await standings(contest);
  const me = all.find((r) => String(r.userId) === String(userId));
  return me ? { rank: me.rank, of: all.length, total: me.total } : { rank: null, of: all.length, total: null };
}

export async function boardTop(contest, { limit = 50, memberIds = null } = {}) {
  return (await standings(contest, { memberIds })).slice(0, limit);
}

/**
 * THE PERFECT FIVE: the best card the rules allowed, from every player's final
 * points this gameweek - one per DEF/GK, MID, FWD, two FLEX, at most two per
 * club. PURE.
 *
 * Exhaustive over each position's top K, which is exact whenever the true
 * optimum's players sit in those lists; K = 14 leaves room for a full card of
 * displaced picks (four other slots) plus two capped clubs' worth of players.
 *
 * @param cands [{ playerId, pos: 'GK'|'DEF'|'MID'|'FWD', clubId, points, name, club }]
 */
export function perfectFive(cands = [], { K = 14 } = {}) {
  const by = (test) => cands.filter(test).sort((a, b) => b.points - a.points).slice(0, K);
  const defgk = by((c) => c.pos === 'GK' || c.pos === 'DEF');
  const mid = by((c) => c.pos === 'MID');
  const fwd = by((c) => c.pos === 'FWD');
  // FLEX IS OUTFIELD ONLY (thu-42): no keeper in the two FLEX slots.
  const flex = [...new Map([...defgk, ...mid, ...fwd, ...by(() => true)].filter((c) => c.pos !== 'GK').map((c) => [c.playerId, c])).values()]
    .sort((a, b) => b.points - a.points);
  let best = null;
  const ok = (card) => {
    const n = new Map();
    for (const c of card) { n.set(c.clubId, (n.get(c.clubId) ?? 0) + 1); if (n.get(c.clubId) > MAX_PER_CLUB) return false; }
    return new Set(card.map((c) => c.playerId)).size === card.length;
  };
  for (const a of defgk) for (const b of mid) for (const c of fwd) {
    const base = [a, b, c];
    if (!ok(base)) continue;
    const baseSum = a.points + b.points + c.points;
    if (best && baseSum + 2 * (flex[0]?.points ?? 0) <= best.score) continue;
    for (let i = 0; i < flex.length; i += 1) {
      if (best && baseSum + 2 * flex[i].points <= best.score) break;
      for (let j = i + 1; j < flex.length; j += 1) {
        const score = baseSum + flex[i].points + flex[j].points;
        if (best && score <= best.score) break;
        const card = [...base, flex[i], flex[j]];
        if (ok(card)) best = { score, card };
      }
    }
  }
  if (!best) return null;
  return {
    score: best.score,
    players: best.card.map((c, i) => ({
      slot: SLOT_LABEL[SLOTS[i]], playerId: c.playerId, name: c.name, club: c.club, pos: c.pos, points: c.points,
    })),
  };
}
