// lib/shell/appTabs.test.mjs - the app container's bottom chrome, as data. PURE.
//
// THIS BAR IS THE ONLY NAVIGATION INSIDE THE APP. There is no URL bar to escape
// with, so an unreachable destination here strands the reader completely - a
// worse version of the bug that shipped The Daily with no nav entry, which is
// why lib/nav.test.mjs exists. Same guard, higher stakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
import { existsSync } from 'node:fs';

const { APP_TABS, activeTabFor, routeSuppressed, isShellClient } = await import('./appTabs.js');

test('the tabs, in order - FOUR, and YOU is the fourth', () => {
  // RANKINGS TAB v2 item 7. Both draft rooms are linked from the Draft room
  // module on the Games lobby, which is where a reader looks for them; a
  // bottom bar is for sections, and two of five slots spent on one game's two
  // rooms was the wrong shape once Rankings existed.
  assert.deepEqual(APP_TABS.map((t) => t.key), ['games', 'scores', 'rankings', 'you']);
  assert.deepEqual(APP_TABS.map((t) => t.href), ['/games', '/scores', '/rankings', '/you']);
  assert.deepEqual(APP_TABS.map((t) => t.label), ['Play', 'Scores', 'Rankings', 'You']);
  // No retired key survives anywhere in the list.
  for (const gone of ['practice', 'tracker', 'today', 'sportsvyn']) {
    assert.equal(APP_TABS.some((t) => t.key === gone), false, `${gone} is off the bar`);
  }
});

test('GAMES RELABELS PLAY, and keeps its key', () => {
  const t = APP_TABS.find((x) => x.key === 'games');
  assert.equal(t.label, 'Play');
  // The key threads RoomScope's data-tab and the override guard, the same
  // argument that kept 'practice' when its label became Mock.
  assert.equal(t.href, '/games');
});

test('THE Y-MONOGRAM FOLLOWED THE BRAND TO THE YOU TAB', () => {
  // It was the Sportsvyn tab's mark. Sportsvyn left the bar, and You is the
  // tab the monogram belongs to now - the reader's own initial of the brand.
  assert.equal(APP_TABS.find((x) => x.key === 'sportsvyn'), undefined);
  const t = APP_TABS.find((x) => x.key === 'you');
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

test('BOTH DRAFT ROOMS LIGHT PLAY, BY EXPLICIT BRANCH (ruling A)', () => {
  // Their own tabs came off the bar. Letting them fall through would have lit
  // NOTHING at all - a reader inside a mock draft told they had left the app -
  // so each is written out rather than merged or dropped.
  assert.equal(activeTabFor('/sim/tracker'), 'games');
  assert.equal(activeTabFor('/sim/tracker/anything'), 'games');
  assert.equal(activeTabFor('/sim'), 'games');
  assert.equal(activeTabFor('/sim/history'), 'games');
  assert.equal(activeTabFor('/sim/account'), 'games');
  assert.equal(activeTabFor('/sim/draft/123'), 'games');
  // And neither retired key is ever returned.
  for (const p of ['/sim', '/sim/tracker', '/sim/draft/9', '/games']) {
    assert.ok(!['practice', 'tracker'].includes(activeTabFor(p)), `${p} must not light a retired tab`);
  }
});

test('EVERY GAME LIGHTS GAMES - the lobby is their front door', () => {
  // A bar that lit nothing while a reader was inside a game would tell them
  // they had left the app.
  for (const p of ['/games', '/games?pane=history', '/daily', '/daily/2026-08-16',
    '/weekly', '/draft']) {
    assert.equal(activeTabFor(p), 'games', `${p} must light GAMES`);
  }
});

test('NEITHER OF THE BROWSE ROUTES GOES DARK - but they light different tabs now', () => {
  // The rule this pinned - the bar must never go dark on a browse surface,
  // because darkness reads as having left the app - is intact. What changed in
  // v0.6 is WHICH tab lights: /nfl gained a tab of its own, so it can no longer
  // light SPORTSVYN as well without one path having two owners.
  for (const p of ['/scores', '/scores?date=2026-09-10', '/market']) {
    assert.equal(activeTabFor(p), 'scores', `${p} must light SCORES`);
  }
  for (const p of ['/rankings', '/rankings?league=cfb&view=people', '/rankings/teams']) {
    assert.equal(activeTabFor(p), 'rankings', `${p} must light RANKINGS`);
  }
  // THE LEAGUE ROUTES LIGHT SCORES now that Today has no seat. Dark would
  // tell a reader inside /nfl that they had left the app.
  for (const p of ['/nfl', '/nfl/fantasy', '/nfl/game/some-slug', '/nfl/rankings']) {
    assert.equal(activeTabFor(p), 'scores', `${p} must light SCORES`);
  }
  // The point of the original test, restated: none of them is dark.
  for (const p of ['/scores', '/market', '/nfl', '/nfl/fantasy', '/cfb', '/cfb/wire']) {
    assert.notEqual(activeTabFor(p), null, `${p} must light SOMETHING`);
  }
});

test('YOU OWNS THE PERSONAL SURFACES', () => {
  // /account used to light nothing at all. It is the same reader looking at
  // themselves, so it lights You, and so does /my.
  for (const p of ['/you', '/account', '/my', '/my/anything']) {
    assert.equal(activeTabFor(p), 'you', p);
  }
  // A stale data-tab override naming a retired tab is ignored, not honoured.
  assert.equal(activeTabFor('/account', 'profile'), 'you');
  assert.equal(activeTabFor('/account', 'sportsvyn'), 'you', 'and a tab that just left');
});

test('surfaces outside the app light NOTHING rather than guessing', () => {
  // The homepage and the true editorial pages are reachable in the container
  // but are not app destinations. A wrong highlight is worse than none.
  // THE FRONT DOOR NOW LIGHTS SPORTSVYN - a tab points at it for the first
  // time, so darkness there would be the wrong answer rather than the honest
  // one.
  for (const p of ['/', '/membership', '/privacy']) {
    assert.equal(activeTabFor(p), null, `${p} must light nothing`);
  }
  assert.equal(activeTabFor(''), null);
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

test('THE FIRST HIT IS RECOGNISED BY ITS COOKIE, WHICH THE PROXY ALREADY SET', () => {
  // WHAT THIS USED TO CLAIM: that the param was read here, "before the cookie
  // exists". There is no longer such a moment. proxy.js matches the first
  // request carrying ?shell=sim-app and sets sv_shell on that same response,
  // so the cookie exists before any client component mounts. Reading the URL
  // too would be a second answer to a question that now has one.
  //
  // The `search` key is GONE FROM THE SIGNATURE rather than accepted and
  // ignored, so a caller that keeps passing location.search fails instead of
  // silently believing it still matters.
  assert.equal(isShellClient({ cookie: 'sv_shell=sim-app' }), true);
  assert.equal(isShellClient({ cookie: '', search: '?shell=sim-app' }), false,
    'the param is write-only now - the proxy is its only reader');
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

test('A ROOM OVERRIDE NAMING A RETIRED TAB IS IGNORED, not obeyed', () => {
  // RoomScope still stamps data-tab="tracker" on a tracker room. That key is
  // no longer a tab, and the existing guard - an override must name a real
  // tab - now catches it, so the room falls back to the path and lights PLAY.
  assert.equal(activeTabFor('/sim/draft/123'), 'games', 'the path says games');
  assert.equal(activeTabFor('/sim/draft/123', 'tracker'), 'games',
    'a stale tracker override cannot light a tab that is gone');
  assert.equal(activeTabFor('/sim', 'practice'), 'games');
});

test('the override still wins when it names a tab that exists', () => {
  assert.equal(activeTabFor('/sim', 'rankings'), 'rankings');
  assert.equal(activeTabFor('/games', 'you'), 'you');
});

test('A STALE OR INVENTED OVERRIDE IS IGNORED, not obeyed', () => {
  // The attribute is set by an effect and cleared on unmount; a value that
  // survives, or one nobody defined, must not light a tab that does not exist.
  for (const bad of ['nonsense', 'games ', '', 'PRACTICE', null, undefined, 0]) {
    assert.equal(activeTabFor('/sim/draft/1', bad), 'games',
      `override ${JSON.stringify(bad)} must fall back to the path`);
  }
});

test('the override may only name a REAL tab', () => {
  for (const t of APP_TABS) {
    assert.equal(activeTabFor('/', t.key), t.key, `${t.key} is a real tab`);
  }
});

// ===========================================================================
// v0.6 — the fifth tab
// ===========================================================================

test('FOUR TABS: play, watch, compare, yourself', () => {
  const labels = APP_TABS.map((t) => t.label);
  assert.deepEqual(labels, ['Play', 'Scores', 'Rankings', 'You']);
  assert.equal(labels.indexOf('Play'), 0, 'what you DO keeps the first slot');
  assert.equal(labels.indexOf('You'), 3, 'and yourself is last');
  assert.equal(APP_TABS.find((t) => t.key === 'you').href, '/you');
});

test('SCORES OWNS THE LEAGUE ROUTES AND THE NETWORK ONES', () => {
  // /nfl used to light SPORTSVYN. Adding a TODAY tab pointing at /nfl would
  // have given one path two owners and lit the wrong one, so the split had to
  // be made rather than left.
  for (const p of ['/nfl', '/nfl/scores', '/nfl/wire', '/nfl/standings',
                   '/nfl/rankings', '/nfl/market', '/nfl/fantasy',
                   '/cfb', '/cfb/scores', '/cfb/wire', '/epl', '/epl/standings']) {
    assert.equal(activeTabFor(p), 'scores', p);
  }
  // A league route is where a reader is inside ONE code; these serve all three.
  // The tab they light is called SCORES now, which is the name of the thing.
  for (const p of ['/scores', '/market']) assert.equal(activeTabFor(p), 'scores', p);
  // and the two draft rooms light PLAY rather than tabs that no longer exist
  assert.equal(activeTabFor('/sim/tracker'), 'games');
  assert.equal(activeTabFor('/sim'), 'games');
  for (const p of ['/games', '/daily', '/weekly', '/draft']) assert.equal(activeTabFor(p), 'games', p);
  assert.equal(activeTabFor('/'), null, 'the front door lost its tab again - the wordmark is the way home');
});

test('every tab points at a route that exists', () => {
  // The bar is the ONLY navigation inside the container - there is no URL bar
  // to escape with - so a destination that 404s is worse here than on the web.
  for (const t of APP_TABS) {
    const file = path.join(REPO, 'app', t.href.replace(/^\//, ''), 'page.js');
    assert.ok(existsSync(file), `${t.label} -> ${t.href} has no route`);
  }
});
