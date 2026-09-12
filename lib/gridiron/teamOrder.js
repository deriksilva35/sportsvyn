// lib/gridiron/teamOrder.js - which team goes first, and the word between them.
//
// ONE RULE, EVERYWHERE TWO TEAM ROWS STACK. Gridiron reads away-first: a
// scoreboard row is "Away at Home", and every American convention from the
// ticker to the box score follows it. Soccer reads home-first: "Arsenal v
// Chelsea" is the home side, then the visitor. The page never decides this
// for itself - it asks here - so a card, a strip and a board cannot drift.
//
// AWAY-FIRST IS THE DEFAULT, so a league nobody has ruled on renders
// football-shaped rather than blank or arbitrary. Adding a soccer league is
// one entry in HOME_FIRST below.

/** Leagues that read home-first: every soccer league we carry. Anything not
 * here is away-first. Adding a soccer competition is one entry. */
export const HOME_FIRST = Object.freeze(new Set([
  'epl', 'fifa-wc-2026', 'international-friendlies', 'concacaf-gold-cup', 'africa-cup-of-nations',
]));

/** @returns {['away','home']|['home','away']} the render order, first row first. */
export function orderFor(leagueSlug) {
  return HOME_FIRST.has(String(leagueSlug ?? '')) ? ['home', 'away'] : ['away', 'home'];
}

/** The word between the two sides: football "at", soccer "v". */
export function connectorFor(leagueSlug) {
  return HOME_FIRST.has(String(leagueSlug ?? '')) ? 'v' : 'at';
}

/** Convenience for a card that holds both sides: the pair in render order. */
export function sidesFor(leagueSlug, { home, away } = {}) {
  return orderFor(leagueSlug).map((side) => ({ side, team: side === 'home' ? home : away }));
}
