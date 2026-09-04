// lib/push/copy.js - what the three notifications say. PURE, so the words are
// testable - including the house hyphen rule, which applies to a lock screen
// exactly as it applies to a mail client: an em dash pasted from a draft
// renders differently everywhere and nobody proofreads a push.
//
// SHORT IS THE SPEC. A lock screen truncates a title around 30-40 characters
// and a body around 110-150 depending on device; everything here fits the
// tightest cut, so no device ever shows half a sentence.
//
// THE URL IS WHERE THE TAP LANDS, inside the app (the shell opens it as an
// in-app navigation, not Safari).

/** eventId prefix -> the notification. Date/board suffixes carry identity. */
export const PUSH_COPY = {
  // v2 (season-roster board) copy, relay 5a. NOT WIRED TO ANY SEND YET - only
  // the strings changed here; notify.js's send path is untouched.
  'daily-live': {
    title: 'The Daily is live',
    body: 'A new season just opened. Twelve teams, eight slots, one player from each. Three minutes when you are.',
    url: '/daily/board',
  },
  'daily-revealed': {
    title: 'The board is settled',
    body: 'Midnight. The field is in. See the best roster, the leaderboard and where you landed.',
    url: '/daily/board',
  },
  'pickem-open': {
    title: "Pick 'em is open",
    body: 'The first board is up - make your picks before kickoff.',
    // Retargeted from /games when /pickem shipped (relay 2): the tap lands
    // on the board itself, not a lobby with one more tap in it.
    url: '/pickem',
  },
  'pickem-reminder': {
    title: 'Picks lock at kickoff',
    body: 'First game is close - every pick seals when its game kicks. Call the rest now.',
    url: '/pickem',
  },
  'pickem-settled': {
    title: "Your Pick 'em result is in",
    body: 'The board settled. See your record and where you landed.',
    url: '/pickem',
  },
};

/**
 * The payload copy for an event id like 'daily-live:2026-08-19'.
 * @returns {object|null} null for an unknown prefix - the caller skips, not throws.
 */
export function copyFor(eventId) {
  const prefix = String(eventId ?? '').split(':')[0];
  return PUSH_COPY[prefix] ?? null;
}
