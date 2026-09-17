// lib/house/pickDaily.js - the house's Daily entry. PURE.
//
// THE DAILY IS NOT A SPREAD GAME and has no favorite. Its board is twelve
// TEAM CARDS, each holding six historical players with their season points,
// and the entry is eight slots - QB RB RB WR WR FLEX FLEX K - with ONE PLAYER
// PER TEAM. So "the chalk" here cannot mean the favourite; it means the
// obvious pick, which is the biggest number still on the board.
//
// CHALK IS GREEDY, NOT OPTIMAL, AND THAT IS THE WHOLE POINT. There is an exact
// solver in the tree (lib/daily/assignmentSolver.js solveBoard) and using it
// would file a perfect roster every single day, which is not a persona, it is
// the answer key. The chalk takes the best thing in front of it at each slot
// in turn and gets beaten by the assignment it could not see - which is
// exactly what taking the obvious pick costs a real player.
//
// SLOT ORDER IS THE BOARD'S OWN (slotsOf(board), migrations/103 - the shape
// stored WITH the edition, never today's constant). Walking it in a
// different order would be a different strategy wearing the same name.

import { slotsOf, eligibleForSlot } from '../daily/boardShape.js';
import { HOMER_TEAMS } from './personas.js';

/** Every (team, player) still legal for this slot, best first. */
function candidates(board, slot, usedTeams) {
  const out = [];
  for (const team of board?.board ?? []) {
    if (usedTeams.has(team.key)) continue;
    for (const p of team.card ?? []) {
      if (!eligibleForSlot(p.position, slot)) continue;
      out.push({ teamKey: team.key, player: p, points: Number(p.points ?? 0) });
    }
  }
  // Points, then name, so two identical numbers resolve the same way twice.
  return out.sort((a, b) => b.points - a.points || a.player.name.localeCompare(b.player.name));
}

const pickOf = (slotIndex, c) => (c
  ? { slotIndex, teamKey: c.teamKey, playerName: c.player.name }
  : { slotIndex, teamKey: null, playerName: null });

/**
 * THE CHALK. The biggest eligible number at each slot, in slot order, one
 * player per team.
 */
export function chalkDaily(board) {
  const used = new Set();
  return slotsOf(board).map((slot, i) => {
    const [best] = candidates(board, slot, used);
    if (best) used.add(best.teamKey);
    return pickOf(i, best);
  });
}

/**
 * THE GUT. Weighted random over the TOP TIER at each slot - the top five
 * eligible, weighted by their own points, so it is noisy without being
 * stupid. A tier of one is not a choice; it is simply taken.
 */
export function gutDaily(board, rng) {
  const used = new Set();
  return slotsOf(board).map((slot, i) => {
    const tier = candidates(board, slot, used).slice(0, 5);
    if (!tier.length) return pickOf(i, null);
    // Weights are the points themselves, floored at 1 so a zero-point player
    // is unlikely rather than impossible.
    const total = tier.reduce((a, c) => a + Math.max(1, c.points), 0);
    let draw = rng() * total;
    let chosen = tier[tier.length - 1];
    for (const c of tier) { draw -= Math.max(1, c.points); if (draw <= 0) { chosen = c; break; } }
    used.add(chosen.teamKey);
    return pickOf(i, chosen);
  });
}

/**
 * THE HOMER. Its own teams where the board has them, the chalk everywhere
 * else - and the method line says exactly that, because a reader watching it
 * take a player from a team it has never heard of deserves to know which half
 * of the rule produced that pick.
 *
 * WITH NO HOMER TEAM ON THE BOARD AT ALL this is the chalk, entry for entry.
 * That is a real outcome and not a failure: the honest thing for a homer
 * whose teams did not come up is to play the obvious board, and the method
 * line already told the reader it would.
 */
export function homerDaily(board, teams = HOMER_TEAMS) {
  const mine = new Set(teams);
  const used = new Set();
  return slotsOf(board).map((slot, i) => {
    const cands = candidates(board, slot, used);
    const own = cands.find((c) => mine.has(c.teamKey));
    const chosen = own ?? cands[0] ?? null;
    if (chosen) used.add(chosen.teamKey);
    return pickOf(i, chosen);
  });
}

/** Which slots this entry filled from a Homer team - for the method line. */
export function homerOwnCount(picks, board, teams = HOMER_TEAMS) {
  const mine = new Set(teams);
  void board;
  return picks.filter((p) => p.teamKey != null && mine.has(p.teamKey)).length;
}

export function pickDaily(personaKey, board, rng) {
  switch (personaKey) {
    case 'gut': return gutDaily(board, rng);
    case 'homer': return homerDaily(board);
    // CHALK, FADE AND BOOK DO NOT ENTER THIS BOARD. Fade and Book have no
    // line to work from; The Chalk was removed because it was too good -
    // the greedy is the optimum half the time on a twelve-card board, and
    // a house row that wins every day is not something a reader can play
    // against. chalkDaily() STAYS: it is what The Homer falls back to on
    // a slot none of its teams can fill.
    default: return null;
  }
}
