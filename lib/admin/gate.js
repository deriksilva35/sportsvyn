// lib/admin/gate.js - who may see the admin console.
//
// TWO INDEPENDENT LOCKS, and it matters that they are independent:
//
//   1. proxy.js Basic Auth already covers `/admin/:path*` (ADMIN_USERNAME +
//      ADMIN_SECRET, constant-time compare). Anything placed under /admin
//      inherits it. That lock is about the NETWORK: a stranger never reaches
//      the handler.
//   2. This gate is about the ACCOUNT: even past Basic Auth, the page renders
//      only for the one signed-in user id below. If the shared secret ever
//      leaks, or a future matcher edit drops the /admin prefix, the console
//      still shows nothing.
//
// Neither lock is redundant with the other, because they fail differently.
//
// WHY A HARDCODED ID AND NOT AN ENV VAR. An env var is a lock whose key is
// editable from a dashboard, and the failure mode of a typo'd or unset
// ADMIN_USER_ID is "gate opens" or "gate silently moves". A literal cannot be
// misconfigured at runtime; widening it requires a commit and a review. When
// there is a second admin, this becomes a table with a migration behind it -
// not a comma in an env string.
export const ADMIN_USER_IDS = Object.freeze([1]); // 1 = @sportsvyn_og

/**
 * `session.user.id` arrives as a string from the adapter, so compare numbers.
 * Signed-out (null/undefined) must be false, and `Number(null) === 0` would
 * quietly pass an `includes` check against an id of 0 - so reject non-finite
 * and non-integer values explicitly rather than coercing and hoping.
 */
export function isAdminUser(userId) {
  // Only a number or a string may be an id. Everything else is rejected BEFORE
  // coercion, because Number() is far too generous: Number([1]) is 1, so a
  // single-element array would otherwise walk straight through the gate.
  const t = typeof userId;
  if (t !== 'number' && t !== 'string') return false;
  if (t === 'string' && userId.trim() === '') return false;
  const n = Number(userId);
  return Number.isInteger(n) && ADMIN_USER_IDS.includes(n);
}
