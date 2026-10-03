// lib/soccer/roundLabel.js - THE NAMES FOR A SOCCER ROUND, one source each
// (ruling thu-36; the Champions League joins fri-3). PURE and client-safe.
//
//   Matchweek N   the EPL's football surfaces: /scores, the EPL match pages,
//                 /epl/standings, the league-week crumbs.
//   Gameweek N    inside EPL Weekly 5 (room, live, final, the /games row,
//   GW N          boards, push copy) - the fantasy game's own word.
//   Matchday N    the Champions League's league phase; its knockout rounds
//                 go by name (Round of 16, Quarter-final, ...).
//
// Every surface prints its round through ONE of these and never spells the word
// itself, so they cannot drift into each other: lib/soccer/roundLabel.test.mjs
// walks the files and fails on a hand-typed "Matchweek ", "Gameweek " or
// "Matchday ".

import { UCL_STAGE_NAME } from './leagues.js';

export const matchweekLabel = (n) => (n == null || n === '' ? null : `Matchweek ${n}`);
export const gameweekLabel = (n) => (n == null || n === '' ? null : `Gameweek ${n}`);
export const gameweekShort = (n) => (n == null || n === '' ? null : `GW ${n}`);
export const matchdayLabel = (n) => (n == null || n === '' ? null : `Matchday ${n}`);

/**
 * A match's round in its own league's words, or null.
 *   epl  week 6                 -> "Matchweek 6"
 *   ucl  week 2, stage 'league' -> "Matchday 2"
 *   ucl  stage 'qf'             -> "Quarter-final"
 */
export function roundLabelFor(leagueSlug, { week = null, stage = null } = {}) {
  if (leagueSlug === 'ucl') {
    if (stage && stage !== 'league') return UCL_STAGE_NAME[stage] ?? null;
    return matchdayLabel(week);
  }
  return matchweekLabel(week);
}
