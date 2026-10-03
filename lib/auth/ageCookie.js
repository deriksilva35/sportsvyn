// lib/auth/ageCookie.js - the value of the per-session "passed the age screen"
// marker (AGE_OK_COOKIE). Node-only (node:crypto); the proxy runs on Node.
//
// BOUND TO THE SESSION TOKEN, NOT TO A USER ID. The proxy cannot see a user id
// - the database session cookie is an opaque token - and it must not query the
// database on every request. A marker that is a hash of the token means a new
// sign-in (a new token: another account on a shared browser, or the same
// account after signing out) does not inherit an old pass; it bounces once
// through /age/check, which looks at the account's own row.
//
// IT IS A ROUTER, NOT THE GATE. Forging it skips a redirect and nothing else:
// every write door reads the stored birth date itself (lib/auth/ageGateDb.js).

import { createHash } from 'node:crypto';

export function ageCookieValue(sessionToken) {
  if (!sessionToken) return null;
  return createHash('sha256').update(`sv-age:${sessionToken}`).digest('hex').slice(0, 32);
}

/** 400 days - the longest a browser keeps a cookie (Chrome caps there). */
export const AGE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
