// lib/shell/resumeRule.js - where an app ACTIVATION lands, as a value. PURE.
//
// The ruling: the app opens on GAMES. The /app 307 covers the document-load
// path; this rule covers the OTHER way an app "opens" - iOS handing back a
// webview that never reloaded. Somebody who flipped to Messages mid-pick gets
// their room back; somebody returning after lunch gets the tabs, not
// whatever screen they abandoned.
//
// PRECEDENCE, in order, each earning its place:
//   1. A push-tap deep link wins outright - the reader chose a destination.
//   2. A LIVE TRACKER ROOM is never interrupted, regardless of gap: draft
//      night at a real table is sacred, and the room can idle for an hour
//      between picks. (A mock has no such shield - its road back is the
//      DRAFT IN PROGRESS resume card on /sim, which already exists.)
//   3. No recorded background time = cold start (fresh webview process, or
//      WKWebView restoration that bypassed /app) -> go home. This is the
//      belt to the 307's suspenders.
//   4. Under the threshold -> stay put. At or over -> home.
//   5. Already home -> nothing; a redirect to where you stand is jank.

export const STALE_MS = 5 * 60 * 1000;

/**
 * @param {object}  a
 * @param {number|null} a.gapMs   ms since backgrounding; null = no record
 * @param {string|null} a.dataTab the room's declared tab (RoomScope's
 *                                data-tab) - 'tracker' shields the room
 * @param {boolean} a.deepLinkPending a push tap already chose a destination
 * @param {string}  a.pathname    where the webview currently stands
 * @returns {'/games'|null} navigate, or leave the reader where they are
 */
export function resumeDecision({ gapMs = null, dataTab = null, deepLinkPending = false, pathname = '' } = {}) {
  if (deepLinkPending) return null;
  if (dataTab === 'tracker') return null;
  const home = pathname === '/games' || String(pathname).startsWith('/games?');
  if (gapMs == null) return home ? null : '/games';   // cold start
  if (gapMs < STALE_MS) return null;                  // fresh - resume in place
  return home ? null : '/games';
}
