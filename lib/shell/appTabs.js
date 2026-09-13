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

import { SHELL_COOKIE, SHELL_VALUE } from './constants.js';

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
 *
 * IT USED TO CHECK location.search TOO, and no longer does. proxy.js turns
 * ?shell=sim-app into the cookie on the first request that carries it, so the
 * param is set before any client component mounts and reading it here would be
 * asking a second source the same question. The server half made the same move
 * (lib/shell/shell.js). One question, one answer.
 *
 * THE `search` KEY IS GONE FROM THE SIGNATURE ON PURPOSE. Leaving it accepted
 * and ignored would let a caller keep passing location.search and believe it
 * still mattered; a caller that passes it now gets an unknown-property error
 * from lint rather than a silent no-op.
 */
export function isShellClient({ cookie = '' } = {}) {
  const wanted = `${SHELL_COOKIE}=${SHELL_VALUE}`;
  return String(cookie).split('; ').some((c) => c.trim() === wanted);
}

// PROFILE LEFT THE BAR (v0.3): it was the least-used slot on a four-slot bar,
// and the scoreboard needed the seat. Account is now the header chip
// (components/shell/AppHeader) - avatar initial + @handle - so it is one tap
// from everywhere rather than one tab from four places.
//
// The SPORTSVYN icon is NOT an emoji: it is the Y-monogram (Y with macron,
// U+0232), set in Saira 900 italic by apptab.css keyed on data-key. An emoji
// in that slot would be a fifth brand next to the one tab that IS the brand.
// THE FIFTH TAB, v0.6. TODAY is the league browse surface - /nfl and its
// sections, with the league switcher in its header as the whole cross-league
// nav inside the container.
//
// PLACEMENT: fourth, directly before SPORTSVYN. Games / Mock / Tracker are what
// you DO; Today and Sportsvyn are what you READ, so the two browse surfaces sit
// together at the end rather than splitting the three game tabs. Putting Today
// first would have demoted Games out of the slot the product is named for.
//
// NAME COLLISION, FLAGGED NOT SOLVED: the Sportsvyn SEGMENT already has a tab
// called "Today" pointing at "/" (lib/shell/sportsvynTabs.js). Two tabs with
// one label at two levels, going to two places, is a real thing for a reader to
// trip over - but renaming either is a product decision, so both stand until
// it is made.
// MOCK AND TRACKER CAME OFF THE BAR (RANKINGS TAB v2, item 7). Both are
// linked from the Draft room module on the Games lobby, which is where a
// reader looks for them; a bottom bar is for sections, and two of five slots
// spent on one game's two rooms was the wrong shape once Rankings existed.
//
// 'games' RELABELS PLAY (ruling A). The key stays 'games' - it threads
// through RoomScope's data-tab and the override guard, and an identifier
// rename buys nothing a reader sees, the same argument that kept 'practice'
// when its label became Mock.
// FIVE TABS UNTIL THE YOU TAB EXISTS (ruling B). The mocks draw four - PLAY,
// SCORES, RANKINGS, YOU - and the You tab is not built, so Today and
// Sportsvyn hold the last two slots in the meantime.
//
// SCORES AND SPORTSVYN ARE DIFFERENT PLACES. 'sportsvyn' has always owned
// /scores and /market together, and splitting the label from the key would
// have left two tabs claiming one route; instead Scores takes the scoreboard
// it is named for and Sportsvyn takes the front door, which is the surface
// its brand mark belongs to and the only tab that lit nothing before.
export const APP_TABS = [
  { key: 'games', label: 'Play', icon: '🎮', href: '/games' },
  { key: 'scores', label: 'Scores', icon: '🏈', href: '/scores' },
  { key: 'rankings', label: 'Rankings', icon: '📊', href: '/rankings' },
  { key: 'today', label: 'Today', icon: '📅', href: '/nfl' },
  { key: 'sportsvyn', label: 'Sportsvyn', icon: 'Ȳ', href: '/' },
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
  // /sim AND /sim/tracker LIGHT PLAY, BY EXPLICIT BRANCH (ruling A). Their own
  // tabs came off the bar, and leaving them to fall through would have lit
  // nothing at all - a reader inside a mock draft would have been told they
  // had left the app. Both rooms are reached from the Games lobby, so Play is
  // the section they belong to. The order of these two no longer matters,
  // and they are written out rather than merged so a future split is one
  // line, not an archaeology problem.
  if (p.startsWith('/sim/tracker')) return 'games';
  if (p.startsWith('/sim')) return 'games';
  // TODAY OWNS THE LEAGUE ROUTES, SPORTSVYN OWNS THE NETWORK ONES, and the
  // split had to be made rather than left: /nfl used to light SPORTSVYN, so
  // adding a TODAY tab pointing at /nfl would have given one path two owners
  // and lit the wrong one. A league route is where a reader is inside one code;
  // /scores and /market serve all three at once.
  if (p.startsWith('/nfl') || p.startsWith('/cfb') || p.startsWith('/epl')) return 'today';
  if (p.startsWith('/scores') || p.startsWith('/market')) return 'scores';
  if (p.startsWith('/rankings')) return 'rankings';
  if (p === '/games' || p.startsWith('/games?')
    || p.startsWith('/daily') || p.startsWith('/weekly') || p.startsWith('/draft')) return 'games';
  // THE FRONT DOOR LIGHTS SPORTSVYN. It lit nothing before because no tab
  // pointed at it; now one does.
  //
  // '/' ONLY, NEVER ''. A null or undefined pathname collapses to an empty
  // string here, and that is ABSENT INPUT, not the home page - lighting a tab
  // for it would put the bar in a state no route produced.
  if (p === '/') return 'sportsvyn';
  // /account is the header chip's destination, not a tab - it lights nothing,
  // which is honest: the reader is in their account, not in a section.
  return null;   // the editorial surfaces light nothing
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
