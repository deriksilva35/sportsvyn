// lib/daily/assignmentSolver.js — maximum-weight assignment. PURE: matrices
// in, an assignment out, no DB, no clock, no network.
//
// THE PROBLEM IS TEAM-TO-SLOT, NOT PLAYER-TO-SLOT. A board draws 12 teams for
// 8 slots and each team may contribute at most one player to the final board
// (the traded-player-stays-separate discipline this whole table was built on
// has no bearing here - a "team" for this solver is one card, drawn once).
// Fixing the team-per-slot pair first and THEN reading off that team's best
// eligible player for the slot is exact, not an approximation: because a
// team's card can only ever supply the SAME best player to whichever slot it
// is assigned, "assign teams to slots, weight = that team's best eligible
// player's score" and "assign players to slots, one team's players mutually
// exclusive" are the same optimization problem. The former is a plain
// rectangular assignment problem (12 teams, 8 slots, teams >= slots) with a
// textbook exact solution - no reason to solve the harder-looking one.
//
// THE ALGORITHM IS KUHN-MUNKRES (the Hungarian algorithm), O(slots^2 * teams).
// At 8 slots and 12 teams this runs in microseconds; there is no reason to
// reach for an approximate or heuristic solver when the exact one is this
// cheap. Rows are SLOTS (every one must be assigned - a slot left open is not
// a valid board), columns are TEAMS (each used at most once, not all need
// to be). This is the well-known n <= m formulation of the assignment
// problem; the classic e-maxx.ru / competitive-programming implementation is
// reproduced below with output re-indexed to (slotIndex -> teamIndex).

import { SLOTS, eligibleForSlot } from './boardShape.js';

// A cost this large can never be beaten by a real total (the whole board's
// combined score will never approach 1e6 given how fantasyPoints() is
// scaled), so it stands in for "no eligible player" without using true
// Infinity, which the algorithm's arithmetic cannot carry safely.
const INFEASIBLE = 1_000_000;

/**
 * The weight (team's best eligible player's points) for every (slot, team)
 * pair. PURE. Returns { weights: number[slotIdx][teamIdx], picks:
 * player[slotIdx][teamIdx] } - the picks matrix is what lets the caller read
 * back WHICH player was assigned, not just how many points.
 */
export function weightMatrix(teams, slots = SLOTS) {
  const weights = [];
  const picks = [];
  for (const slot of slots) {
    const wRow = [];
    const pRow = [];
    for (const team of teams) {
      let best = null;
      for (const p of team.card) {
        if (!eligibleForSlot(p.position, slot)) continue;
        if (!best || p.points > best.points) best = p;
      }
      wRow.push(best ? best.points : -INFEASIBLE);
      pRow.push(best);
    }
    weights.push(wRow);
    picks.push(pRow);
  }
  return { weights, picks };
}

/**
 * Kuhn-Munkres, MINIMIZING cost[row][col], rows.length <= cols.length.
 * Returns assignment[row] = col (every row assigned; a col may be unused).
 * The e-maxx.ru formulation, 1-indexed internally per the source algorithm -
 * re-indexed to 0-based on the way out so callers never see the offset.
 */
function hungarianMinCost(cost) {
  const n = cost.length;
  const m = cost[0].length;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = -1;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else { minv[j] -= delta; }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

/**
 * THE CEILING. Solves the team-to-slot assignment exactly, maximizing total
 * points. Returns:
 *   ok            false when at least one slot has NO feasible team anywhere
 *                 in the optimal assignment - the board cannot be completed,
 *                 full stop, and nothing here should paper over that with a
 *                 partial result.
 *   total         the maximum achievable score (only meaningful when ok)
 *   bySlot        [{ slot, teamKey, player }] for each of the 8 slot
 *                 instances, in SLOTS order
 *   teamsUsed     the distinct team keys the optimum drew on - MUST have
 *                 length 8 when ok (one team per slot, never fewer, never a
 *                 repeat): this is measurement #2 the spec asks for, proven
 *                 structurally rather than merely observed.
 */
export function solveBoard(teams, slots = SLOTS) {
  if (teams.length < slots.length) {
    return { ok: false, reason: 'fewer teams than slots', total: null, bySlot: [], teamsUsed: [] };
  }
  const { weights, picks } = weightMatrix(teams, slots);
  // MAXIMIZE by minimizing the negation - Kuhn-Munkres is a minimizer by
  // construction; negating the whole matrix is exact, not an approximation,
  // because negation is order-reversing and linear.
  const cost = weights.map((row) => row.map((w) => -w));
  const assignment = hungarianMinCost(cost);

  const bySlot = [];
  const teamsUsed = [];
  let total = 0;
  let feasible = true;
  for (let s = 0; s < slots.length; s++) {
    const teamIdx = assignment[s];
    const w = teamIdx >= 0 ? weights[s][teamIdx] : -INFEASIBLE;
    if (teamIdx < 0 || w <= -INFEASIBLE) { feasible = false; continue; }
    const player = picks[s][teamIdx];
    bySlot.push({ slot: slots[s], teamKey: teams[teamIdx].key, player });
    teamsUsed.push(teams[teamIdx].key);
    total += w;
  }
  if (!feasible) return { ok: false, reason: 'no feasible assignment for every slot', total: null, bySlot: [], teamsUsed: [] };
  return { ok: true, total: Math.round(total * 10) / 10, bySlot, teamsUsed };
}
