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
  'daily-live': {
    title: 'The Daily is live',
    body: 'A new board just opened - 64 performances, one hidden week. Three minutes when you are.',
    url: '/daily',
  },
  'daily-revealed': {
    title: 'The answer is up',
    body: 'The Daily just revealed. See the week, the perfect six and where you landed.',
    url: '/daily',
  },
  'pickem-open': {
    title: "Pick 'em is open",
    body: 'The first board is up - make your picks before kickoff.',
    url: '/games',
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
