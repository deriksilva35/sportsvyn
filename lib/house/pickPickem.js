// lib/house/pickPickem.js - the house's Pick'em entry. PURE.
//
// THE SPREAD IS HOME-BASED AND SIGNED (lib/gridiron/oddsReader.js): the number
// is the HOME side's handicap, so NEGATIVE means home is favoured. Every rule
// below derives its side from that sign and from nothing else, so a change of
// convention breaks one line rather than four personas.
//
// AN UNPRICED GAME IS A GAME WITH NO OPINION IN IT. The board carries games
// the odds feed has no line for - measured on the 2026 slate, NFL is 16 of 16
// but CFB week 3 is 55 of 75 - and what each persona does about that is a
// stated rule per persona, never a shared default:
//
//   Chalk  needs a favourite, so it skips  (there is no favourite without one)
//   Fade   skips, by ruling R5            (no opinion without a number)
//   Gut    skips                          (its tier IS the spread)
//   Homer  PICKS ANYWAY                   (it never needed the number)
//
// A SKIPPED GAME IS NOT A PICK. savePick is called once per game, so a skipped
// game is simply a call that never happens: the entry has fewer picks, the
// board shows them missing, and those games score zero. That is the truthful
// shape and it is the one ruling R5 asked for.

import { HOMER_TEAMS, FADE_MAX } from './personas.js';

/** Home if the home side is favoured, away if not. Null with no line. */
export function favouriteOf(spread) {
  if (spread == null || !Number.isFinite(Number(spread))) return null;
  const s = Number(spread);
  // PICK-EM IS NOT A FAVOURITE. A line of exactly 0 names no side, and
  // guessing one would be inventing an opinion the market did not express.
  if (s === 0) return null;
  return s < 0 ? 'home' : 'away';
}

const other = (side) => (side === 'home' ? 'away' : 'home');

/**
 * @param {Array} games  the contest board rows {match_id, home_team_id, away_team_id, ...}
 * @param {Map}   spreads matchId -> home-based signed spread
 * @returns {Array<{matchId, side}>} one entry per game PICKED; skipped games absent
 */
export function chalkPickem(games, spreads) {
  const out = [];
  for (const g of games ?? []) {
    const side = favouriteOf(spreads?.get(g.match_id));
    if (side) out.push({ matchId: g.match_id, side });
  }
  return out;
}

/**
 * THE FADE. The underdog, but only INSIDE the number - a dog getting twenty
 * is not a contrarian position, it is a donation. FADE_MAX is the threshold
 * and the method line prints it.
 */
export function fadePickem(games, spreads, { max = FADE_MAX } = {}) {
  const out = [];
  for (const g of games ?? []) {
    const s = spreads?.get(g.match_id);
    const fav = favouriteOf(s);
    if (!fav) continue;                       // unpriced, or a true pick-em
    if (Math.abs(Number(s)) > max) continue;  // outside the number
    out.push({ matchId: g.match_id, side: other(fav) });
  }
  return out;
}

/**
 * THE GUT. Favourite-leaning weighted random: the bigger the number, the more
 * often it takes the chalk, and it never quite stops taking dogs. At a line of
 * seven it backs the favourite about three times in four.
 */
export function gutPickem(games, spreads, rng) {
  const out = [];
  for (const g of games ?? []) {
    const s = spreads?.get(g.match_id);
    const fav = favouriteOf(s);
    if (!fav) continue;
    const edge = Math.min(Math.abs(Number(s)), 14) / 14;   // 0 .. 1
    const pFav = 0.5 + (edge * 0.35);                       // .50 .. .85
    out.push({ matchId: g.match_id, side: rng() < pFav ? fav : other(fav) });
  }
  return out;
}

/**
 * THE HOMER. Its own teams, always, whatever the number says - and it is the
 * one persona that does not need a line, so it picks unpriced games too.
 *
 * BOTH TEAMS ITS OWN is the case worth naming: when two Homer teams meet there
 * is no homer answer, so it takes the HOME side and the rule is stated rather
 * than left to whichever id sorted first.
 */
export function homerPickem(games, teamIds) {
  const mine = new Set((teamIds ?? []).map(Number));
  const out = [];
  for (const g of games ?? []) {
    const home = mine.has(Number(g.home_team_id));
    const away = mine.has(Number(g.away_team_id));
    if (!home && !away) continue;             // no dog in this fight
    out.push({ matchId: g.match_id, side: home ? 'home' : 'away' });
  }
  return out;
}

export function pickPickem(personaKey, games, { spreads = new Map(), homerTeamIds = [], rng = Math.random } = {}) {
  switch (personaKey) {
    case 'chalk': return chalkPickem(games, spreads);
    case 'fade': return fadePickem(games, spreads);
    case 'gut': return gutPickem(games, spreads, rng);
    case 'homer': return homerPickem(games, homerTeamIds);
    default: return null;
  }
}

export { HOMER_TEAMS };
