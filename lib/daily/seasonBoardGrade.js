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
import { eligibleForSlot } from './boardShape.js';

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
  const out = best.map((b) => ({ ...b }));
  const originalSlotOf = new Map(best.map((b) => [b.name, b.slot]));

  for (let i = 0; i < mineArr.length; i++) {
    const wantName = mineArr[i].name;
    if (out[i].name === wantName) continue; // already aligned
    const j = out.findIndex((b, idx) => idx !== i && b.name === wantName);
    if (j === -1) continue; // you don't hold anyone the best roster has

    const a = out[i];
    const b = out[j];
    if (!eligibleForSlot(b.position, slots[i]) || !eligibleForSlot(a.position, slots[j])) {
      throw new Error(
        `illegal permutation: ${b.name} (${b.position}) -> ${slots[i]}, `
        + `${a.name} (${a.position}) -> ${slots[j]}`,
      );
    }
    out[i] = { ...b, slot: slots[i] };
    out[j] = { ...a, slot: slots[j] };
  }

  // FINAL ASSERT, OVER THE WHOLE ROSTER, not just the pairs that moved - the
  // cheap, whole-board version of the same check, run once after every swap
  // is done rather than trusted from the per-swap checks above alone.
  out.forEach((p, i) => {
    if (!eligibleForSlot(p.position, slots[i])) {
      throw new Error(`illegal permutation: ${p.name} (${p.position}) ended at ${slots[i]}`);
    }
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
  const optArr = optimum.bySlot.map((b) => ({
    name: b.player.name, abbr: b.teamKey, points: b.player.points, meta: b.player.meta,
    slot: b.slot, position: b.player.position,
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

  const untouchedTeams = teams.filter((t) => !play.used.has(t.key)).map((t) => t.abbr ?? t.key);
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
