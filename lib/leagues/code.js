// lib/leagues/code.js - the six-character league code, PURE and client-safe.
//
// IT EXISTS SO THE SHEET AND THE SERVER CANNOT DISAGREE. lib/leagues/core.js
// imports `sql`, so a client component cannot import it - which is why the
// refusal sentence "Codes are six characters" was written out TWICE: once in
// joinLeague() and once, lower-cased, in components/leagues/JoinPrompt.js. Two
// copies of a sentence are two sentences, and the day one is reworded the app
// tells a reader two different things about the same typo.
//
// SAME SHAPE AS lib/fantasy/inviteCode.js, which does this job for the EIGHT-
// character fantasy invite. These are two different codes for two different
// things - a player league is six, a draft-room invite is eight - and they share
// only the alphabet.

export { CODE_ALPHABET } from '../fantasy/inviteCode.js';
import { CODE_ALPHABET } from '../fantasy/inviteCode.js';

/** Six. A code that gets read aloud in a group chat does not want to be longer. */
export const CODE_LENGTH = 6;

/**
 * EVERY REFUSAL A CODE CAN EARN, in the words the reader sees.
 *
 * The server returns these strings (joinLeague) and the sheet renders what it is
 * handed, so the only one the CLIENT decides for itself is the length - which it
 * must, because a submit that cannot possibly succeed should not cost a round
 * trip. Same string either way, from here.
 */
export const REFUSALS = Object.freeze({
  not_a_code: 'Codes are six characters',
  no_league: 'No league with that code',
  signed_out: 'Sign in first',
  failed: 'Could not join',
  // LEAGUES V1 (fri-1): the cap, the start line, the reset and the owner's one
  // write. Same rule - the server returns these and every surface renders them.
  full: 'This league is full',
  started: 'This league has started and is closed to new members',
  dead_link: 'That invite link has been reset - ask for a fresh one',
  not_owner: 'Only the league owner can do that',
});

/**
 * THE LINK TOKEN (Leagues V1). Twelve characters from the same alphabet, so a
 * link nobody types can be long enough that nobody guesses it either - the
 * six-character code is for reading aloud, the token is for the share sheet.
 * Both rotate on an owner's reset, and /j/<x> takes either: six characters is
 * a code, twelve is a token, anything else is no invite at all.
 */
export const INVITE_TOKEN_LENGTH = 12;

/** A raw invite key (typed code or link token) -> { kind: 'code' | 'token', value } or null. PURE. */
export function parseInviteKey(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[\s-]+/g, '');
  if (!s || [...s].some((ch) => !CODE_ALPHABET.includes(ch))) return null;
  if (s.length === CODE_LENGTH) return { kind: 'code', value: s };
  if (s.length === INVITE_TOKEN_LENGTH) return { kind: 'token', value: s };
  return null;
}

/** The one invite path. Relative - it stays on whatever origin served it. */
export const invitePath = (key) => `/j/${encodeURIComponent(String(key ?? ''))}`;

/** The invite key inside a sign-in callbackUrl ('/j/KEY?shell=sim-app'), or null. */
export function inviteKeyFromCallback(callbackUrl) {
  const m = /^\/j\/([^/?#]+)/.exec(String(callbackUrl ?? ''));
  if (!m) return null;
  let raw; try { raw = decodeURIComponent(m[1]); } catch { return null; }
  return parseInviteKey(raw)?.value ?? null;
}

/**
 * What a paste becomes as it lands. "abcd-ef " -> "ABCDEF".
 *
 * AT THE KEYSTROKE, NOT AT SUBMIT: a field that silently accepts a hyphen and
 * then refuses the code has told the reader their code is wrong when it was the
 * field that was. Confusables are not in the alphabet at all (no 0/O, 1/I/L),
 * so they are dropped here rather than mapped - a code containing one was never
 * minted by us.
 */
export function cleanLeagueInput(raw) {
  let out = '';
  for (const ch of String(raw ?? '').toUpperCase()) {
    if (CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === CODE_LENGTH) break;
  }
  return out;
}

/** A complete, valid code - or null. The one gate both sides agree on. */
export function normalizeLeagueCode(raw) {
  const code = cleanLeagueInput(raw);
  return code.length === CODE_LENGTH ? code : null;
}

/**
 * THE SHARE LINK, and it is `/leagues?join=CODE`.
 *
 * NOT `/leagues/join/CODE`, which is what /run/board printed until now and which
 * 404s: there is no such route, and app/leagues/[id] cannot match two segments.
 * The share target a friend taps has to be a path that exists, because a dead
 * link punishes the friend for the member's trust in it.
 */
export function joinHref(code) {
  const c = cleanLeagueInput(code);
  return c ? `/leagues?join=${c}` : '/leagues';
}
