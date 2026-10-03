// lib/leagues/nav.js - the league page's tab state, as URLs. PURE.
//
// The scoresNav law verbatim: one builder, one parser, round-tripped in
// tests, because a link must be able to open a specific tab and a URL must
// never carry tab state the page cannot read.
//
// LEAGUES V1 (P2): the rail is STANDINGS | THIS WEEK | MEMBERS (canvas board
// League). The per-game ghost tabs (Daily, Pick'em, Weekly, Draft, Season) are
// gone - one table across every game the league plays replaces them, and an old
// ?tab=daily link lands on the standings.

import { LEAGUE_GAME_TYPES } from './gameTypes.js';

export const LEAGUE_TABS = [
  { key: 'standings', label: 'Standings' },
  { key: 'week', label: 'This week' },
  { key: 'members', label: 'Members' },
];

const KEYS = new Set(LEAGUE_TABS.map((t) => t.key));

/** @returns {string} a valid tab key - junk (and every pre-V1 tab) falls to 'standings' */
export function parseLeagueTab(sp = {}) {
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  return KEYS.has(raw) ? raw : 'standings';
}

/** The one sanctioned league-page URL. Default tab is omitted - one page,
 * one URL. */
export function leagueHref(leagueId, tab = 'standings') {
  const base = `/leagues/${leagueId}`;
  return tab && tab !== 'standings' && KEYS.has(tab) ? `${base}?tab=${tab}` : base;
}

/** The share link a member copies into a group chat. */
export function leagueShareLink(joinCode) {
  return `https://sportsvyn.com/leagues?join=${joinCode}`;
}

/**
 * The filtered Pick'em boards a league links to - one per Pick'em sport
 * (/pickem/<sport>?league=<id>, the board's own ?league= filter). A league
 * without Pick'em links none. The sports are the game type's own list
 * (lib/leagues/gameTypes.js): a Pick'em league plays every one of them.
 */
export function pickemBoardLinks(leagueId, games = []) {
  if (!games.includes('pickem')) return [];
  const g = LEAGUE_GAME_TYPES.find((x) => x.key === 'pickem');
  return (g?.sports ?? []).map((s) => ({ sport: s, label: `Pick'em ${s.toUpperCase()}`, href: `/pickem/${s}?league=${leagueId}` }));
}
