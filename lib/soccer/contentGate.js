// lib/soccer/contentGate.js - which leagues the AI content machine may touch.
//
// THE HARD RULING (EPL relay 1, 23 Aug): the soccer-era content crons -
// briefs, gloss, prematch analyst, the player/team editions - were built for
// the World Cup and select their work from the DATABASE, not from a league
// list. The moment EPL rows appear they would wake on them: a Tier 1 brief
// per final, a gloss pass per goal, a prematch column per fixture, every
// matchweek, at model cost, in a voice nobody has approved for club football.
//
// That is an editorial and financial decision, and it will be made
// deliberately - not inherited from leftover tournament configuration. So EPL
// is EXCLUDED here, explicitly and positively, and turning it on later means
// deleting a slug from CONTENT_EXCLUDED_LEAGUES and saying so out loud.
//
// This is a GATE, not a capability removal: nothing about the content crons
// changes except the set of leagues they may see.

/** Leagues whose matches the AI content crons must not touch. */
export const CONTENT_EXCLUDED_LEAGUES = ['epl'];

/** @returns {boolean} may the content machine work this league's matches? */
export function contentAllowedForLeague(slug) {
  return !CONTENT_EXCLUDED_LEAGUES.includes(String(slug ?? ''));
}

/** The SQL fragment's parameter: pass to `l.slug <> ALL(...)` / NOT IN. */
export const CONTENT_EXCLUDED_SQL = CONTENT_EXCLUDED_LEAGUES;
