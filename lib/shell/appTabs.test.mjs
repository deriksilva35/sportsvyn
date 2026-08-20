// lib/shell/appTabs.test.mjs - the app container's bottom chrome, as data. PURE.
//
// THIS BAR IS THE ONLY NAVIGATION INSIDE THE APP. There is no URL bar to escape
// with, so an unreachable destination here strands the reader completely - a
// worse version of the bug that shipped The Daily with no nav entry, which is
// why lib/nav.test.mjs exists. Same guard, higher stakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { APP_TABS, activeTabFor, routeSuppressed, isShellClient } = await import('./appTabs.js');

test('the four tabs of v0.3, in its order - PROFILE is the header chip now', () => {
  assert.deepEqual(APP_TABS.map((t) => t.key), ['games', 'practice', 'tracker', 'sportsvyn']);
  assert.deepEqual(APP_TABS.map((t) => t.href), ['/games', '/sim', '/sim/tracker', '/scores']);
});

test('the third seat reads MOCK - Practice was the label, not the product', () => {
  const t = APP_TABS.find((x) => x.key === 'practice');
  assert.equal(t.label, 'Mock', 'renamed v0.3.1; the key stays practice (threads RoomScope)');
  assert.equal(t.icon, '🎲', 'the dice stays');
});

test("the SPORTSVYN icon is the Y-monogram, not an emoji", () => {
  const t = APP_TABS.find((x) => x.key === 'sportsvyn');
  assert.equal(t.icon, 'Ȳ', 'Y with macron (U+0232), styled by apptab.css');
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

test('SPORTSVYN lights for /scores and every /nfl surface', () => {
  // Before v0.3 the bar went DARK on these routes - which read as having left
  // the app. The scoreboard and the /nfl surfaces are one destination the way
  // the four games are.
  for (const p of ['/scores', '/scores?date=2026-09-10', '/nfl', '/nfl/fantasy',
    '/nfl/game/some-slug', '/nfl/rankings']) {
    assert.equal(activeTabFor(p), 'sportsvyn', `${p} must light SPORTSVYN`);
  }
});

test('/account lights NOTHING - it is the header chip, not a tab', () => {
  assert.equal(activeTabFor('/account'), null);
  // A stale data-tab override naming the retired tab is ignored, not honoured.
  assert.equal(activeTabFor('/account', 'profile'), null);
});

test('surfaces outside the app light NOTHING rather than guessing', () => {
  // The homepage and the true editorial pages are reachable in the container
  // but are not app destinations. A wrong highlight is worse than none.
  for (const p of ['/', '/membership', '/privacy', '']) {
    assert.equal(activeTabFor(p), null, `${p} must light nothing`);
  }
  assert.equal(activeTabFor(null), null);
  assert.equal(activeTabFor(undefined), null);
});

// ---------------------------------------------------------------------------
// THE CHROME-ISOLATION LAW
// ---------------------------------------------------------------------------

test('NO ROUTE IS SUPPRESSED ANY MORE - a CLOCK owns the screen, not a path', () => {
  // This asserted that /sim/draft/[id] was suppressed wholesale. Ruled wrong,
  // twice over: a TRACKER room has no clock, runs for hours at a real table and
  // is exactly where somebody needs to leave and come back - and it shares this
  // route with the sim room, so no path test could tell them apart. An untimed
  // practice mock has nothing to protect either.
  //
  // The room declares it now (components/shell/RoomScope), so a tracked draft
  // is navigable and a 30-second ranked room is not.
  for (const p of ['/sim/draft/123', '/sim/draft/abc', '/sim/draft/123/card',
    '/sim', '/sim/history', '/sim/tracker', '/daily', '/weekly', '/draft']) {
    assert.equal(routeSuppressed(p), false, `${p} must not be suppressed by route`);
  }
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

// ---------------------------------------------------------------------------
// THE ROOM'S OWN DECLARATION
// ---------------------------------------------------------------------------
// /sim/draft/[id] serves BOTH the practice sim and the tracker, so the path
// genuinely cannot say which section you are in. Starting a tracker room from
// the TRACKER tab landed the user in a room with PRACTICE lit - you do not
// change section by starting the thing the section is for.

test('A ROOM MAY OVERRIDE THE PATH, and a tracker room does', () => {
  assert.equal(activeTabFor('/sim/draft/123'), 'practice', 'the path alone says practice');
  assert.equal(activeTabFor('/sim/draft/123', 'tracker'), 'tracker',
    'a room entered from TRACKER must light TRACKER');
});

test('the override wins on any path, because the room knows and the URL does not', () => {
  assert.equal(activeTabFor('/sim', 'tracker'), 'tracker');
  assert.equal(activeTabFor('/games', 'practice'), 'practice');
});

test('A STALE OR INVENTED OVERRIDE IS IGNORED, not obeyed', () => {
  // The attribute is set by an effect and cleared on unmount; a value that
  // survives, or one nobody defined, must not light a tab that does not exist.
  for (const bad of ['nonsense', 'games ', '', 'PRACTICE', null, undefined, 0]) {
    assert.equal(activeTabFor('/sim/draft/1', bad), 'practice',
      `override ${JSON.stringify(bad)} must fall back to the path`);
  }
});

test('the override may only name a REAL tab', () => {
  for (const t of APP_TABS) {
    assert.equal(activeTabFor('/', t.key), t.key, `${t.key} is a real tab`);
  }
});
