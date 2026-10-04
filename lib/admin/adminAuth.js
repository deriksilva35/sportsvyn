// lib/admin/adminAuth.js - THE ONE ADMIN CREDENTIAL CHECK.
//
// proxy.js and lib/admin/requireAdmin.js both ask the same question - does this
// Authorization header carry ADMIN_USERNAME:ADMIN_SECRET as HTTP Basic? - and
// they must never answer it differently, so the answer lives here and both call
// it. Pure: no next/*, no request object, so the proxy (Node runtime) and a unit
// test can both load it.
//
// WHY THE ACTIONS ASK AGAIN (sun-12 item 1). The proxy gates every request whose
// PATH is /admin/* or /api/admin/*. A Server Action is not addressed by path: it
// is addressed by the Next-Action id header, and Next 16 will run that action for
// a POST to ANY page, forwarding it internally to the worker that owns the id
// (selectWorkerForForwarding in next/dist/server/app-render/manifests-singleton.js).
// POST /games with an admin action's id never matches the admin matcher. The
// only gate that cannot be routed around is the one inside the action.
//
// Fail closed: an unset ADMIN_USERNAME or ADMIN_SECRET is 'unconfigured', never
// a pass. Constant-time: both fields are always compared, via sha256 digests so
// the buffers are equal length (timingSafeEqual throws otherwise) and the input
// length is not observable.

import { createHash, timingSafeEqual } from 'node:crypto';

export function safeEqual(a, b) {
  const ah = createHash('sha256').update(String(a)).digest();
  const bh = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ah, bh);
}

/**
 * @param header  the raw Authorization header value (or null)
 * @param env     { ADMIN_USERNAME, ADMIN_SECRET } - pass process.env
 * @returns 'ok' | 'unconfigured' | 'refused'
 */
export function checkAdminBasic(header, env) {
  const expectedUser = env?.ADMIN_USERNAME;
  const expectedSecret = env?.ADMIN_SECRET;
  if (!expectedUser || !expectedSecret) return 'unconfigured';

  if (typeof header !== 'string' || !header.startsWith('Basic ')) return 'refused';

  let user, pass;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const sep = decoded.indexOf(':');
    if (sep === -1) return 'refused';
    user = decoded.slice(0, sep);
    pass = decoded.slice(sep + 1);
  } catch {
    return 'refused';
  }

  // Both compares run regardless of the first result: no early exit on user.
  const userOk = safeEqual(user, expectedUser);
  const passOk = safeEqual(pass, expectedSecret);
  return userOk && passOk ? 'ok' : 'refused';
}

export class AdminAuthError extends Error {
  constructor(reason) {
    super(reason === 'unconfigured' ? 'Admin auth is not configured' : 'Admin authentication required');
    this.name = 'AdminAuthError';
    this.reason = reason;
  }
}

/** Throws AdminAuthError unless the header carries the admin credential. */
export function assertAdminAuthorization(header, env) {
  const r = checkAdminBasic(header, env);
  if (r !== 'ok') throw new AdminAuthError(r);
}
