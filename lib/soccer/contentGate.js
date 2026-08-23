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

// THE LINE IS MODEL SPEND, NOT SOCCER-ERA PROVENANCE. Relay 1 drew this gate
// around every cron the World Cup left behind, which swept in poll-lineups -
// a plain provider fetch (~1 request per match in the hour before kickoff)
// that writes no prose and invokes no model. It was gated by proximity, not
// by the rule, and it starved a working instrument: the match page's lineups
// pitch had no data source at all. The two lists below name the actual
// distinction, so the next cron to arrive is sorted by what it SPENDS.

/** Leagues whose matches must not reach a MODEL: briefs, gloss, prematch
 * analyst, the editions. This is the editorial-and-cost ruling. */
export const CONTENT_EXCLUDED_LEAGUES = ['epl'];

/** Leagues excluded from plain PROVIDER polling (lineups, odds shape reads).
 * Empty by design - a fetch is not a spend decision. Kept as a list, and
 * applied in the same WHERE position, so re-gating a league later is one
 * entry rather than a re-plumbed query. */
export const POLL_EXCLUDED_LEAGUES = [];

/** @returns {boolean} may the content machine work this league's matches? */
export function contentAllowedForLeague(slug) {
  return !CONTENT_EXCLUDED_LEAGUES.includes(String(slug ?? ''));
}

/** The SQL fragment's parameter: pass to `l.slug <> ALL(...)` / NOT IN. */
export const CONTENT_EXCLUDED_SQL = CONTENT_EXCLUDED_LEAGUES;

/** Same, for the provider-poll selectors. */
export const POLL_EXCLUDED_SQL = POLL_EXCLUDED_LEAGUES;
