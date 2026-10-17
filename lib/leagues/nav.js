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
  // DRAFT (slice 3): only a league with a linked draft shows it - leagueTabs().
  { key: 'draft', label: 'Draft' },
  { key: 'standings', label: 'Standings' },
  // THE SECOND TAB IS "TODAY" (thu-4: "This day" -> "Today"); a weekly league
  // reads it as "This week" (lib/leagues/home.js tabLabel). ?tab=week, the old
  // key, still lands here.
  { key: 'today', label: 'Today' },
  // CHAT is on the rail before it exists: "Coming soon" until the chat slice.
  { key: 'chat', label: 'Chat' },
  { key: 'members', label: 'Members' },
];

const KEYS = new Set(LEAGUE_TABS.map((t) => t.key));

/**
 * The rail a league actually shows. A draft league opens on DRAFT; it shows
 * STANDINGS and TODAY only when it also plays games (ruling fri-3: games beside
 * the draft are allowed, crew points apply). Every other league: unchanged.
 */
export function leagueTabs({ hasDraft = false, hasGames = true } = {}) {
  return LEAGUE_TABS.filter((t) => (t.key === 'draft' ? hasDraft
    : (t.key === 'standings' || t.key === 'today') ? hasGames : true));
}

/** The tab a league opens on when the URL names none (or one it does not show). */
export function landingTab(tab, rail) {
  return rail.some((t) => t.key === tab) ? tab : rail[0]?.key ?? 'standings';
}
const ALIASES = Object.freeze({ week: 'today' });

/** @returns {string} a valid tab key - junk (and every pre-V1 tab) falls to 'standings' */
export function parseLeagueTab(sp = {}) {
  const raw0 = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const raw = ALIASES[raw0] ?? raw0;
  return KEYS.has(raw) ? raw : 'standings';
}

const one = (v) => (Array.isArray(v) ? v[0] : v);

/** The table's own state: ?period= (a chip) and ?game= (a crew league's game). Unchecked here - the table validates against its chips. */
export function parseLeagueView(sp = {}) {
  const period = one(sp.period);
  const game = one(sp.game);
  return {
    period: typeof period === 'string' && /^[a-z0-9-]{1,20}$/.test(period) ? period : null,
    game: typeof game === 'string' && /^[a-z0-9_]{1,24}$/.test(game) ? game : null,
  };
}

/** The one sanctioned league-page URL. Default tab is omitted - one page,
 * one URL. `view` carries the table's period chip and crew game chip. */
export function leagueHref(leagueId, tab = 'standings', view = {}) {
  const base = `/leagues/${leagueId}`;
  const q = new URLSearchParams();
  if (tab && tab !== 'standings' && KEYS.has(tab)) q.set('tab', tab);
  if (view.game && view.game !== 'all') q.set('game', view.game);
  if (view.period) q.set('period', view.period);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
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
