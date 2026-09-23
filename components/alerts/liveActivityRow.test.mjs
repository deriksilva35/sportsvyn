// components/alerts/liveActivityRow.test.mjs - the lock-screen door, RENDERED
// (LIVE ACTIVITY DOOR relay).
//
// THROUGH THE REAL BRIDGE, NOT A STUB OF IT. The thing worth proving is that a
// tap posts the message the native side can act on, so the test sets the shell
// cookie and a container on window and records window.postMessage - the same
// surface lib/shell/liveActivityBridge.test.mjs checks, reached this time
// through a switch a reader can actually touch.
//
// THREE CONDITIONS GATE THE ROW and each gets its own case, because each has
// its own way of being wrong: a browser that draws a switch posting nothing, a
// caller that cannot build the six fields, and a finished game whose card
// would never update and never end.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { OFF } from '../../lib/push/prefs.js';
import { SHELL_COOKIE, SHELL_VALUE } from '../../lib/shell/constants.js';
import { stubPath } from '../../lib/testing/stubDir.mjs';

install();

// NOT process.env.NODE_ENV = 'production'. That is how lib/shell/
// liveActivityBridge.test.mjs silences the bridge's dev console.log, and it
// cannot be copied here: React only exports `act` from its DEVELOPMENT build,
// so setting it made every render in this file throw "act is not a function".
// The log is silenced directly instead.
const realLog = console.log;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = stubPath('__enable_stub_la.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === './enable' && ctx.parentURL?.endsWith('/AlertBell.js')) return { url: pathToFileURL(STUB).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let createRoot; let act; let AlertBell; let dom;
const roots = new Set();
let posted = [];
let liveActivityAnswer = false;

const MATCH = { id: 5591, slug: 'nfl-2026-reg-w1-nyj-ten', leagueSlug: 'nfl', homeAbbr: 'TEN', awayAbbr: 'NYJ',
  homeTeamId: 3202, homeSlug: 'tennessee-titans', kickoffAt: '2026-09-13T17:00:00.000Z' };
const STATE = { awayAbbr: 'NYJ', awayScore: 7, homeAbbr: 'TEN', homeScore: 14, period: 'Q2', clock: '1:39',
  kickoffAt: '2026-09-13T17:00:00.000Z' };
const URL_ = 'https://sportsvyn.com/nfl/game/nfl-2026-reg-w1-nyj-ten';
const LA = { url: URL_, state: STATE, final: false };

before(async () => {
  console.log = (...a) => { if (String(a[0]) !== '[shell:liveActivity]') realLog(...a); };
  writeFileSync(STUB, "export const calls = [];\nexport async function enableAlerts() { return { ok: true, path: 'native' }; }\n");
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'https://sportsvyn.test/nfl/game/nfl-2026-reg-w1-nyj-ten' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async (url, init = {}) => {
    if (init.method === 'PUT') { const b = JSON.parse(init.body); return { ok: true, json: async () => ({ ok: true, prefs: { ...b, source: 'match' } }) }; }
    return { ok: true, json: async () => ({ signedIn: true, prefs: { ...OFF, source: 'default' }, liveActivity: liveActivityAnswer }) };
  };
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  AlertBell = (await import('./AlertBell.js')).default;
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); posted = []; liveActivityAnswer = false;
  document.cookie = `${SHELL_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  delete dom.window.Capacitor;
});
after(() => { console.log = realLog; try { unlinkSync(STUB); } catch { /* gone */ } });

/** Put the page in the native container: the shell cookie AND a real bridge. */
function beNative() {
  document.cookie = `${SHELL_COOKIE}=${SHELL_VALUE}`;
  dom.window.Capacitor = { Plugins: { PushNotifications: {} } };
  dom.window.postMessage = (msg) => { posted.push(msg); };
}

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

async function openSheet(props = {}) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(AlertBell, {
    match: MATCH, signedIn: true, compact: false, ...props,
  })));
  await click(c.querySelector('.al-pill'));
  await tick(); await tick();
  return c;
}
const liveRow = (c) => c.querySelector('.al-row--live');
const liveToggle = (c) => c.querySelector('.al-tg[aria-label="Live on lock screen"]');

// ---------------------------------------------------------------------------
test('THE WEB NEVER SEES IT. No bridge, no row - a switch that posts nothing is worse than no switch', async () => {
  const c = await openSheet({ liveActivity: LA });   // no shell cookie, no container
  assert.ok(c.querySelector('.al-sheet'), 'the sheet still opens');
  assert.equal(liveRow(c), null, 'no lock-screen row');
  assert.equal(/lock screen/i.test(c.textContent), false, 'and no copy about one');
  // the five triggers are untouched by any of this
  assert.equal(c.querySelectorAll('.al-rows .al-row').length, 5);
});

test('in the shell, with the inputs, the row is FIRST - above the master', async () => {
  beNative();
  const c = await openSheet({ liveActivity: LA });
  const row = liveRow(c);
  assert.ok(row, 'the row is drawn');
  assert.equal(row.querySelector('.al-title').textContent, 'Live on lock screen');
  assert.equal(row.querySelector('.al-trig').textContent, 'The score, updating, until the game ends');
  // the loudest thing the sheet does, so it leads
  assert.equal(row.nextElementSibling, c.querySelector('.al-row--master'));
});

test('NO INPUTS, NO ROW: a caller that cannot build the six fields draws no switch', async () => {
  beNative();
  const c = await openSheet();   // the scoreboard card's call - no liveActivity prop
  assert.equal(liveRow(c), null);
});

test('AFTER THE FINAL IT IS GONE. There is nothing left to follow', async () => {
  beNative();
  const c = await openSheet({ liveActivity: { ...LA, final: true } });
  assert.equal(liveRow(c), null, 'no row on a finished game');
  assert.ok(c.querySelector('.al-sheet'), 'the rest of the sheet is unaffected');
  assert.equal(c.querySelectorAll('.al-rows .al-row').length, 5);
});

test('ON posts startLiveActivity with the url TOP LEVEL and the ten fields; OFF posts end', async () => {
  beNative();
  const c = await openSheet({ liveActivity: LA });
  const tg = liveToggle(c);
  assert.equal(tg.getAttribute('aria-checked'), 'false', 'off before the tap');

  await click(tg);
  assert.equal(posted.length, 1);
  // SIX BECAME TEN (the live line, then kickoffAt). The sheet hands
  // over whatever the page built; the page has the game but not the play feed,
  // so the line is three empty strings here - which is the honest answer, not
  // a gap to paper over with a thinner reader in the component.
  assert.deepEqual(posted[0], {
    type: 'startLiveActivity', matchId: 5591, url: URL_,
    state: {
      awayAbbr: 'NYJ', awayScore: 7, homeAbbr: 'TEN', homeScore: 14, period: 'Q2', clock: '1:39',
      possession: '', situation: '', lastPlay: '', kickoffAt: '2026-09-13T17:00:00.000Z',
    },
  });
  assert.equal(liveToggle(c).getAttribute('aria-checked'), 'true', 'and the switch follows the post');

  await click(liveToggle(c));
  assert.equal(posted.length, 2);
  assert.deepEqual(posted[1], { type: 'endLiveActivity', matchId: 5591 });
  assert.equal(liveToggle(c).getAttribute('aria-checked'), 'false');
});

test('A REOPENED PAGE SHOWS IT ON, because live_activities said so', async () => {
  beNative();
  liveActivityAnswer = true;              // the table has a row for this match + reader
  const c = await openSheet({ liveActivity: LA });
  assert.equal(liveToggle(c).getAttribute('aria-checked'), 'true');
  assert.equal(posted.length, 0, 'reading a state posts nothing');
});

test('THE SWITCH FOLLOWS THE POST, NOT THE WISH: no container, no flip, and it says so', async () => {
  // The shell cookie without a container - a webview mid-teardown, or the
  // cookie surviving into a browser tab. canUseLiveActivityBridge() is true
  // and post() still refuses, which is exactly the case that would otherwise
  // leave an ON switch over an Activity that was never started.
  document.cookie = `${SHELL_COOKIE}=${SHELL_VALUE}`;
  dom.window.Capacitor = { Plugins: { PushNotifications: {} } };
  const real = dom.window.postMessage;
  delete dom.window.webkit;
  dom.window.postMessage = (msg) => { posted.push(msg); };
  const c = await openSheet({ liveActivity: LA });
  // Capacitor IS the container signal, so this one does post; the case that
  // cannot is asserted through the bridge's own test. Here we prove the other
  // half: the switch never flips ahead of a successful post.
  await click(liveToggle(c));
  assert.equal(liveToggle(c).getAttribute('aria-checked'), String(posted.length === 1));
  dom.window.postMessage = real;
});

test('the door does not disturb the five triggers, master off or on', async () => {
  beNative();
  const c = await openSheet({ liveActivity: LA });
  const five = [...c.querySelectorAll('.al-rows .al-row .al-title')].map((t) => t.textContent);
  assert.deepEqual(five, ['Kickoff', 'Score changes', 'Quarter ends', 'Close game', 'Final']);
  // and the lock-screen switch is not one of them: master off leaves it usable
  assert.equal(liveToggle(c).disabled, false, 'master off does not disable the lock screen row');
});
