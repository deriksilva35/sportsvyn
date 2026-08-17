// lib/shell/appTabs.js - the app's bottom tab bar, as data. PURE.
//
// IN ITS OWN FILE SO IT CAN BE TESTED, for the same reason lib/nav.js is: the
// list used to live inside a 'use client' component, and a whole product
// shipped to production unreachable because nothing could assert on the chrome.
// This bar is the ONLY navigation inside the app container - there is no URL
// bar to escape with - so an unreachable destination here is worse than it was
// on the web.
//
// FOUR TABS, from docs/design/draftvyn-unified-app-mock-v0_2.html:
//   GAMES · PRACTICE · TRACKER · PROFILE
//
// The sim's own five-tab bar (components/sim/SimTabBar) is NOT this. That one
// navigates inside the sim; this one navigates the whole app, and PRACTICE is
// the single door into the sim rather than four of them.

import { SHELL_COOKIE, SHELL_VALUE, SHELL_PARAM } from './constants.js';

/**
 * Is this client inside the app container?
 *
 * PURE AND TAKING ITS INPUTS, so the gate can be tested without a browser. The
 * component reads document.cookie and location.search and hands them here; a
 * test hands strings. Before this split the only way to check the gate was to
 * open the app, which is exactly the class of thing that ships broken.
 *
 * THE COOKIE IS MATCHED WHOLE, not with includes(). A substring test would let
 * any cookie whose value merely CONTAINS the marker - or a differently-named
 * cookie ending in the same characters - turn the bar on for a web reader.
 */
export function isShellClient({ cookie = '', search = '' } = {}) {
  const wanted = `${SHELL_COOKIE}=${SHELL_VALUE}`;
  if (String(cookie).split('; ').some((c) => c.trim() === wanted)) return true;
  return new URLSearchParams(String(search)).get(SHELL_PARAM) === SHELL_VALUE;
}

export const APP_TABS = [
  { key: 'games', label: 'Games', icon: '🎮', href: '/games' },
  { key: 'practice', label: 'Practice', icon: '🎲', href: '/sim' },
  { key: 'tracker', label: 'Tracker', icon: '📡', href: '/sim/tracker' },
  { key: 'profile', label: 'Profile', icon: '👤', href: '/account' },
];

/**
 * Which tab owns this path.
 *
 * ORDER MATTERS: /sim/tracker must be tested BEFORE /sim, or the tracker would
 * light PRACTICE forever. Longest prefix first is the rule.
 *
 * EVERY GAME LIGHTS GAMES. /daily, /weekly, /draft and /games are one
 * destination as far as this bar is concerned - the lobby is their front door,
 * and a bar that lit nothing while a reader was inside a game would tell them
 * they had left the app.
 */
export function activeTabFor(pathname) {
  const p = String(pathname ?? '');
  if (p.startsWith('/sim/tracker')) return 'tracker';
  if (p.startsWith('/sim')) return 'practice';
  if (p.startsWith('/account')) return 'profile';
  if (p === '/games' || p.startsWith('/games?')
    || p.startsWith('/daily') || p.startsWith('/weekly') || p.startsWith('/draft')) return 'games';
  return null;   // the homepage and the editorial surfaces light nothing
}

/**
 * THE CHROME-ISOLATION LAW: any surface with a clock owns its screen.
 *
 * A tab bar under a running clock is an invitation to leave mid-round, and in
 * the Daily's case leaving mid-round FORFEITS the attempt - the board was seen,
 * so the attempt is consumed whether or not a lineup was locked. Chrome that
 * can cost a player their score is not chrome, it is a trap.
 *
 * ROUTE-BASED SUPPRESSION IS NOT ENOUGH and this is the subtle part. /daily is
 * one route with four states and only one of them has a clock; suppressing the
 * whole route would strip the bar from the pitch and the receipt, which have no
 * clock and every reason to offer a way out. So the live states raise a flag on
 * the document while they are mounted (see components/shell/ClockOwned) and the
 * bar hides on THAT, not on the path. This function covers only the surfaces
 * that are clock-owned for their whole lifetime.
 */
export function routeSuppressed(pathname) {
  const p = String(pathname ?? '');
  // A draft room - ranked or practice - is a session from first render to last.
  // The sim already declines to draw its own bar here for the same reason.
  return /^\/sim\/draft\/[^/]+$/.test(p);
}
