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
  // /market shipped live in Phase A and was reachable only from the footer and
  // the sitemap - a board that updates every fifteen minutes, behind a door
  // nobody walks past. It sits beside SCORES because that is what it is: the
  // same games, priced instead of played.
  { key: 'market', label: 'MARKET', href: '/market' },
  { key: 'nfl', label: 'NFL', href: '/nfl' },
  { key: 'cfb', label: 'CFB', href: '/cfb' },
  // THE WORLD CUP IS OVER (final 19 Jul 2026) and soccer's front door is no
  // longer a bracket - it is the Premier League table, which is what "soccer"
  // means to a reader arriving with no fixture in mind. /world-cup-2026/*
  // still SERVES; it just stopped being a front door.
  { key: 'soccer', label: 'SOCCER', href: '/epl/standings' },
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
 * THE ARCADE NAV (tue-3): the five products, in the footer's order and with its
 * hrefs (components/SiteFooter.js FOOTER_PRODUCTS) - Play is the lobby, which
 * is also /. No TODAY (the front page lives at /today, linked from no nav), no
 * GAMES (Play is it), no NFL / CFB / SOCCER: a league's pages keep their own
 * pill row. Only under the arcade theme; the dark header keeps NAV above.
 */
export const ARCADE_NAV = [
  { key: 'play', label: 'PLAY', href: '/games' },
  { key: 'scores', label: 'SCORES', href: '/scores' },
  { key: 'market', label: 'MARKET', href: '/market' },
  { key: 'rankings', label: 'RANKINGS', href: '/rankings' },
  { key: 'leagues', label: 'LEAGUES', href: '/leagues' },
];

/** Which arcade tab a page's activeNav lights. A league page lights nothing. */
export const ARCADE_ALIAS = {
  games: 'play', daily: 'play', today: 'play', home: 'play', practice: 'play',
  scores: 'scores', market: 'market', rankings: 'rankings', leagues: 'leagues',
};
export const resolveArcadeActive = (activeNav) => ARCADE_ALIAS[activeNav] ?? null;

/** The nav list and the active key for a theme - the header asks once. */
export const navFor = (arcade, activeNav) => (arcade
  ? { items: ARCADE_NAV, active: resolveArcadeActive(activeNav) }
  : { items: NAV, active: resolveActive(activeNav) });

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
    // MY SPORTSVYN IS NOT IN THIS MENU ANY MORE. It moved to the mode switcher
    // that sits at the top of both / and /my - two pills, one of them always
    // lit - so the account menu is not a second, quieter way to reach the same
    // dashboard. The locked mock's nav shows it gone; this is that.
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
