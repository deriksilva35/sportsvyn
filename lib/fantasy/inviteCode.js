// lib/fantasy/inviteCode.js - the invite code as a VALUE: alphabet, length,
// normalization, the join path, the refusal wording. PURE, no DB, no request -
// so the code FIELD on the lobby (a client component) and the /join route (a
// server component) read the same definition. lib/fantasy/leagueShare.js
// re-exports these; nothing here is a second implementation.
//
// THE ALPHABET drops the confusables (0/O, 1/I/L): a code read aloud in a
// group chat, or typed from a screenshot, must not have two right answers.
// It is the same alphabet lib/leagues/core.js mints with; core.js imports the
// DB, which is why the constant lives here and core.js takes it from here.

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.replace(/[0OIL1]/g, '');
export const INVITE_CODE_LENGTH = 8;

/** A pasted code: upper-cased, whitespace and hyphens dropped; null when it cannot be one. */
export function normalizeInviteCode(raw) {
  const code = String(raw ?? '').toUpperCase().replace(/[\s-]+/g, '');
  if (code.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/**
 * What the code field keeps as the reader types: upper-cased, only alphabet
 * characters, capped at the length. Paste "abcd-efgh " and the field reads
 * ABCDEFGH. A confusable (o, 0, i, l, 1) is dropped at the keystroke rather
 * than refused at submit - the field cannot hold a code that cannot exist.
 */
export function cleanInviteInput(raw) {
  let out = '';
  for (const ch of String(raw ?? '').toUpperCase()) {
    if (CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === INVITE_CODE_LENGTH) break;
  }
  return out;
}

/** The one path a code resolves to. Relative: it stays on whatever origin served it. */
export const joinPath = (code) => `/join/${code}`;

/** The code inside a sign-in callbackUrl ('/join/ABCDEFGH?shell=sim-app'), or null. */
export function codeFromCallback(callbackUrl) {
  const m = String(callbackUrl ?? '').match(/^\/join\/([^/?#]+)/);
  return m ? normalizeInviteCode(decodeURIComponent(m[1])) : null;
}

/** Plain words for every refusal the preview or the redeem can return. ONE copy. */
export const REFUSALS = {
  invalid_code: 'That code does not match a league. Check it, or ask for a fresh one.',
  revoked: 'This code was turned off by the league owner. Ask for a fresh one.',
  expired: 'This code expired. Ask the league owner for a fresh one.',
  full: 'This code has been used up. Ask the league owner for a fresh one.',
  franchise_taken: 'Somebody claimed that team a moment ago. Pick another, or join without one.',
  no_such_franchise: 'That team is not in this league.',
  unauthenticated: 'Please sign in.',
  not_a_code: `A code is ${INVITE_CODE_LENGTH} letters and numbers - no O, 0, I, L or 1.`,
};
