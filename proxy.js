/**
 * proxy.js: Sportsvyn proxy. Three responsibilities live here, in order:
 *
 *   0. SHELL MODE, SET ONCE.
 *      ?shell=sim-app arrives on the container's first hit and is
 *      turned into the sv_shell cookie here. Before this, shell mode
 *      was answered in two places - the param, which every page had
 *      to remember to thread through resolveShellMode, and the
 *      cookie, which two CLIENT effects wrote after their page had
 *      already rendered once. 41 call sites had to get it right and
 *      app/page.js passed null on purpose, so the homepage rendered
 *      web chrome inside the container. The param is now WRITE-ONLY:
 *      signinHref, SHELL_SIGNOUT_TARGET and lib/auth/firstSeen still
 *      emit it to carry mode across an auth redirect, and this file
 *      is its only reader. The container also marks its own User-Agent
 *      (capacitor.config.ts appends SHELL_UA_TOKEN), which is the only
 *      signal /app has - it loads with no query string and is also a
 *      real web page - and that is read here too.
 *
 *   2. Competition-namespacing REDIRECTS.
 *      Old canonical paths (/bracket, /power-rankings) issue 308
 *      (Permanent Redirect) to their dated namespaced canonicals. The
 *      evergreen alias family (/world-cup/<sub>) issues 307 (Temporary
 *      Redirect) to the current edition resolved from
 *      leagues.metadata.family + is_current_edition, because the
 *      target moves between editions (the 2030 cycle will repoint
 *      these aliases to /world-cup-2030/<sub>).
 *
 *   3. Admin auth gate (existing).
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
import { SHELL_COOKIE, SHELL_VALUE, SHELL_PARAM, SHELL_UA_TOKEN } from '@/lib/shell/constants';
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
  // 0. SHELL MODE, RESOLVED ONCE, BEFORE ANYTHING ELSE READS IT.
  //
  //    The param counts as shell mode HERE even though the cookie does not
  //    exist yet, and that is deliberate: the container's very first hit
  //    carries the param and nothing else, and the 3.1.1 block below has to
  //    treat that request as being in the shell. Resolving it before the
  //    block - rather than only writing a cookie for the NEXT request - is
  //    what makes /membership?shell=sim-app safe on a cold open.
  //
  //    Every response this function can return gets the cookie attached at the
  //    bottom, redirects included, so a first hit that is also a redirect
  //    still lands in shell mode.
  // -------------------------------------------------------------------------
  const cookieSaysShell = request.cookies.get(SHELL_COOKIE)?.value === SHELL_VALUE;
  const paramSaysShell = request.nextUrl.searchParams.get(SHELL_PARAM) === SHELL_VALUE;
  // THE CONTAINER'S OWN MARK. capacitor.config.ts appends SHELL_UA_TOKEN to
  // the webview's User-Agent, which is the only thing in a request from /app
  // that identifies it: the binary loads /app with no query string, and /app is
  // also a real web page, so nothing else in the request can tell them apart.
  //
  // WITHOUT THIS, /app's cold open could not be closed by a proxy at all - only
  // by NativeShellCookie's client-side detect-and-reload, which by definition
  // runs after the render it was needed for. With it, sv_shell is set before
  // anything renders, on /app and on every sportsvyn.com page the container can
  // reach through allowNavigation.
  //
  // INERT UNTIL A BINARY CARRYING THE TOKEN SHIPS. An installed copy built
  // before it sends a plain webview UA, matches nothing here, and keeps the
  // client-side path - which still works. Nothing regresses while both exist.
  const uaSaysShell = (request.headers.get('user-agent') ?? '').includes(SHELL_UA_TOKEN);
  const inShell = cookieSaysShell || paramSaysShell || uaSaysShell;
  const needsCookie = (paramSaysShell || uaSaysShell) && !cookieSaysShell;

  // A SESSION COOKIE - no max-age, no expires. Both client setters chose that
  // deliberately and moving the write here must not quietly upgrade it: a web
  // reader who opens a ?shell=sim-app link should not be stuck chromeless
  // after closing the tab, while the native webview's session is long-lived,
  // which is exactly where we want it to persist.
  const withCookie = (res) => {
    if (needsCookie) {
      res.cookies.set({
        name: SHELL_COOKIE, value: SHELL_VALUE, path: '/', sameSite: 'lax',
      });
    }
    return res;
  };

  // -------------------------------------------------------------------------
  // 1. APP STORE 3.1.1 — the pricing page must not exist inside the native app.
  //
  //    This lives in the proxy rather than in the route so the route is NEVER
  //    INVOKED. A redirect() inside app/membership/page.js works, but Next still
  //    renders that page's metadata onto the redirect response - the shell was
  //    getting a 307 whose <title> and <meta description> carried "Draft Pass,
  //    Football Suite, or Founding". Blocking here returns a bare 307 with no
  //    document at all. The route keeps its own redirect() as a second line of
  //    defence in case the matcher is ever narrowed.
  //
  //    capacitor.config.ts allows navigation across sportsvyn.com, so a reviewer
  //    can type this URL directly; suppressing the links to it is not enough.
  // -------------------------------------------------------------------------
  if (pathname === '/membership' || pathname.startsWith('/membership/')) {
    if (inShell) {
      const dest = request.nextUrl.clone();
      dest.pathname = '/sim';
      dest.search = '';
      return withCookie(NextResponse.redirect(dest, 307));
    }
    return withCookie(NextResponse.next());
  }

  // -------------------------------------------------------------------------
  // 2. Old canonical (permanent redirect, 308).
  // -------------------------------------------------------------------------
  if (Object.prototype.hasOwnProperty.call(PERMANENT_REDIRECTS, pathname)) {
    const dest = request.nextUrl.clone();
    dest.pathname = PERMANENT_REDIRECTS[pathname];
    return withCookie(NextResponse.redirect(dest, 308));
  }

  // -------------------------------------------------------------------------
  // 3. Evergreen alias (temporary redirect, 307). /world-cup/<sub> forwards
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
      return withCookie(NextResponse.redirect(dest, 307));
    }
    return withCookie(NextResponse.next());
  }

  // Bare /world-cup (no subpath). Phase 3 does not define a redirect for
  // this; Phase 4 may add a thin overview page or alias it. Until then,
  // pass through and let Next render the natural 404.
  if (pathname === '/world-cup') {
    return withCookie(NextResponse.next());
  }

  // -------------------------------------------------------------------------
  // 4. Admin auth gate (unchanged from prior shape).
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

  return withCookie(NextResponse.next());
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
    // App Store 3.1.1: the shell block above needs this route to reach the proxy.
    '/membership',
    '/membership/:path*',
    // SHELL MODE, SET ONCE - and NEAR-INERT BY CONSTRUCTION. `has` alone would
    // run the proxy on every request of a container session; `missing` alone
    // would run it on every request from every web reader. Both together mean
    // it runs on the FIRST hit that carries the param and never again.
    //
    // THE LITERALS CANNOT BE INTERPOLATED. Next statically analyses this object
    // at build time, so an interpolated SHELL_PARAM is ignored - leaving a
    // matcher that matches nothing and a cookie that is never set, silently.
    // proxyConfig.test.mjs pins these three strings to their constants.
    {
      source: '/:path*',
      has: [{ type: 'query', key: 'shell', value: 'sim-app' }],
      missing: [{ type: 'cookie', key: 'sv_shell', value: 'sim-app' }],
    },
    // THE SAME RULE FOR THE CONTAINER'S OWN MARK. /app arrives with no param,
    // so the param clause above would never fire for the shipped binary; this
    // one matches on the User-Agent token instead, with the same `missing`
    // cookie condition, so it is equally inert after the first hit.
    {
      source: '/:path*',
      has: [{ type: 'header', key: 'user-agent', value: '(.*)SportsvynApp/1(.*)' }],
      missing: [{ type: 'cookie', key: 'sv_shell', value: 'sim-app' }],
    },
  ],
};
