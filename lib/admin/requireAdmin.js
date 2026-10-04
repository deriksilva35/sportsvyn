// lib/admin/requireAdmin.js - EVERY ADMIN SERVER ACTION AND ROUTE CALLS THIS FIRST.
//
//     await requireAdmin();     // first await in the function, before any read
//
// It reads the request's own Authorization header and checks the same Basic
// credential proxy.js checks, through the same function (lib/admin/adminAuth.js).
// Throws AdminAuthError on refusal; a route handler catches it and answers 401.
// lib/admin/adminActionsCensus.test.mjs walks app/ and fails any admin action or
// handler that does not call it before its first other await.
//
// WHY BASIC AND NOT A COOKIE. A Server Action is a fetch() POST to the page's own
// URL (state.canonicalUrl in Next's server-action-reducer), same-origin, with the
// default credentials mode - which includes the browser's cached HTTP auth for
// that protection space. A no-JS form submit is a plain navigation POST to the
// same URL and carries it too. That is not inferred: the proxy already DEMANDS
// Basic on every POST to /admin/*, so every admin action that has ever worked
// arrived with the header. What does NOT carry it is the bypass this closes - an
// action id POSTed to a non-admin path - and that is exactly the request that
// must be refused. A signed cookie would add a second secret and a second
// verifier for no request that Basic does not already cover.
//
// The account gate (lib/admin/gate.js, /admin/console) is a separate lock; this
// one is the network lock the proxy holds, re-held inside the action.

import { headers } from 'next/headers';
import { assertAdminAuthorization } from './adminAuth.js';

export { AdminAuthError } from './adminAuth.js';

export async function requireAdmin() {
  const h = await headers();
  assertAdminAuthorization(h.get('authorization'), process.env);
}
