/**
 * proxy.js — Sportsvyn admin authentication gate.
 *
 * Next 16 renamed the `middleware` file convention to `proxy`. This is
 * the project's single Proxy, at the root beside app/. The proxy
 * convention runs on the Node.js runtime by default in Next 16 and
 * cannot be configured to Edge, so `node:crypto` and `Buffer` are
 * available natively.
 *
 * Gates /admin/* and /api/admin/* with HTTP Basic Auth, checking
 * credentials against ADMIN_USERNAME and ADMIN_SECRET from the
 * environment. Comparison is constant-time (SHA-256 digest +
 * timingSafeEqual) so a wrong guess leaks no timing signal.
 *
 * Fail-closed: if either env var is missing, returns 500 instead of
 * issuing a challenge. A misconfigured gate is a broken gate.
 *
 * TODO: Per Next proxy docs, re-verify ADMIN_SECRET in admin route
 * handlers / Server Actions as defense-in-depth. The matcher below
 * can drop coverage on refactor.
 */

import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';

const REALM = 'Sportsvyn Admin';

function challenge() {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` },
  });
}

// Constant-time compare. Hashing first guarantees equal-length buffers
// (timingSafeEqual throws on length mismatch) and hides input length.
function safeEqual(a, b) {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}

export function proxy(request) {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedSecret = process.env.ADMIN_SECRET;

  // Fail closed if the gate itself is misconfigured.
  if (!expectedUser || !expectedSecret) {
    return new NextResponse('Admin auth is not configured.', { status: 500 });
  }

  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Basic ')) {
    return challenge();
  }

  let user, pass;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const sep = decoded.indexOf(':');
    if (sep === -1) return challenge();
    user = decoded.slice(0, sep);
    pass = decoded.slice(sep + 1);
  } catch {
    return challenge();
  }

  // Evaluate both comparisons before deciding — no short-circuit.
  const userOk = safeEqual(user, expectedUser);
  const passOk = safeEqual(pass, expectedSecret);
  if (!userOk || !passOk) {
    return challenge();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/api/admin', '/api/admin/:path*'],
};
