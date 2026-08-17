// lib/daily/handles.js - player handles. PURE.
//
// THE ANONYMOUS NAME IS NOT "Player #37". A sequential id on a public
// leaderboard publishes the user count and the signup order, and it is
// enumerable: watch the board for a week and you know roughly how big this
// thing is. Four hex characters of an HMAC over the id leak neither, stay
// stable so a rival is recognisable week to week, and cost nothing.
//
// NO UNICODE IN HANDLES, deliberately. Homoglyph impersonation - claiming a
// name that renders identically to someone else's with a Cyrillic character
// swapped in - is a real attack on a leaderboard and no denylist can catch it.
// Refusing the alphabet can.
//
// THE AVAILABILITY CHECK IS ADVISORY. Two people can pass validation on the
// same name in the same second; the unique index on lower(handle) is the
// truth, and the claim path is written to expect a 23505 rather than to trust
// a lookup it did a moment earlier.

import crypto from 'node:crypto';

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 15;
export const RENAME_COOLDOWN_DAYS = 30;
/** A handle freed by a rename is blocked this long, so moderation sticks. */
export const RECLAIM_BLOCK_DAYS = 30;

/** Impersonating the house is the one identity attack worth blocking up front. */
export const RESERVED = new Set([
  'admin', 'administrator', 'mod', 'moderator', 'staff', 'support', 'help',
  'api', 'root', 'system', 'official', 'sportsvyn', 'draftvyn', 'daily',
  'thedaily', 'deleted', 'null', 'undefined', 'anonymous', 'player', 'me', 'you',
]);

// A LIST, NOT A CLEVERNESS. Automated matching produces the Scunthorpe problem
// and still misses anything with a deliberate misspelling. This catches the
// lazy cases; adminForceRename() is the other half, and the half that matters.
export const DENYLIST = [
  'fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'rape', 'nazi', 'hitler',
  'retard', 'kike', 'spic', 'chink', 'tranny', 'whore', 'slut', 'bitch', 'porn',
];

export const canonical = (h) => String(h ?? '').trim().toLowerCase();

/**
 * @returns {{ ok: true, handle: string, canonical: string }
 *          | { ok: false, reason: string, message: string }}
 */
export function validateHandle(raw) {
  const handle = String(raw ?? '').trim();
  const lower = handle.toLowerCase();

  if (!handle) return { ok: false, reason: 'empty', message: 'Pick a handle.' };
  if (handle.length < HANDLE_MIN) {
    return { ok: false, reason: 'short', message: `Too short - ${HANDLE_MIN} characters minimum.` };
  }
  if (handle.length > HANDLE_MAX) {
    return { ok: false, reason: 'long', message: `Too long - ${HANDLE_MAX} characters maximum.` };
  }
  if (!/^[A-Za-z0-9_]+$/.test(handle)) {
    return { ok: false, reason: 'charset', message: 'Letters, numbers and underscore only.' };
  }
  if (!/^[A-Za-z0-9]/.test(handle) || !/[A-Za-z0-9]$/.test(handle)) {
    return { ok: false, reason: 'edge', message: 'Start and end with a letter or number.' };
  }
  if (handle.includes('__')) {
    return { ok: false, reason: 'double', message: 'One underscore at a time.' };
  }
  if (RESERVED.has(lower)) return { ok: false, reason: 'reserved', message: 'Reserved.' };
  // Substring, not word-boundary: the point is to catch the lazy case, and a
  // false positive here costs somebody one retype.
  if (DENYLIST.some((w) => lower.includes(w))) {
    return { ok: false, reason: 'denied', message: 'Pick another one.' };
  }
  // A handle that is only "player" plus hex would collide with the anonymous
  // namespace and let someone impersonate an unclaimed account.
  if (/^player[0-9a-f]{0,8}$/.test(lower)) {
    return { ok: false, reason: 'reserved', message: 'Reserved.' };
  }
  return { ok: true, handle, canonical: lower };
}

/**
 * The stable pseudonym for an unclaimed account.
 *
 * KEYED, not a bare hash: an unkeyed hash of a small integer is trivially
 * reversed by trying every id, which would put the sequential number straight
 * back on the board. Falls back to a fixed key only so a missing secret cannot
 * take the leaderboard down - it degrades to "reversible", not to "crashes".
 */
export function anonName(userId, secret = process.env.PUZZLE_SEED ?? 'sportsvyn-anon') {
  const hex = crypto.createHmac('sha256', String(secret))
    .update(`anon:${userId}`).digest('hex').slice(0, 4);
  return `Player ${hex}`;
}

/** What the leaderboard prints for a row. */
export const displayName = (user, secret) => (user?.handle
  ? `@${user.handle}`
  : anonName(user?.id ?? user?.user_id, secret));

export const isClaimed = (user) => Boolean(user?.handle);

/**
 * Can this account rename right now?
 *
 * A leaderboard is a record of who did what. Free renames make last week's
 * board unreadable and let someone swap into a name a rival just abandoned.
 */
export function renameAvailableAt(handleChangedAt, days = RENAME_COOLDOWN_DAYS) {
  if (!handleChangedAt) return null;                       // never renamed: free
  const t = new Date(handleChangedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + days * 86_400_000);
}

export function canRename(handleChangedAt, now = new Date(), days = RENAME_COOLDOWN_DAYS) {
  const at = renameAvailableAt(handleChangedAt, days);
  return at == null || now.getTime() >= at.getTime();
}
