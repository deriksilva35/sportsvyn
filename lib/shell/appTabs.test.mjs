// lib/shell/appTabs.test.mjs - the app container's bottom chrome, as data. PURE.
//
// THIS BAR IS THE ONLY NAVIGATION INSIDE THE APP. There is no URL bar to escape
// with, so an unreachable destination here strands the reader completely - a
// worse version of the bug that shipped The Daily with no nav entry, which is
// why lib/nav.test.mjs exists. Same guard, higher stakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { APP_TABS, activeTabFor, routeSuppressed, isShellClient } = await import('./appTabs.js');

test('the four tabs of the v0.2 mock, in its order', () => {
  assert.deepEqual(APP_TABS.map((t) => t.key), ['games', 'practice', 'tracker', 'profile']);
  assert.deepEqual(APP_TABS.map((t) => t.href), ['/games', '/sim', '/sim/tracker', '/account']);
});

test('every tab is well formed and every destination is a real route', () => {
  for (const t of APP_TABS) {
    assert.ok(t.key && t.label && t.href && t.icon, `malformed: ${JSON.stringify(t)}`);
    assert.ok(t.href.startsWith('/'), 'internal paths only');
  }
  assert.equal(new Set(APP_TABS.map((t) => t.key)).size, APP_TABS.length, 'keys unique');
  assert.equal(new Set(APP_TABS.map((t) => t.href)).size, APP_TABS.length, 'hrefs unique');
});

test('ORDER MATTERS: /sim/tracker must not light PRACTICE', () => {
  // The longest prefix wins. Testing /sim first would light PRACTICE on every
  // tracker screen, permanently.
  assert.equal(activeTabFor('/sim/tracker'), 'tracker');
  assert.equal(activeTabFor('/sim/tracker/anything'), 'tracker');
  assert.equal(activeTabFor('/sim'), 'practice');
  assert.equal(activeTabFor('/sim/history'), 'practice');
  assert.equal(activeTabFor('/sim/account'), 'practice');
});

test('EVERY GAME LIGHTS GAMES - the lobby is their front door', () => {
  // A bar that lit nothing while a reader was inside a game would tell them
  // they had left the app.
  for (const p of ['/games', '/games?pane=history', '/daily', '/daily/2026-08-16',
    '/weekly', '/draft']) {
    assert.equal(activeTabFor(p), 'games', `${p} must light GAMES`);
  }
});

test('/account lights PROFILE', () => {
  assert.equal(activeTabFor('/account'), 'profile');
});

test('surfaces outside the app light NOTHING rather than guessing', () => {
  // The homepage and the editorial pages are reachable in the container but are
  // not one of its four destinations. A wrong highlight is worse than none.
  for (const p of ['/', '/nfl', '/scores', '/membership', '/privacy', '']) {
    assert.equal(activeTabFor(p), null, `${p} must light nothing`);
  }
  assert.equal(activeTabFor(null), null);
  assert.equal(activeTabFor(undefined), null);
});

// ---------------------------------------------------------------------------
// THE CHROME-ISOLATION LAW
// ---------------------------------------------------------------------------

test('A DRAFT ROOM SUPPRESSES THE BAR - it is clock-owned for its whole life', () => {
  assert.equal(routeSuppressed('/sim/draft/123'), true);
  assert.equal(routeSuppressed('/sim/draft/abc'), true);
});

test('but the draft CARD and the rest of the sim keep it', () => {
  // The card is a share surface, not a room, and /sim itself is a lobby.
  assert.equal(routeSuppressed('/sim/draft/123/card'), false);
  assert.equal(routeSuppressed('/sim'), false);
  assert.equal(routeSuppressed('/sim/history'), false);
  assert.equal(routeSuppressed('/sim/tracker'), false);
});

test('THE DAILY IS NOT ROUTE-SUPPRESSED, and that is the point', () => {
  // /daily is one route with four states and only one has a clock. Suppressing
  // the route would strip the bar from the pitch and the receipt, which have
  // every reason to offer a way out. The live state raises a flag on the
  // document instead - see components/shell/ClockOwned.
  assert.equal(routeSuppressed('/daily'), false);
  assert.equal(routeSuppressed('/daily/2026-08-16'), false);
  assert.equal(routeSuppressed('/weekly'), false);
  assert.equal(routeSuppressed('/draft'), false);
});

test('routeSuppressed survives absent input', () => {
  assert.equal(routeSuppressed(null), false);
  assert.equal(routeSuppressed(''), false);
});

// ---------------------------------------------------------------------------
// THE SHELL GATE
// ---------------------------------------------------------------------------
// Extracted from the component so it can be checked without a browser. The bar
// renders client-side, so served markup cannot prove it either way - before
// this split the only verification available was "open the app and look",
// which is how chrome bugs reach production.

test('the container is recognised by its cookie', () => {
  assert.equal(isShellClient({ cookie: 'sv_shell=sim-app' }), true);
  assert.equal(isShellClient({ cookie: 'other=1; sv_shell=sim-app; more=2' }), true);
});

test('the first hit is recognised by its query param, before the cookie exists', () => {
  assert.equal(isShellClient({ cookie: '', search: '?shell=sim-app' }), true);
  assert.equal(isShellClient({ cookie: '', search: '?foo=1&shell=sim-app' }), true);
});

test('A PLAIN BROWSER IS NEVER IN THE SHELL - this is the compatibility promise', () => {
  for (const c of ['', 'session=abc', 'authjs.session-token=xyz', 'sv_shell=', 'theme=dark']) {
    assert.equal(isShellClient({ cookie: c, search: '' }), false, `cookie ${JSON.stringify(c)} must not open the bar`);
  }
  assert.equal(isShellClient({}), false);
  assert.equal(isShellClient(), false);
});

test('THE COOKIE IS MATCHED WHOLE, not by substring', () => {
  // includes() would let any of these turn the bar on for a web reader: a
  // differently-named cookie ending in the same characters, or a value that
  // merely contains the marker.
  for (const c of ['not_sv_shell=sim-app', 'sv_shell=sim-app-evil', 'x=sv_shell=sim-app']) {
    assert.equal(isShellClient({ cookie: c, search: '' }), false, `${c} must not pass`);
  }
});

test('a wrong or partial marker does not open the bar', () => {
  assert.equal(isShellClient({ cookie: 'sv_shell=web' }), false);
  assert.equal(isShellClient({ cookie: '', search: '?shell=sim' }), false);
  assert.equal(isShellClient({ cookie: '', search: '?shell=' }), false);
});
