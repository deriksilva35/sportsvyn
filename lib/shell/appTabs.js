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

// PROFILE LEFT THE BAR (v0.3): it was the least-used slot on a four-slot bar,
// and the scoreboard needed the seat. Account is now the header chip
// (components/shell/AppHeader) - avatar initial + @handle - so it is one tap
// from everywhere rather than one tab from four places.
//
// The SPORTSVYN icon is NOT an emoji: it is the Y-monogram (Y with macron,
// U+0232), set in Saira 900 italic by apptab.css keyed on data-key. An emoji
// in that slot would be a fifth brand next to the one tab that IS the brand.
export const APP_TABS = [
  { key: 'games', label: 'Games', icon: '🎮', href: '/games' },
  // 'Mock' since v0.3.1 - the label is the product truth; the KEY stays
  // 'practice' because it threads through RoomScope's data-tab and the
  // override guard, and an identifier rename buys nothing a reader sees.
  { key: 'practice', label: 'Mock', icon: '🎲', href: '/sim' },
  { key: 'tracker', label: 'Tracker', icon: '📡', href: '/sim/tracker' },
  { key: 'sportsvyn', label: 'Sportsvyn', icon: 'Ȳ', href: '/scores' },
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
export function activeTabFor(pathname, override = null) {
  // A ROOM MAY OVERRIDE THE PATH, and only a room needs to. /sim/draft/[id]
  // serves both the practice sim and the tracker, so the URL genuinely cannot
  // say which section you are in - starting a tracker room from the TRACKER tab
  // used to land you in a room with PRACTICE lit. The room declares it instead
  // (components/shell/RoomScope). Guarded against a stale or invented value:
  // an override naming no real tab is ignored rather than lighting nothing.
  if (override && APP_TABS.some((t) => t.key === override)) return override;
  const p = String(pathname ?? '');
  if (p.startsWith('/sim/tracker')) return 'tracker';
  if (p.startsWith('/sim')) return 'practice';
  // THE SPORTSVYN SEGMENT: the scoreboard and every /nfl surface (fantasy
  // board, game pages, rankings) light one tab - they are one destination the
  // way the four games are. Before this branch existed the bar went DARK on
  // /scores and /nfl/*, which read as having left the app.
  if (p.startsWith('/scores') || p.startsWith('/nfl')) return 'sportsvyn';
  if (p === '/games' || p.startsWith('/games?')
    || p.startsWith('/daily') || p.startsWith('/weekly') || p.startsWith('/draft')) return 'games';
  // /account is the header chip's destination, not a tab - it lights nothing,
  // which is honest: the reader is in their account, not in a section.
  return null;   // the homepage and the editorial surfaces light nothing
}

/**
 * THE CHROME-ISOLATION LAW: A CLOCK OWNS THE SCREEN. Not a route.
 *
 * A tab bar under a running clock is an invitation to leave mid-round, and in
 * the Daily's case leaving mid-round FORFEITS the attempt - the board was seen,
 * so it is consumed whether or not a lineup was locked. Chrome that can cost a
 * player their score is not chrome, it is a trap.
 *
 * THIS FUNCTION IS NOW ALWAYS FALSE, AND THE HISTORY IS THE POINT. It used to
 * suppress /sim/draft/[id] wholesale, on the reasoning that a draft room is a
 * session. That was wrong twice over:
 *
 *   1. A TRACKER ROOM HAS NO CLOCK. It runs for hours at a real table and is
 *      precisely where somebody needs to leave and come back - a tracked draft
 *      you cannot navigate out of is a trap, not focus. It shares this exact
 *      route with the sim room, so no path test could ever tell them apart.
 *   2. A PRACTICE MOCK MAY HAVE NO CLOCK EITHER - CLOCK_OPTIONS includes null,
 *      and an untimed mock has nothing to protect.
 *
 * So the room DECLARES it: components/shell/RoomScope raises a flag on the
 * document while a timed room or a live Daily round is mounted, and the bar
 * hides on that. The rule is now what it always claimed to be - the presence of
 * a clock - rather than a guess from the URL.
 *
 * Kept as a function rather than deleted because the concept is real: a future
 * surface that is clock-owned for its entire lifetime should say so here rather
 * than mounting a flag it can never clear.
 */
export function routeSuppressed(pathname) {
  return false && Boolean(pathname);
}
