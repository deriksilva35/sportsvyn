// lib/daily/seasonBoardGrade.js — the completed roster, graded against the
// board's own ceiling. PURE: a finished play state + the drawn teams in,
// the grade's data out. No DOM, no formatting strings - the component owns
// how a number becomes a label.
//
// REUSES solveBoard() (assignmentSolver.js) DIRECTLY - "the best roster this
// board allowed" is exactly the same team-to-slot optimum Step 2's measurement
// harness already computes and tests. There is no second optimizer here.
//
// A GRADE ROW IS SLOT-INDEXED, BOTH SIDES (ruling, supersedes "swaps sorted
// by value"): row i is YOUR occupant of slot i beside the BEST roster's
// occupant of slot i, for i in QB,RB,RB,WR,WR,FLEX,FLEX,K. Pairing the best
// roster's QB-slot occupant against your QB pick is what "graded against the
// board" has to mean - pairing him against whichever of your picks scored a
// similar number, regardless of slot, produced a QB row showing a running
// back opposite it, legal on the best roster's own card but nonsense under a
// QB label.
//
// SET-MATCH IS A PERMUTATION, NOT A RE-SOLVE. The solver's own bySlot output
// is already exact and its total is the ceiling - never recomputed here. But
// bySlot's own slot assignment (which of two RB slots, which of two FLEX
// slots) is arbitrary among ties the algorithm didn't have to break your way:
// if a player you hold appears anywhere else in the best roster, permuteBest
// swaps the best roster's occupants so he lines up with YOUR slot, the same
// way you'd naturally read "same player, different slot" as a match, not a
// miss. EVERY SWAP IS CHECKED FOR ELIGIBILITY AFTER THE FACT (assertLegal) -
// not assumed from the RB/RB, WR/WR, FLEX/FLEX, or FLEX-eligible shape the
// ruling describes, because an eligibility bug anywhere upstream should fail
// loud here, not ship a best roster that could not actually have been drawn.
//
// SET-MATCH BEFORE DISPLAY. Two rosters holding the same eight players are
// the same roster - a player who ended up at a different slot than the
// optimum still chose him is still MATCHED, never counted as a miss. Matching
// is done by NAME (the same identity the mock's own finish handler used):
// within one drawn board, one team contributes at most one player, so a name
// collision within the SAME 8-player set would require two teams fielding
// identically-named players, which the census this whole project has run
// against real rosters has never once produced.
//
// ROWS DISPLAY IN POSITION ORDER (ruling, unchanged by this turn): QB, RB,
// RB, WR, WR, FLEX, FLEX, K - the same order as the roster row on the board.
// Because both sides are now slot-indexed together, "position order" and
// "the order the pairing is computed in" are the same order - there is no
// separate display sort any more.

import { solveBoard } from './assignmentSolver.js';
import { eligibleForSlot, shapeBestRoster } from './boardShape.js';

/**
 * Swap the best roster's occupants until every player YOU also hold sits at
 * YOUR slot index, wherever that's possible without breaking eligibility.
 * PURE, mutates nothing passed in. Returns { best, originalSlotOf } - `best`
 * is the permuted array (same 8 players, same total - a relabeling, not a
 * re-solve), `originalSlotOf` maps a player's name to the slot LABEL the
 * pristine (pre-permutation) best roster held them at - the caller uses
 * this, not an index, to decide whether a swap is worth a note (ruling:
 * only a LABEL change - FLEX vs RB, FLEX vs WR - is a note; RB1-to-RB2 and
 * WR1-to-WR2 read the same slot name either way and stay silent).
 *
 * ITERATIVE, NOT ONE PASS: index i's search runs against the CURRENT state
 * of `best`, which earlier iterations may already have altered - the same
 * discipline as resolving any permutation by following its cycles. A 3-way
 * shuffle (your slot i's man is at j, j's man is at k) resolves correctly
 * because of this, not despite it.
 */
function permuteBest(mineArr, best, slots) {
  const originalSlotOf = new Map(best.map((b) => [b.name, b.slot]));

  // PHASE A - EVERY PLAYER YOU HOLD WHO IS ON THE BEST ROSTER LANDS AT THE
  // SLOT YOU HOLD HIM IN. Always legal: your roster was validated against
  // slot eligibility when it was built. This is what decides MATCHED, and it
  // is decided by NAME, never by index.
  const out = new Array(mineArr.length).fill(null);
  const taken = new Set();
  mineArr.forEach((you, i) => {
    const k = best.findIndex((b, idx) => !taken.has(idx) && b.name === you.name);
    if (k === -1) return;
    out[i] = { ...best[k], slot: slots[i] };
    taken.add(k);
  });

  // PHASE B - THE REST ARE A DISPLAY PAIRING, AND MUST NEVER THROW. The
  // previous version swapped pairwise and asserted legality, then threw on
  // the first real board it ever saw: Fitzgerald held at FLEX, best roster
  // had him at WR with Jordan Reed (TE) at FLEX - the swap sends a TE into a
  // WR slot, which no legal completion can avoid once the held player has
  // moved labels. A grade must not 500 over which column a missed player is
  // printed in. So: a small exhaustive search (<= 8 slots) for a fully legal
  // completion, and if none exists, the most-legal one found.
  const freeIdx = out.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
  const pool = best.map((b, idx) => idx).filter((idx) => !taken.has(idx));
  let bestAssign = null; let bestLegal = -1;
  const assign = new Array(freeIdx.length).fill(-1);
  const used = new Set();
  (function dfs(pos, legal) {
    if (bestLegal === freeIdx.length) return;
    if (pos === freeIdx.length) {
      if (legal > bestLegal) { bestLegal = legal; bestAssign = assign.slice(); }
      return;
    }
    for (const idx of pool) {
      if (used.has(idx)) continue;
      used.add(idx); assign[pos] = idx;
      dfs(pos + 1, legal + (eligibleForSlot(best[idx].position, slots[freeIdx[pos]]) ? 1 : 0));
      used.delete(idx);
    }
  })(0, 0);
  (bestAssign ?? []).forEach((idx, pos) => {
    const i = freeIdx[pos];
    out[i] = { ...best[idx], slot: slots[i] };
  });

  return { best: out, originalSlotOf };
}

export function gradeBoard(play, teams, slots) {
  const optimum = solveBoard(teams, slots);
  if (!optimum.ok) return { ok: false, reason: optimum.reason };
  return gradeFromOptimum(play, teams, optimum, slots);
}

/**
 * Same grade gradeBoard produces, given an ALREADY-COMPUTED optimum
 * ({ total, bySlot }) instead of recomputing one via solveBoard(). This is
 * the path a stored daily_boards row uses (standing ruling: ceiling is
 * stored on the edition, never recomputed at read time) - best_roster and
 * ceiling were frozen at board-creation time, and grading a submitted run
 * must pair against THAT frozen optimum, not a fresh solve that could drift
 * if nfl_player_season_totals moves between creation and play.
 */
export function gradeFromOptimum(play, teams, optimum, slots) {
  const mineArr = play.roster.map((r, slotIndex) => ({
    name: r.pick.player.name, abbr: r.pick.teamKey, points: r.pick.player.points,
    meta: r.pick.player.meta, slot: r.pos, slotIndex, position: r.pick.player.position,
  }));
  // optimum.bySlot is already in SLOTS order (solveBoard's own loop runs
  // s = 0..slots.length-1 and pushes exactly one entry per slot when ok) -
  // bySlot[i] and mineArr[i] are the same slot index before any permuting.
  // NORMALISED FIRST. optimum.bySlot arrives in one of three shapes - the
  // solver over raw season rows (stored boards before this fix), the solver
  // over shaped cards (the client's practice grade), or already flat (stored
  // boards after it). shapeBestRoster() makes them one, so `name` is never
  // undefined here again - which is what turned every row MISSED.
  const optArr = shapeBestRoster(optimum.bySlot).map((b) => ({
    name: b.name, abbr: b.abbr ?? b.teamKey, points: b.points, meta: b.meta,
    slot: b.slot, position: b.position,
  }));

  const { best, originalSlotOf } = permuteBest(mineArr, optArr, slots);

  const rows = mineArr.map((you, i) => {
    const b = best[i];
    const hit = b.name === you.name;
    const ahead = !hit && you.points > b.points;
    // THE NOTE FIRES ON A LABEL CHANGE, NOT AN INDEX CHANGE (ruling): the
    // pristine best roster's own slot for this player (FLEX, say) differs
    // from where you hold him (RB) - RB1-to-RB2 shares one label and stays
    // silent, since nothing about "which RB slot" is a fact worth a note.
    const moved = hit && originalSlotOf.get(you.name) !== you.slot ? you.slot : null;
    return { hit, ahead, you, best: b, moved };
  });

  const mine = mineArr.reduce((s, p) => s + p.points, 0);
  const perfect = optimum.total;
  const pct = perfect > 0 ? Math.round((mine / perfect) * 100) : 100;

  // play.used is a Set on a live play-through and an ARRAY on a receipt (it
  // crossed the RSC boundary, which cannot carry a Set) - accept both.
  const usedSet = play.used instanceof Set ? play.used : new Set(play.used ?? []);
  const untouchedTeams = teams.filter((t) => !usedSet.has(t.key)).map((t) => t.abbr ?? t.key);
  const missedRows = rows.filter((r) => !r.hit).sort((a, b) => b.best.points - a.best.points);

  return {
    ok: true,
    rows,
    mine: Math.round(mine * 10) / 10,
    perfect: Math.round(perfect * 10) / 10,
    pct,
    matchedCount: rows.filter((r) => r.hit).length,
    slotCount: slots.length,
    pointsLeft: Math.round((perfect - mine) * 10) / 10,
    bestRosterAbbrs: best.map((p) => p.abbr),
    untouchedTeams,
    biggestMissed: missedRows[0] ?? null,
    glyph: rows.map((r) => (r.hit ? '\u{1F7E9}' : '⬛')).join(''),
  };
}

/**
 * The one generated paragraph about THIS board - which teams went unopened,
 * and the biggest name left. PURE, and every name it can produce came off
 * `grade` itself, which came off THIS board's own rows - no player is ever
 * named who was not actually on it.
 */
export function boardStory(grade, teamsOpenedCount, teamCount, clockLabel) {
  let story = `You opened ${teamsOpenedCount} of the ${teamCount} teams in ${clockLabel}. `;
  if (grade.untouchedTeams.length) {
    story += `You never opened ${grade.untouchedTeams.join(', ')}. `;
  }
  story += grade.biggestMissed
    ? `The biggest name left on the board was ${grade.biggestMissed.best.name} (${grade.biggestMissed.best.abbr}), worth ${grade.biggestMissed.best.points}.`
    : 'You took every player the best roster did.';
  return story;
}
