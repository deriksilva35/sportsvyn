// lib/daily/boardGenerator.js — STEP 2: draw twelve teams and build each
// one's card, for one season. PURE: rows in, a draw out. No DB, no clock, no
// network - the same contract as pool.js and assignmentSolver.js.
//
// RULE (d) IS DROPPED (ruling). "Two losing teams" needed a win-loss source;
// none exists anywhere in this schema, for any season - checked directly,
// no team_records table, no standings table, at all. A synthetic assignment
// would have been invented data wearing a rule's clothes. If a real records
// source ever covers this corpus, rule (d) comes back as its own relay, not
// bolted on with a guess now.
//
// A CARD IS BUILT FROM THE TEAM'S OWN TOP SCORERS, NOT NORMALIZED BY
// POSITION. "Positional surplus" (rule b) falls out of that for free: a team
// with three real RBs shows three RBs on its card, a team with one shows one.
// Forcing one-per-position would be the opposite of what surplus means.
//
// TEAMS MAY REPEAT ACROSS BOARDS (ruling). Nothing in this file tracks what
// a PRIOR draw used - drawTeams always chooses from the full fillable pool.
// Board-level uniqueness (has this exact 12-team set been drawn before?) and
// the season-recency rule (has this season been used in the last 30 days?)
// are both about SCHEDULING ACROSS DAYS, not about drawing one board, and
// live in lib/daily/boardScheduling.js instead of here.

import { BOARD_POSITIONS } from './boardShape.js';
import { fantasyPoints } from '../fantasy/scoring.js';
import { toSeasonStatLine } from './seasonStatLine.js';
import { shuffled, PPR_FLOOR } from './pool.js';

export const TEAM_COUNT = 12;
export const CARD_MIN = 4;
export const CARD_MAX = 6;

/**
 * One team's card for one season: rows -> { players, standout }. PURE.
 * `rows` should already be scoped to one (season, team) - this function does
 * not filter by season or team itself, only by BOARD_POSITIONS.
 *
 * RULE (c), K ONLY ON TEAMS HOLDING SOMETHING BETTER: reuses PPR_FLOOR
 * (lib/daily/pool.js) as "something better" rather than inventing a second
 * threshold that would mean almost the same thing. A kicker survives the cut
 * only if a non-kicker on the card clears that bar; otherwise the card loses
 * its PK row entirely - a lone kicker with nothing behind him is not a card,
 * it is an artifact of a bad offense the source data happens to have counted.
 *
 * STANDOUT IS READ OFF THE FINAL CARD, AFTER the K filter, not before - the
 * standout has to be a player actually ON the card, and filtering the kicker
 * can change who that is (rare, but real: a team whose only real activity
 * is a productive kicker has no standout at all once the filter runs, and
 * that team fails fillability honestly rather than featuring a kicker alone).
 */
export function buildCard(rows) {
  const eligible = (rows ?? []).filter((r) => BOARD_POSITIONS.includes(r.position));
  const scored = eligible
    .map((r) => ({ ...r, points: fantasyPoints(toSeasonStatLine(r), 'daily') }))
    .sort((a, b) => b.points - a.points);
  if (!scored.length) return { players: [], standout: null };

  let card = scored.slice(0, CARD_MAX);
  // A floor of CARD_MIN only when the team genuinely has that many eligible
  // rows to offer - never padded with a player who scored nothing real.
  if (card.length < CARD_MIN && scored.length > card.length) {
    card = scored.slice(0, Math.min(CARD_MIN, scored.length));
  }

  const hasSomethingBetter = card.some((p) => p.position !== 'PK' && p.points >= PPR_FLOOR);
  if (!hasSomethingBetter) card = card.filter((p) => p.position !== 'PK');

  return { players: card, standout: card[0] ?? null };
}

/**
 * Group a season's rows by team_key and build every team's card. PURE.
 * @returns Map<team_key, {players, standout}>
 */
export function cardsBySeasonTeam(seasonRows) {
  const byTeam = new Map();
  for (const r of seasonRows ?? []) {
    if (!BOARD_POSITIONS.includes(r.position)) continue;
    if (!byTeam.has(r.team_key)) byTeam.set(r.team_key, []);
    byTeam.get(r.team_key).push(r);
  }
  const cards = new Map();
  for (const [key, rows] of byTeam) cards.set(key, buildCard(rows));
  return cards;
}

/**
 * Draw TWELVE fillable teams (rule f), in shuffled order (rule e). PURE.
 *
 * @param teamCards  Map<team_key, {players, standout}> - see cardsBySeasonTeam
 * @param rng seeded PRNG, see pool.js's makeRng/seedFor
 *
 * REFUSES RATHER THAN SHRINKING, same law as pool.js's buildBoard: a season
 * that cannot honestly field TEAM_COUNT fillable teams returns ok:false with
 * a reason, never a board one team short.
 */
export function drawTeams(teamCards, rng, { teamCount = TEAM_COUNT } = {}) {
  const fillable = [...teamCards.entries()]
    .filter(([, c]) => c.players.length > 0)
    .map(([key]) => key);
  if (fillable.length < teamCount) {
    return { ok: false, reason: 'fewer fillable teams than the draw needs', teams: [] };
  }
  const picked = shuffled(fillable, rng).slice(0, teamCount);
  return {
    ok: true,
    teams: picked.map((key) => ({ key, card: teamCards.get(key).players, standout: teamCards.get(key).standout })),
  };
}

/**
 * ONE CALL: a season's raw rows -> a drawn 12-team board, or a refusal.
 * PURE. This is the whole generator, end to end, minus the solver.
 */
export function generateBoard(seasonRows, rng, opts = {}) {
  const teamCards = cardsBySeasonTeam(seasonRows);
  return drawTeams(teamCards, rng, opts);
}
