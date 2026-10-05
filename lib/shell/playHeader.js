// lib/shell/playHeader.js - WHICH ROUTE GETS THE CENTRED LOCKUP HEADER (mon-15).
//
// The Play lobby, and only the Play lobby, draws the app header as the brand
// lockup: the wordmark centred, about 34px tall, "THE ARCADE OF SPORTS" under
// it, the avatar (or SIGN IN) pinned to the right edge so the mark stays on the
// centre line (the Play tab mock, "Tagline header", option A). Every other
// route keeps the slim left-aligned header. EXACT match: /games/how-it-works and
// the rest of /games/* are pages inside the tab, not its front door.
export const PLAY_HEADER_PATHS = Object.freeze(['/games']);

export function isPlayHeaderPath(pathname) {
  if (typeof pathname !== 'string') return false;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return PLAY_HEADER_PATHS.includes(p);
}
