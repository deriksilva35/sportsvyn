// lib/draft/bestball.js - a drafted roster becomes a six-slot lineup. PURE.
//
// ============================================================================
// WHY THIS FILE EXISTS AT ALL
// ============================================================================
// lib/weekly/settle.js opens with "ONE JOB, BOTH GAMES. Nothing below reads
// game_type. A contest is a board, a week and a set of entries whose lineup is
// six player ids; the Weekly fills that lineup from a builder and The Draft
// fills it from a draft room, and by the time settlement runs the two are the
// same shape." This module is the sentence "fills it from a draft room".
//
// The Draft's entry is a ROSTER - fifteen-odd players taken across six rounds.
// Settlement scores a LINEUP - six slots. Best-ball is the rule that turns one
// into the other, and it runs at settle rather than at lock because it needs
// the real scores to choose.
//
// ============================================================================
// GREEDY IS OPTIMAL HERE, AND IT IS WORTH KNOWING WHY
// ============================================================================
// Five of the six slots (RB, WR, TE, FLEX, FLEX2) draw from ONE pool - the
// RB/WR/TE players on the roster - under nothing but a minimum of one apiece.
// So: field the best RB, the best WR and the best TE, then fill both FLEX slots
// with the best two players left, whatever position they are. No exchange can
// improve that. Any lineup must contain at least one of each, so spending those
// three mandatory places on your best at each position is free, and the two
// remaining places are unconstrained.
//
// This is not a shortcut around an assignment problem; it IS the answer to this
// particular one. The moment a real constraint appears - a superflex, a
// position cap, two TEs required - the argument dies and this needs to become a
// proper search. A test pins the property so that change cannot pass quietly.
//
// A MISSING SLOT SCORES ZERO, NOT NULL. A roster with no tight end fields no
// tight end and takes the zero; scoreLineup already treats an absent id as
// zero, and null would propagate into the perfect-lineup search as a hole.

import { SLOTS } from '../daily/play.js';

/** RB, WR and TE are flex-eligible. QB is not - the Weekly's rule, unchanged. */
const FLEX_POS = new Set(['RB', 'WR', 'TE']);

/**
 * Choose the best six from a roster, given the week's scored board.
 *
 * @param {Array}  roster  the drafted players: [{ id, pos }] where id is an
 *                         nfl_players.id, already bridged from ffc_player_id
 * @param {Array}  board   the contest board WITH points, from poolWithScores
 * @returns {{lineup: object, bench: Array, unscored: Array}}
 */
export function bestBall(roster, board) {
  const byId = new Map((board ?? []).map((p) => [String(p.id), p]));

  // A drafted player the board cannot score is carried out separately rather
  // than silently treated as a zero. Zero and unknown are different facts, and
  // an entry full of unknowns is a bridge failure worth surfacing, not a bad
  // week worth reporting.
  const scored = [];
  const unscored = [];
  for (const r of roster ?? []) {
    const p = byId.get(String(r.id));
    if (!p) { unscored.push(r); continue; }
    scored.push({ id: p.id, name: p.name, pos: p.pos ?? r.pos, points: Number(p.points) || 0 });
  }

  // Highest first, and ties broken by id so the same roster and the same board
  // always produce the same lineup. A settle that is not reproducible cannot be
  // replayed, and the replay harness is how a disputed week gets checked.
  const rank = (a, b) => (b.points - a.points) || (Number(a.id) - Number(b.id));
  const pool = [...scored].sort(rank);

  const used = new Set();
  const take = (pred) => {
    const p = pool.find((x) => !used.has(x.id) && pred(x));
    if (p) used.add(p.id);
    return p ?? null;
  };

  const lineup = {};
  const chosen = {};
  // The three mandatory single-position slots first, then QB, then the flexes.
  for (const [slot, pos] of [['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']]) {
    const p = take((x) => x.pos === pos);
    if (p) { lineup[slot] = p.id; chosen[slot] = p; }
  }
  for (const slot of ['FLEX', 'FLEX2']) {
    const p = take((x) => FLEX_POS.has(x.pos));
    if (p) { lineup[slot] = p.id; chosen[slot] = p; }
  }

  return {
    lineup,
    picks: SLOTS.map((s) => ({ slot: s, ...(chosen[s] ?? { id: null, name: null, pos: null, points: 0 }) })),
    bench: pool.filter((p) => !used.has(p.id)),
    unscored,
  };
}

/**
 * Is this roster capable of fielding a legal six?
 *
 * ASKED AT LOCK, NOT AT SETTLE. A roster that cannot field a lineup is a DNF,
 * and a player is entitled to know that on Wednesday rather than discover it on
 * Tuesday. The check is on POSITIONS ONLY - it needs no scores, so it can run
 * the moment the draft ends.
 */
export function canFieldSix(roster) {
  const n = (pos) => (roster ?? []).filter((r) => r.pos === pos).length;
  const missing = [];
  for (const pos of ['QB', 'RB', 'WR', 'TE']) if (n(pos) < 1) missing.push(pos);
  const flexable = (roster ?? []).filter((r) => FLEX_POS.has(r.pos)).length;
  // 1 RB + 1 WR + 1 TE + 2 FLEX = five players drawn from RB/WR/TE.
  if (flexable < 5) missing.push(`${5 - flexable} more RB/WR/TE`);
  return { ok: missing.length === 0, missing };
}
