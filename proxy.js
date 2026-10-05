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
 *   2. RETIRED ROUTES (tue-14). Editorial and soccer answer one 301 to a
 *      page that is drawn (lib/retired.js). This replaced the World Cup's
 *      old-canonical 308s and the /world-cup/<sub> evergreen 307.
 *
 *   3. THE AGE SCREEN. A signed-in page navigation whose session has not
 *      passed /age is sent to /age/check first (lib/auth/ageGate.js).
 *
 *   4. Admin auth gate (existing).
 *      Basic Auth on /admin/* and /api/admin/*, constant-time
 *      comparison, fail-closed when ADMIN_USERNAME or ADMIN_SECRET
 *      are missing.
 *
 * Single export, single function: Next 16 forbids multiple proxy
 * functions in a project. The redirect block early-returns for the
 * structural paths it handles; everything else falls through to the
 * admin-auth code unchanged.
 *
 * Runtime is Node (cannot be configured to Edge), so node:crypto works
 * natively. No DB call is made here since tue-14 retired the evergreen
 * World Cup alias, which was the only one.
 *
 * Matcher discipline (see config.matcher below):
 *   - Catches ONLY the paths this proxy actually handles. Anything
 *     not on the list never invokes the function and is unaffected.
 *   - Does NOT catch shared-library routes (/match/*, /team/*,
 *     /player/* - their soccer rows redirect in the page, by league),
 *     global routes (/, /signin*, /confirmed), static assets, or
 *     non-admin API endpoints.
 */

import { NextResponse } from 'next/server';
import { SHELL_COOKIE, SHELL_VALUE, SHELL_PARAM, SHELL_UA_TOKEN } from '@/lib/shell/constants';
import { checkAdminBasic } from './lib/admin/adminAuth.js';
import { scoreboardRedirect } from './lib/scores/leagueScoreboards.js';
import { retiredRedirect } from './lib/retired.js';
import { youRedirect } from './lib/you/legacyRedirect.js';
import { ageRedirectTarget, sessionTokenFrom, AGE_OK_COOKIE } from './lib/auth/ageGate.js';
import { ageCookieValue } from './lib/auth/ageCookie.js';

const REALM = 'Sportsvyn Admin';

function challenge() {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` },
  });
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
  // 0b. THE NATIVE START URL LANDS ON GAMES (G-FIX, droplet-mon-7).
  //
  //    The shipping binary starts at /sim?shell=sim-app (its config lives on
  //    the Mac, not in this repo). /sim then painted the mock-draft page before
  //    ResumeManager's client push to /games - the "sim flash" on every cold
  //    launch. Answering the start URL here with a bare 307 means the first
  //    document the webview paints is Games. The cookie is written exactly as
  //    before (withCookie), and the query is dropped so the shell param does
  //    not ride into /games. Only this exact entry: /sim without the param,
  //    with or without the cookie, is untouched, and ResumeManager is too.
  // -------------------------------------------------------------------------
  if (pathname === '/sim' && paramSaysShell) {
    const dest = request.nextUrl.clone();
    dest.pathname = '/games';
    dest.search = '';
    return withCookie(NextResponse.redirect(dest, 307));
  }

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
  // 2. RETIRED: editorial and soccer (tue-14). One permanent 301 to a page that
  //    is drawn - /games, a league landing or /scores - per lib/retired.js.
  //    This replaced the World Cup's old-canonical 308s (/bracket,
  //    /power-rankings) and the /world-cup/* evergreen 307, which were chains
  //    to pages nobody reads. The query is dropped; it addressed retired content.
  // -------------------------------------------------------------------------
  const retired = retiredRedirect(pathname);
  if (retired) {
    return withCookie(NextResponse.redirect(new URL(retired, request.url), 301));
  }

  // -------------------------------------------------------------------------
  // 2b. League scoreboards -> /scores?sport=<league> (permanent, 308; tue-12).
  //    The query rides along and sport= is set from the path. The two route
  //    files redirect too, as a second line if the matcher is ever narrowed.
  // -------------------------------------------------------------------------
  const scoreboard = scoreboardRedirect(pathname, request.nextUrl.search);
  if (scoreboard) {
    return withCookie(NextResponse.redirect(new URL(scoreboard, request.url), 308));
  }

  // -------------------------------------------------------------------------
  // 2c. /my AND /account ARE /you (sun-16 D). Permanent 308, query kept, every
  //    subpath caught (lib/you/legacyRedirect.js). Before the age clause, so an
  //    old link costs one hop, not two: /you then meets the age screen itself.
  //    /sim/account (draft settings, account deletion) is untouched.
  // -------------------------------------------------------------------------
  const you = youRedirect(pathname, request.nextUrl.search);
  if (you) {
    return withCookie(NextResponse.redirect(new URL(you, request.url), 308));
  }

  // -------------------------------------------------------------------------
  // 3. THE AGE SCREEN COMES FIRST (age-gate, fri-5).
  //
  //    A SIGNED-IN page navigation whose session has not passed the age screen
  //    goes to /age/check, which reads the account once and either sets the
  //    per-session marker and sends it straight back, or shows /age. This is
  //    how a new sign-up meets the screen right after auth (both the code form
  //    and Apple land on a callbackUrl, and that request comes through here)
  //    and how an existing account meets it once, on its next visit.
  //
  //    NO DATABASE HERE. The marker is a hash of this session's token
  //    (lib/auth/ageCookie.js), so the decision is a cookie compare. It is a
  //    router, not the gate: every write door checks the stored birth date
  //    itself (lib/auth/ageGateDb.js).
  //
  //    SIGNED-OUT READERS NEVER GET HERE: the matcher entries below run this
  //    function only when a session cookie is present, and ageRedirectTarget
  //    returns null without one. GET/HEAD only - a server action is a POST to
  //    a page path and must reach its own gate, not a redirect. Admin, /api,
  //    /signin, /age, the legal pages and account deletion are exempt
  //    (isAgeExempt), so this clause cannot widen the admin gate below.
  // -------------------------------------------------------------------------
  const sessionToken = sessionTokenFrom((n) => request.cookies.get(n)?.value);
  if (sessionToken) {
    const ageDest = ageRedirectTarget({
      method: request.method,
      pathname,
      search: request.nextUrl.search,
      sessionToken,
      ageCookie: request.cookies.get(AGE_OK_COOKIE)?.value ?? null,
      expected: ageCookieValue(sessionToken),
    });
    if (ageDest) return withCookie(NextResponse.redirect(new URL(ageDest, request.url), 307));
  }

  // -------------------------------------------------------------------------
  // 4. Admin auth gate.
  //
  //    IT USED TO SAY "anything not handled above falls into this block, which
  //    the matcher restricts to /admin/* and /api/admin/*". THAT SENTENCE STOPS
  //    BEING TRUE THE MOMENT ANY CLAUSE WIDENS THE MATCHER, and the shell
  //    clauses below widen it to '/:path*'. Falling through was safe only while
  //    every matched path was an admin path.
  //
  //    Measured, not reasoned about: with the shell clause added and this guard
  //    absent, GET /nfl?shell=sim-app returned 401 with a Basic realm challenge.
  //    Every page on the site, for anyone carrying the param - and after Phase
  //    B, for every request from inside the container.
  //
  //    So the gate now names its own scope instead of inheriting it from the
  //    matcher. A future clause can widen the matcher again without turning the
  //    whole site into an admin route.
  // -------------------------------------------------------------------------
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/')
    || pathname === '/api/admin' || pathname.startsWith('/api/admin/');
  if (!isAdminPath) {
    return withCookie(NextResponse.next());
  }

  // The credential check itself lives in lib/admin/adminAuth.js (constant-time,
  // fail-closed) so the admin Server Actions can run the identical check through
  // lib/admin/requireAdmin.js - an action can be POSTed to a non-admin path, where
  // this gate never runs.
  const verdict = checkAdminBasic(request.headers.get('authorization'), {
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_SECRET: process.env.ADMIN_SECRET,
  });
  if (verdict === 'unconfigured') {
    return new NextResponse('Admin auth is not configured.', { status: 500 });
  }
  if (verdict !== 'ok') {
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
    // RETIRED editorial and soccer (tue-14; EPL back thu-24): literals, because Next reads this
    // object statically. retired.test.mjs pins them to RETIRED_ROUTES.
    '/today', '/today/:path*',
    '/articles', '/articles/:path*',
    '/article', '/article/:path*',
    '/nfl/wire', '/nfl/wire/:path*',
    '/cfb/wire', '/cfb/wire/:path*',
    '/schedule', '/schedule/:path*',
    '/stats', '/stats/:path*',
    '/world-cup', '/world-cup/:path*',
    '/world-cup-2026', '/world-cup-2026/:path*',
    '/bracket', '/bracket/:path*',
    '/power-rankings', '/power-rankings/:path*',
    // League scoreboards retired to /scores?sport= (tue-12). Literals: Next
    // reads this object statically. leagueScoreboards.test.mjs pins them to
    // LEAGUE_SCOREBOARDS.
    '/nfl/scores',
    '/cfb/scores',
    // /my and /account are /you (sun-16 D): literals, pinned to
    // LEGACY_YOU_ROOTS by lib/you/legacyRedirect.test.mjs.
    '/my', '/my/:path*',
    '/account', '/account/:path*',
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
    // THE NATIVE START URL (0b above), WITH OR WITHOUT THE COOKIE. The
    // param-without-cookie rule above stops matching after the first launch,
    // and the binary sends /sim?shell=sim-app on EVERY cold start; this entry
    // is what keeps launch two onward on Games. Exact path, query required:
    // a plain /sim never reaches the proxy through it.
    {
      source: '/sim',
      has: [{ type: 'query', key: 'shell', value: 'sim-app' }],
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
    // THE AGE SCREEN (3 above): SIGNED-IN REQUESTS ONLY. One entry per name
    // Auth.js gives its database-session cookie (https / http). A reader with
    // no session cookie never invokes the proxy through these, so signed-out
    // browsing costs nothing. Static assets and /api are excluded here; the
    // function's own isAgeExempt is the authoritative list.
    {
      source: '/((?!_next/|api/|favicon.ico).*)',
      has: [{ type: 'cookie', key: '__Secure-authjs.session-token' }],
    },
    {
      source: '/((?!_next/|api/|favicon.ico).*)',
      has: [{ type: 'cookie', key: 'authjs.session-token' }],
    },
  ],
};
