// lib/leagues/nav.js - the league page's tab state, as URLs. PURE.
//
// The scoresNav law verbatim: one builder, one parser, round-tripped in
// tests, because a link must be able to open a specific tab and a URL must
// never carry tab state the page cannot read.
//
// CALENDAR ORDER, RATIFIED: Daily (live now) → Pick'em (Aug 27) → Weekly
// (Sep 10) → Draft (Sep 10) → Season (first settle). The ghost dates render
// in mono on the pills; they live HERE so the pills and any copy that cites
// them cannot drift apart.

export const LEAGUE_TABS = [
  { key: 'daily', label: 'Daily', ghost: false, date: null },
  { key: 'pickem', label: "Pick 'em", ghost: true, date: 'AUG 27' },
  { key: 'weekly', label: 'Weekly', ghost: true, date: 'SEP 10' },
  { key: 'draft', label: 'Draft', ghost: true, date: 'SEP 10' },
  { key: 'season', label: 'Season', ghost: true, date: null },
];

const KEYS = new Set(LEAGUE_TABS.map((t) => t.key));

/** @returns {string} a valid tab key - junk falls to 'daily', the default */
export function parseLeagueTab(sp = {}) {
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  return KEYS.has(raw) ? raw : 'daily';
}

/** The one sanctioned league-page URL. Default tab is omitted - one page,
 * one URL. */
export function leagueHref(leagueId, tab = 'daily') {
  const base = `/leagues/${leagueId}`;
  return tab && tab !== 'daily' && KEYS.has(tab) ? `${base}?tab=${tab}` : base;
}

/** The share link a member copies into a group chat. */
export function leagueShareLink(joinCode) {
  return `https://sportsvyn.com/leagues?join=${joinCode}`;
}
