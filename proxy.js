/**
 * proxy.js: Sportsvyn proxy. Two responsibilities live here, in order:
 *
 *   1. Competition-namespacing REDIRECTS.
 *      Old canonical paths (/bracket, /power-rankings) issue 308
 *      (Permanent Redirect) to their dated namespaced canonicals. The
 *      evergreen alias family (/world-cup/<sub>) issues 307 (Temporary
 *      Redirect) to the current edition resolved from
 *      leagues.metadata.family + is_current_edition, because the
 *      target moves between editions (the 2030 cycle will repoint
 *      these aliases to /world-cup-2030/<sub>).
 *
 *   2. Admin auth gate (existing).
 *      Basic Auth on /admin/* and /api/admin/*, constant-time
 *      comparison, fail-closed when ADMIN_USERNAME or ADMIN_SECRET
 *      are missing.
 *
 * Single export, single function: Next 16 forbids multiple proxy
 * functions in a project. The redirect block early-returns for the
 * structural paths it handles; everything else falls through to the
 * admin-auth code unchanged.
 *
 * Runtime is Node (cannot be configured to Edge), so node:crypto +
 * the Neon HTTP driver work natively. The DB call required by the
 * evergreen alias resolution adds one HTTPS round trip per alias hit
 * (cached per request by React.cache inside the resolver, though
 * only one call per request is ever made for that family).
 *
 * Matcher discipline (see config.matcher below):
 *   - Catches ONLY the paths this proxy actually handles. Anything
 *     not on the list never invokes the function and is unaffected.
 *   - Does NOT catch shared-library routes (/schedule, /match/*,
 *     /team/*, /player/*, /article/*), global routes (/, /my,
 *     /signin*, /confirmed), the new namespaced routes
 *     (/world-cup-2026/*), static assets, or non-admin API endpoints.
 */

import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolveCurrentEditionForFamily } from './lib/competition.js';

const REALM = 'Sportsvyn Admin';
const EVERGREEN_FAMILY = 'world-cup';

// Old canonical to new canonical. Permanent (308): these moves are not
// going to revert; the migration is committed.
const PERMANENT_REDIRECTS = {
  '/bracket':        '/world-cup-2026/bracket',
  '/power-rankings': '/world-cup-2026/rankings/power',
};

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

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // -------------------------------------------------------------------------
  // 1. Old canonical (permanent redirect, 308).
  // -------------------------------------------------------------------------
  if (Object.prototype.hasOwnProperty.call(PERMANENT_REDIRECTS, pathname)) {
    const dest = request.nextUrl.clone();
    dest.pathname = PERMANENT_REDIRECTS[pathname];
    return NextResponse.redirect(dest, 308);
  }

  // -------------------------------------------------------------------------
  // 2. Evergreen alias (temporary redirect, 307). /world-cup/<sub> forwards
  //    to /<currentEdition.urlSlug>/<sub>. If no current edition exists
  //    (data-config gap) we fall through and let Next render the natural
  //    404 rather than synthesizing one here.
  // -------------------------------------------------------------------------
  if (pathname.startsWith('/world-cup/')) {
    const sub = pathname.slice('/world-cup'.length);
    const comp = await resolveCurrentEditionForFamily(EVERGREEN_FAMILY);
    if (comp?.urlSlug) {
      const dest = request.nextUrl.clone();
      dest.pathname = `/${comp.urlSlug}${sub}`;
      return NextResponse.redirect(dest, 307);
    }
    return NextResponse.next();
  }

  // Bare /world-cup (no subpath). Phase 3 does not define a redirect for
  // this; Phase 4 may add a thin overview page or alias it. Until then,
  // pass through and let Next render the natural 404.
  if (pathname === '/world-cup') {
    return NextResponse.next();
  }

  // -------------------------------------------------------------------------
  // 3. Admin auth gate (unchanged from prior shape).
  //    Anything not handled above falls into this block, which the matcher
  //    restricts to /admin/* and /api/admin/* via config.matcher below.
  // -------------------------------------------------------------------------
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedSecret = process.env.ADMIN_SECRET;

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

  const userOk = safeEqual(user, expectedUser);
  const passOk = safeEqual(pass, expectedSecret);
  if (!userOk || !passOk) {
    return challenge();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Admin auth scope (unchanged).
    '/admin',
    '/admin/:path*',
    '/api/admin',
    '/api/admin/:path*',
    // Competition-namespacing redirect scope (Phase 3 additions).
    '/bracket',
    '/power-rankings',
    '/world-cup',
    '/world-cup/:path*',
  ],
};
