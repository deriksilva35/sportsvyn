// lib/daily/handles.js - player handles. PURE.
//
// THE ANONYMOUS NAME IS NOT "Player #37", AND AS OF RELAY 2b-fix IT IS NOT
// "Player e740" EITHER. A sequential id on a public leaderboard publishes
// the user count and the signup order, and it is enumerable; four hex
// characters of an HMAC over the id leaked neither and stayed stable, so a
// rival was recognisable week to week - but it still reads as an ID to a
// person looking at it, which is what the ruling now forbids ("no hex ids
// on any surface"). An unclaimed account is simply Anonymous.
//
// WHAT THIS COSTS, STATED: two unclaimed accounts on the same board now
// render identically, and an unclaimed rival is no longer recognisable
// across weeks. That is the deliberate trade - the fix for it is claiming
// a handle, which is the behaviour this nudges toward, not a second
// pseudonym scheme.
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
 * The label for an unclaimed account: ANONYMOUS, and nothing else.
 *
 * Takes and ignores (userId, secret) so every existing call site keeps
 * working unchanged - the arguments are what the old HMAC needed, and
 * removing them from ~a dozen callers to prove a point they no longer
 * make is churn, not a fix. Deriving NOTHING from the id is the whole
 * ruling: there is no suffix to reverse, enumerate, or read as an id.
 */
export function anonName() {
  return 'Anonymous';
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
