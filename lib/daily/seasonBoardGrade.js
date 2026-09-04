// lib/daily/seasonBoardGrade.js — the completed roster, graded against the
// board's own ceiling. PURE: a finished play state + the drawn teams in,
// the grade's data out. No DOM, no formatting strings - the component owns
// how a number becomes a label.
//
// REUSES solveBoard() (assignmentSolver.js) DIRECTLY - "the best roster this
// board allowed" is exactly the same team-to-slot optimum Step 2's measurement
// harness already computes and tests. There is no second optimizer here.
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
// UNMATCHED PAIRS ARE SORTED BY VALUE, NEVER LIST ORDER. Pairing a 245-point
// back you took against a 229-point receiver the optimum took, just because
// they landed at the same array index, is arithmetic nonsense - the back
// scored more. Both leftover lists sort descending before pairing, so the
// biggest thing left on the board reads against the biggest thing you took.

import { solveBoard } from './assignmentSolver.js';

export function gradeBoard(play, teams, slots) {
  const optimum = solveBoard(teams, slots);
  if (!optimum.ok) return { ok: false, reason: optimum.reason };

  const mineArr = play.roster.map((r) => ({
    name: r.pick.player.name, abbr: r.pick.teamKey, points: r.pick.player.points,
    meta: r.pick.player.meta, slot: r.pos,
  }));
  const optArr = optimum.bySlot.map((b) => ({
    name: b.player.name, abbr: b.teamKey, points: b.player.points, meta: b.player.meta, slot: b.slot,
  }));

  const optNames = new Set(optArr.map((p) => p.name));
  const mineNames = new Set(mineArr.map((p) => p.name));

  const leftMine = mineArr.filter((p) => !optNames.has(p.name)).sort((a, b) => b.points - a.points);
  const leftOpt = optArr.filter((p) => !mineNames.has(p.name)).sort((a, b) => b.points - a.points);
  const matched = optArr.filter((b) => mineNames.has(b.name));

  const rows = matched.map((b) => {
    const held = mineArr.find((p) => p.name === b.name);
    return { hit: true, ahead: false, you: held, best: b, moved: held.slot !== b.slot ? held.slot : null };
  }).concat(leftOpt.map((b, i) => {
    const you = leftMine[i] ?? null;
    const ahead = you != null && you.points > b.points;
    return { hit: false, ahead, you, best: b, moved: null };
  }));

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
    bestRosterAbbrs: optArr.map((p) => p.abbr),
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
