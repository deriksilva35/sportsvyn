// components/alerts/alertBell.test.mjs — the sheet, RENDERED (ALERTS SHEET
// relay, item 4). The source-regex pins in lib/push/gameAlerts.test.mjs say
// what the JSX contains; this says what a reader sees: five trigger rows dimmed
// and disabled under master off, the first line saying "Off", and one master
// tap turning into the DEFAULTS row on the wire and on screen.
//
// ALERTS_PASTE=1 prints the fresh-user sheet HTML - the served-proof paste. The
// sheet never ships in server HTML (it renders on open, by design and by test),
// so a client render against the API's own fresh-user answer IS the served
// sheet.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { DEFAULTS, OFF } from '../../lib/push/prefs.js';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(__dirname, '__enable_stub.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === './enable' && ctx.parentURL?.endsWith('/AlertBell.js')) return { url: pathToFileURL(STUB).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, createRoot, act, AlertBell, dom, stub; const roots = new Set();
// The wire, recorded. GET answers what /api/push/prefs answers a fresh user
// on a match-scope read: OFF, source 'default'. PUT answers with the row the
// route would keep (nextRow is the same function on both sides).
let gets = 0; let puts = [];
let getPrefs = () => ({ ...OFF, source: 'default' });
let putAnswer = (body) => ({ ok: true, prefs: { ...body, source: 'match' } });
const MATCH = { id: 5591, slug: 'nfl-2026-reg-w1-nyj-ten', leagueSlug: 'nfl', homeAbbr: 'TEN', awayAbbr: 'NYJ',
  homeTeamId: 3202, homeSlug: 'tennessee-titans', kickoffAt: '2026-09-13T17:00:00.000Z' };

before(async () => {
  writeFileSync(STUB, `export const calls = [];\nexport async function enableAlerts() { calls.push(1); return { ok: true, path: 'web' }; }\n`);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/nfl/game/nfl-2026-reg-w1-nyj-ten' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async (url, init = {}) => {
    if (init.method === 'PUT') { const body = JSON.parse(init.body); puts.push(body); const j = putAnswer(body); return { ok: true, json: async () => j }; }
    gets += 1; return { ok: true, json: async () => ({ signedIn: true, prefs: getPrefs() }) };
  };
  React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
  AlertBell = (await import('./AlertBell.js')).default;
  stub = await import(pathToFileURL(STUB).href);
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); puts = []; gets = 0; stub.calls.length = 0; });
after(() => { try { unlinkSync(STUB); } catch { /* gone */ } });

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
async function openSheet() {
  const container = document.getElementById('root'); const root = createRoot(container); roots.add(root);
  act(() => root.render(React.createElement(AlertBell, { match: MATCH, signedIn: true, compact: false })));
  await click(container.querySelector('.al-pill'));
  await tick(); await tick();
  return container;
}
const rows = (c) => [...c.querySelectorAll('.al-rows .al-row')];
const titles = (c) => rows(c).map((r) => r.querySelector('.al-title').textContent);
const toggleOf = (c, label) => c.querySelector(`.al-tg[aria-label="${label}"]`);

test('a fresh user on an NFL game, before any tap: "Off", five triggers in order, every one dimmed and disabled', async () => {
  const c = await openSheet();
  assert.equal(gets, 1, 'one read, on open');
  const sheet = c.querySelector('.al-sheet'); assert.ok(sheet, 'the sheet is open');
  assert.equal(sheet.querySelector('.al-summary').textContent, 'Off', 'the first line says what the row will do');
  assert.equal(sheet.querySelector('.al-eye').nextElementSibling, sheet.querySelector('.al-summary'), 'and it is the first line of the body');
  assert.deepEqual(titles(c), ['Kickoff', 'Score changes', 'Quarter ends', 'Close game', 'Final']);
  assert.equal(toggleOf(c, 'Alerts for this game').getAttribute('aria-checked'), 'false');
  assert.ok(c.querySelector('.al-rows').classList.contains('al-dim'), 'dimmed, not hidden');
  for (const r of rows(c)) {
    const tg = r.querySelector('.al-tg');
    assert.equal(tg.disabled, true, `${r.querySelector('.al-title').textContent} is disabled under master off`);
    assert.equal(tg.getAttribute('aria-checked'), 'false');
  }
  assert.doesNotMatch(sheet.textContent, /Silenced|Final only/);
  assert.equal(c.querySelector('.al-pill').classList.contains('on'), false, 'the pill does not light');
  if (process.env.ALERTS_PASTE) console.log(`\nPASTE fresh-user sheet (client render, match ${MATCH.id}):\n${sheet.outerHTML}\n`);
});

test('ONE MASTER TAP: the DEFAULTS row goes over the wire, the prompt follows the tap, the sheet reads it back', async () => {
  const c = await openSheet();
  await click(toggleOf(c, 'Alerts for this game'));
  await tick(); await tick();
  assert.equal(stub.calls.length, 1, 'enableAlerts once, after the tap');
  assert.deepEqual(puts, [{ scope: 'match', scopeId: MATCH.id, ...DEFAULTS }], 'R1: master ON with no saved row -> the DEFAULTS row, not the OFF flags');
  assert.equal(c.querySelector('.al-summary').textContent, 'Kickoff, score changes, close games and the final');
  assert.equal(c.querySelector('.al-rows').classList.contains('al-dim'), false);
  const on = Object.fromEntries(rows(c).map((r) => [r.querySelector('.al-title').textContent, r.querySelector('.al-tg').getAttribute('aria-checked')]));
  assert.deepEqual(on, { Kickoff: 'true', 'Score changes': 'true', 'Quarter ends': 'false', 'Close game': 'true', Final: 'true' });
  for (const r of rows(c)) assert.equal(r.querySelector('.al-tg').disabled, false, 'enabled once master is on');
  assert.ok(c.querySelector('.al-pill').classList.contains('on'), 'the pill lights');
  assert.ok(c.querySelector('.al-saved'), 'Saved');
});

test('then master OFF keeps the triggers; a single Final row reads "Final only"', async () => {
  const c = await openSheet();
  await click(toggleOf(c, 'Alerts for this game')); await tick(); await tick();
  await click(toggleOf(c, 'Alerts for this game')); await tick(); await tick();
  assert.equal(puts.length, 2);
  assert.deepEqual(puts[1], { scope: 'match', scopeId: MATCH.id, ...DEFAULTS, master: false }, 'master false, the triggers as they were');
  assert.equal(c.querySelector('.al-summary').textContent, 'Off');
  assert.ok(c.querySelector('.al-rows').classList.contains('al-dim'));
  assert.equal(toggleOf(c, 'Kickoff').getAttribute('aria-checked'), 'true', 'the row keeps its state under the dim');
  assert.equal(stub.calls.length, 1, 'turning off asks for no permission');
  // Back on, then everything but Final off: the line reads "Final only".
  await click(toggleOf(c, 'Alerts for this game')); await tick(); await tick();
  for (const l of ['Kickoff', 'Score changes', 'Close game']) { await click(toggleOf(c, l)); await tick(); await tick(); }
  assert.equal(c.querySelector('.al-summary').textContent, 'Final only');
  assert.deepEqual(puts.at(-1), { scope: 'match', scopeId: MATCH.id, master: true, kickoff: false, score: false, quarter: false, close: false, final: true });
});

test('a saved row shows as saved: no DEFAULTS surprise on a later master tap', async () => {
  getPrefs = () => ({ master: false, kickoff: false, score: true, quarter: true, close: false, final: false, source: 'match' });
  try {
    const c = await openSheet();
    assert.equal(c.querySelector('.al-summary').textContent, 'Off');
    await click(toggleOf(c, 'Alerts for this game')); await tick(); await tick();
    assert.deepEqual(puts, [{ scope: 'match', scopeId: MATCH.id, master: true, kickoff: false, score: true, quarter: true, close: false, final: false }],
      'master ON with a saved row -> the reader\'s own flags, whole');
    assert.equal(c.querySelector('.al-summary').textContent, 'Score changes and quarter ends');
  } finally { getPrefs = () => ({ ...OFF, source: 'default' }); }
});
