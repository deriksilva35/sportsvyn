// lib/daily/boardMeasurements.js — the two measurements the spec promises,
// as deliverables in their own right, not incidental output of a demo run.
// PURE.

import { SLOTS, eligibleForSlot } from './boardShape.js';
import { solveBoard } from './assignmentSolver.js';
import { shuffled } from './pool.js';

/**
 * GREEDY IN THE PLAYER'S DECISION SPACE (ruling). A board never asks anyone
 * to fill slots in some order - it forces one pick per TEAM. Walk the teams
 * in `teamOrder`; for each one, open its card, take the highest-scoring
 * player that still fits SOME open slot, and place that player in the FIRST
 * open slot (lowest index in `slots`) it is eligible for. A team whose whole
 * card fits nothing still open contributes nothing and is skipped, same as
 * a real player opening a card with nothing left to use.
 *
 * SUPERSEDES an earlier slot-order greedy (walk SLOTS, take the best team
 * for each): that models a board that asks "who's best at QB, then who's
 * best at RB", which is not the mechanic - the mechanic opens one team at a
 * time. The two are genuinely different heuristics with different gaps to
 * the ceiling; this is the one that matches what a player actually does.
 */
export function greedyByTeamOrder(teams, teamOrder, slots = SLOTS) {
  const byKey = new Map(teams.map((t) => [t.key, t]));
  const filled = new Array(slots.length).fill(false);
  const bySlot = new Array(slots.length).fill(null);
  let total = 0;
  let filledCount = 0;

  for (const key of teamOrder) {
    if (filledCount === slots.length) break;
    const team = byKey.get(key);
    if (!team) continue;

    let bestPlayer = null;
    let bestSlotIdx = -1;
    for (const p of team.card) {
      const idx = slots.findIndex((slot, i) => !filled[i] && eligibleForSlot(p.position, slot));
      if (idx === -1) continue; // nothing open fits this player
      if (!bestPlayer || p.points > bestPlayer.points) { bestPlayer = p; bestSlotIdx = idx; }
    }
    if (!bestPlayer) continue; // this team's card fits nothing still open

    filled[bestSlotIdx] = true;
    bySlot[bestSlotIdx] = { slot: slots[bestSlotIdx], teamKey: key, player: bestPlayer };
    total += bestPlayer.points;
    filledCount += 1;
  }

  if (filledCount < slots.length) return { ok: false, reason: 'ran out of teams before every slot was filled' };
  return { ok: true, total: Math.round(total * 10) / 10, bySlot };
}

/**
 * THE TWO MEASUREMENTS.
 *
 * 1. greedyByTeamOrder over `trials` independently shuffled TEAM orders,
 *    reported as a PERCENTAGE OF THE SOLVER'S OPTIMUM - best, average,
 *    worst, plus whether ANY order reached the board's own 100%.
 * 2. teamUniqueOk asserts the solver's own structural guarantee - the
 *    optimum draws on exactly SLOTS.length distinct teams - as a checked
 *    property of THIS board, not a claim taken on faith from the solver's
 *    own unit tests.
 *
 * Returns ok:false (with the solver's own reason) when the board itself has
 * no feasible completion at all - a measurement cannot be taken of a board
 * that cannot be finished.
 */
export function measureBoard(teams, rng, { trials = 200, slots = SLOTS } = {}) {
  const optimum = solveBoard(teams, slots);
  if (!optimum.ok) return { ok: false, reason: optimum.reason };

  const teamKeys = teams.map((t) => t.key);
  const pctOfOptimal = [];
  let greedyInfeasible = 0;
  for (let i = 0; i < trials; i++) {
    const order = shuffled(teamKeys, rng);
    const g = greedyByTeamOrder(teams, order, slots);
    if (!g.ok) { greedyInfeasible += 1; continue; }
    pctOfOptimal.push(optimum.total > 0 ? (g.total / optimum.total) * 100 : 100);
  }

  const teamUniqueOk = optimum.teamsUsed.length === slots.length
    && new Set(optimum.teamsUsed).size === optimum.teamsUsed.length;

  const greedy = pctOfOptimal.length ? {
    best: Math.max(...pctOfOptimal),
    average: pctOfOptimal.reduce((a, b) => a + b, 0) / pctOfOptimal.length,
    worst: Math.min(...pctOfOptimal),
    everHit100: pctOfOptimal.some((p) => p >= 99.95), // 1dp rounding guard
  } : null;

  return {
    ok: true,
    optimum: optimum.total,
    teamUniqueOk,
    trials,
    greedyInfeasibleOrders: greedyInfeasible,
    greedy,
  };
}
