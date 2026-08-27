// lib/scopeVocabulary.js - what an id MEANS, per dashboard scope.
//
// user_dashboards stores an ordered array of {id} per (user_id, scope), and
// migration 039 added `scope` in its own words "so one user can own more than a
// single saved layout ... room for future boards without a second table". The
// Today page's tuned-league set is that second board: scope 'today', same
// shape, different vocabulary.
//
// BOTH SIDES NEED THE VOCABULARY, NOT JUST THE RESOLVER. getResolvedLayout
// filters stored entries with `p.id in PANELS`, and saveUserLayout sanitizes
// against PANELS ∩ PANEL_BINDINGS. A league id is in neither, so a today-scope
// write of {id:'cfb'} would have been sanitized down to nothing and rejected as
// 'empty_layout' - the save would have failed silently-ish and the resolver
// would then have dropped every entry it did somehow read. Teaching only the
// read half is a bug that looks like "chips don't persist".
//
// 'my' IS UNTOUCHED BY CONSTRUCTION. Its entry here returns exactly the checks
// the two functions already performed, so the panel dashboard resolves and
// saves byte-identically. That is pinned by test rather than asserted here.

import { PANELS, DEFAULT_ACTIVE } from './panels.js';
import { LEAGUE_IDS, DEFAULT_TODAY_LEAGUES } from './today/leagues.js';

export const SCOPES = Object.freeze({
  my: {
    // A panel must be BOTH registered and bound to be stored - the bound check
    // is what rejects unbuilt and member-tier panels. The binding map is a
    // server module, so it is injected by the caller rather than imported here:
    // this file is reachable from the client customize UI.
    isValidRead: (id) => typeof id === 'string' && id in PANELS,
    isValidWrite: (id, { bindings } = {}) =>
      typeof id === 'string' && id in PANELS && (!bindings || id in bindings),
    defaults: () => DEFAULT_ACTIVE.map((id) => ({ id })),
  },
  today: {
    // A league id, and nothing else. The archive is a valid id even though it
    // is off by default - a user who turns the World Cup on has it stored.
    isValidRead: (id) => typeof id === 'string' && LEAGUE_IDS.includes(id),
    isValidWrite: (id) => typeof id === 'string' && LEAGUE_IDS.includes(id),
    defaults: () => DEFAULT_TODAY_LEAGUES.map((id) => ({ id })),
  },
});

export const SCOPE_NAMES = Object.freeze(Object.keys(SCOPES));

/** Unknown scopes resolve to null so callers can refuse rather than guess. */
export function vocabularyFor(scope) {
  return SCOPES[scope] ?? null;
}
