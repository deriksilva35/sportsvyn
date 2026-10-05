// lib/shell/playHeader.js - WHICH ROUTE GETS THE CENTRED LOCKUP HEADER (mon-15/16).
//
// The Play lobby, and only the Play lobby, draws the header as the brand
// lockup: the wordmark centred, about 34px tall, "THE ARCADE OF SPORTS" under
// it, the right edge pinned so the mark stays on the centre line (the Play tab
// mock, "Tagline header", option A). Every other route keeps the slim
// left-aligned header.
//
// THE LOBBY HAS TWO DOORS (mon-16, Derik): /games always, and / WHEN / RENDERS
// THE LOBBY - which it does under the arcade theme (app/page.js: arcadeFor()).
// The caller says whether that is so (`lobbyAtRoot`): the app header reads it
// off <html data-theme>, the web header from the server's arcadeOn().
//
// EXACT match: /games/how-it-works and the rest of /games/* are pages inside
// the tab, not its front door.
export const PLAY_HEADER_PATHS = Object.freeze(['/games']);

export function isPlayHeaderPath(pathname, { lobbyAtRoot = false } = {}) {
  if (typeof pathname !== 'string' || !pathname) return false;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p === '/') return lobbyAtRoot === true;
  return PLAY_HEADER_PATHS.includes(p);
}
