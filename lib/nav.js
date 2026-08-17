// lib/nav.js - the global navigation, as data.
//
// PURE, AND IN ITS OWN FILE so it can be tested. It used to live inside
// GlobalHeader.js, which is a 'use client' component: importing it in a node
// test drags React and next/navigation along with it, so the one thing worth
// asserting - that every destination the site has is actually reachable from
// the chrome - was untestable. That is how The Daily shipped to production with
// no nav entry at all.
//
// FIVE DESTINATIONS, NO DROPDOWNS at the top level: a menu that needs a
// disclosure to tell you what a site contains is a site that has not decided.

// ONE SLOT, FOUR GAMES BEHIND IT. This was THE DAILY until the lobby existed;
// with four games shipping, a nav that names one of them is a nav that will be
// wrong three times over. /daily stays reachable directly and as the lobby's
// first card - the entry moved, the destination did not go anywhere.
export const NAV = [
  { key: 'today', label: 'TODAY', href: '/' },
  { key: 'games', label: 'GAMES', href: '/games' },
  { key: 'scores', label: 'SCORES', href: '/scores' },
  { key: 'nfl', label: 'NFL', href: '/nfl' },
  { key: 'cfb', label: 'CFB', href: '/cfb' },
  { key: 'soccer', label: 'SOCCER', href: '/world-cup-2026/bracket' },
];

// activeNav keys that predate this header, mapped onto the list above so the
// existing call sites keep lighting the right tab.
export const ALIAS = {
  home: 'today', bracket: 'soccer', rankings: 'soccer', stats: 'soccer',
  schedule: 'soccer', fantasy: 'nfl', market: 'nfl', football: 'nfl',
  // The Daily's own pages pass activeNav="daily" and used to light their own
  // slot. The slot is GAMES now, so without this alias every Daily surface
  // would light nothing at all.
  daily: 'games',
};

export const resolveActive = (activeNav) => ALIAS[activeNav] ?? activeNav ?? null;

/**
 * The signed-in account menu.
 *
 * ACCOUNT LEADS, because it is the one item that answers "who am I signed in
 * as and how do I stop". /my is a dashboard and /membership is a price list;
 * neither is an account page, and before /account existed the only real one
 * was /sim/account - reachable only from inside the sim.
 *
 * 3.1.1: no pricing entry inside the native container.
 */
export function accountMenu({ shell = false } = {}) {
  return [
    { key: 'account', label: 'Account', href: '/account' },
    { key: 'my', label: 'My Sportsvyn', href: '/my' },
    ...(shell ? [] : [{ key: 'membership', label: 'Membership', href: '/membership' }]),
    { key: 'signout', label: 'Sign Out', action: 'signout' },
  ];
}

/** Where the reader is, preserved through the sign-in round trip. */
export function signinHrefFor(pathname) {
  return pathname && !pathname.startsWith('/signin')
    ? `/signin?callbackUrl=${encodeURIComponent(pathname)}`
    : '/signin';
}
