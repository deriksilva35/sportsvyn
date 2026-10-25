// lib/scores/statsFilter.js - the browser-safe half of the Stats tab (sun-1), PURE.
//
// The tab cookie (sv_scores_tab, the pattern of sv_top25) and the row filters. Kept
// apart from statsTab.js because client components import THIS file, and statsTab.js
// reaches the scorers and (through them) modules a browser bundle must not pull in.

export const TAB_COOKIE = 'sv_scores_tab';
export const TABS = Object.freeze(['games', 'stats']);

/** The request's tab: the query when it names one, else the remembered value, else Games. */
export function wantTab(queryValue, cookieValue) {
  if (TABS.includes(queryValue)) return queryValue;
  return TABS.includes(cookieValue) ? cookieValue : 'games';
}

/** The Set-Cookie string document.cookie takes; a year, site-wide. */
export function tabCookieString(tab) {
  return `${TAB_COOKIE}=${tab === 'stats' ? 'stats' : 'games'}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** The status chip cycles Live + final -> Live -> Final. */
export const STATUS_CYCLE = Object.freeze(['all', 'live', 'final']);
export const STATUS_WORDS = Object.freeze({ all: 'Live + final', live: 'Live', final: 'Final' });

/**
 * Narrow the rows (the board runs this in the browser; it is pure so a fixture
 * can pin it). Search matches name, team or game ("buf", "mia @ buf", "allen").
 * Rank stays the day's rank, not the row's place in the narrowed list.
 */
export function filterRows(rows, { q = '', pos = 'All', status = 'all', mine = false } = {}) {
  const needle = String(q).trim().toLowerCase();
  return rows.filter((r) => {
    if (pos !== 'All' && !String(r.pos).split('-').includes(pos) && r.pos !== pos) return false;
    if (status !== 'all' && r.status !== status) return false;
    if (mine && !r.inMine) return false;
    if (needle && !`${r.name} ${r.team} ${r.opp} ${r.tag} ${r.opp} @ ${r.team}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

