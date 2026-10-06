// components/pickem/confidenceBoard.test.mjs - the confidence board, pressed.
//
// The real component in jsdom with a recording stub for the server action, so
// "one call saved the whole sheet" and "a locked row did not move" are facts.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = stubPath(`__conf_actions_${process.pid}.mjs`);
registerHooks({ resolve(spec, ctx, next) {
  if (/^@\/app\/actions\/(pickem|confirm|handle)$/.test(spec)) return { url: pathToFileURL(STUB).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let createRoot; let act; let ConfidenceBoard; let dom; let tmp;
const roots = new Set();
const HOUR = 3600_000;
const future = (h = 3) => new Date(Date.now() + h * HOUR).toISOString();
const past = (h = 3) => new Date(Date.now() - h * HOUR).toISOString();

/** One row in gameRows()'s shape, confidence fields included. */
const game = (o = {}) => ({
  match_id: 1, slug: 'a', home: 'Bills', away: 'Lions', kickoff_at: future(), status: 'scheduled', kicked: false,
  my_side: null, my_rank: 1, my_points: null, void: false, graded: null,
  home_colors: { primary: '#00338D', secondary: '#C60C30' }, away_colors: { primary: '#0076B6', secondary: '#B0B7BC' },
  home_abbr: null, away_abbr: null, home_score: null, away_score: null, ...o,
});

before(async () => {
  writeFileSync(STUB, `
    export const sheets = [];
    export async function saveSheetAction(...a) { sheets.push(a); return { ok: true, ranks: a[2] }; }
    export async function savePickAction() { return { ok: true }; }
    export async function confirmPickemEntry() { return { ok: true }; }
    export async function checkHandle() { return { ok: true, message: 'Available' }; }
    export async function claimHandle() { return { ok: true, handle: 'x' }; }
  `);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/pickem/nfl' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'ConfidenceBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), {
    filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false,
  }).code;
  tmp = stubPath(`__confidence_board_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  ConfidenceBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { for (const f of [tmp, STUB]) { try { unlinkSync(f); } catch { /* gone */ } } });

const stub = async () => import(pathToFileURL(STUB).href);
function render(games, extra = {}) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(ConfidenceBoard, {
    view: { contest: { id: 7, boardNumber: 3, sport: 'nfl', displayWeek: 7, scoring: 'confidence' }, games },
    signedIn: true, signinHref: '/signin', hasHandle: true, season: null, ...extra,
  })));
  return c;
}
const click = (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
const rows = (c) => [...c.querySelectorAll('.cfd-row')];
const order = (c) => rows(c).map((r) => Number(r.dataset.match));
const chips = (c) => rows(c).map((r) => r.querySelector('.cfd-rk').textContent);

const three = () => [
  game({ match_id: 1, my_rank: 3, home: 'Bills', away: 'Lions' }),
  game({ match_id: 2, my_rank: 2, home: 'Chiefs', away: 'Colts' }),
  game({ match_id: 3, my_rank: 1, home: 'Jets', away: 'Titans' }),
];

test('the header says what to do and what it is worth, with the two chips', () => {
  const c = render(three());
  assert.match(c.querySelector('.cfd-h').textContent, /^Pick winners, then rank them\.$/);
  assert.match(c.querySelector('.cfd-sub').textContent, /Your surest pick is worth 3\. Right picks score their number\./);
  const chipText = [...c.querySelectorAll('.cfd-chip')].map((x) => x.textContent);
  assert.deepEqual(chipText, ['6 points up for grabs', '0 of 3 picked']);
});

test('rows run biggest number first, the top three chips wear volt, one primary button', () => {
  const c = render(three());
  assert.deepEqual(order(c), [1, 2, 3]);
  assert.deepEqual(chips(c), ['3', '2', '1']);
  assert.equal(c.querySelectorAll('.cfd-rk.top').length, 3);
  const big = render([...three(), game({ match_id: 4, my_rank: 4 })]);
  assert.equal(big.querySelectorAll('.cfd-rk.top').length, 3, 'only the top three of four');
  assert.equal(c.querySelectorAll('.pkv-lock').length, 1);
  assert.equal(c.querySelector('.pkv-lock').textContent, 'Save picks');
  assert.equal(c.querySelector('.pkv-lock').disabled, true, 'nothing to save yet');
});

test('up and down move the row and renumber its neighbour; "Save picks" sends the WHOLE sheet in one call', async () => {
  const c = render(three());
  const s = await stub();
  await click(rows(c)[2].querySelector('button[aria-label="Move up"]'));    // game 3: 1 -> 2, game 2 -> 1
  assert.deepEqual(order(c), [1, 3, 2]);
  assert.deepEqual(chips(c), ['3', '2', '1']);
  const pill = rows(c)[0].querySelectorAll('.cfd-pill')[1];                   // home side of game 1
  await click(pill);
  assert.equal(pill.getAttribute('aria-pressed'), 'true');
  assert.equal(s.sheets.length, 0, 'nothing is written until the button');
  await click(c.querySelector('.pkv-lock'));
  assert.equal(s.sheets.length, 1, 'ONE call');
  const [cid, picks, ranks] = s.sheets[0];
  assert.equal(cid, 7);
  assert.deepEqual(picks, { 1: 'home' });
  assert.deepEqual(ranks, { 1: 3, 2: 1, 3: 2 });
  assert.match(c.querySelector('.pkv-pace').textContent, /Saved/);
});

test('a started game dims, says Locked, has no live pills or arrows, and moves are stepped OVER it', async () => {
  const c = render([
    game({ match_id: 1, my_rank: 3, kicked: false }),
    game({ match_id: 2, my_rank: 2, kicked: true, kickoff_at: past(), status: 'live', my_side: 'home' }),
    game({ match_id: 3, my_rank: 1, kicked: false }),
  ]);
  const locked = rows(c)[1];
  assert.ok(locked.classList.contains('locked'));
  assert.equal(locked.querySelector('.cfd-lk').textContent, 'Locked');
  assert.ok([...locked.querySelectorAll('.cfd-pill')].every((b) => b.disabled));
  assert.ok([...locked.querySelectorAll('.cfd-mv button')].every((b) => b.disabled));
  // moving game 1 DOWN swaps with game 3, across the locked game; the locked one keeps its 2
  await click(rows(c)[0].querySelector('button[aria-label="Move down"]'));
  assert.deepEqual(order(c), [3, 2, 1]);
  assert.deepEqual(chips(c), ['3', '2', '1']);
  assert.equal(rows(c)[1].dataset.match, '2');
  assert.equal(rows(c)[1].querySelector('.cfd-rk').textContent, '2');
});

test('graded rows read +points (jade), 0 (terra), void (grey)', () => {
  const c = render([
    game({ match_id: 1, my_rank: 3, kicked: true, status: 'final', my_side: 'home', graded: 'W', my_points: 3 }),
    game({ match_id: 2, my_rank: 2, kicked: true, status: 'final', my_side: 'home', graded: 'L', my_points: 0 }),
    game({ match_id: 3, my_rank: 1, kicked: true, status: 'postponed', void: true }),
  ]);
  const pts = rows(c).map((r) => r.querySelector('.cfd-pts')?.textContent);
  assert.deepEqual(pts, ['+3', '0', 'void']);
  assert.ok(rows(c)[0].querySelector('.cfd-pts').classList.contains('j'));
  assert.ok(rows(c)[1].querySelector('.cfd-pts').classList.contains('t'));
  assert.ok(rows(c)[2].querySelector('.cfd-pts').classList.contains('v'));
  assert.equal(c.querySelector('.pkv-lock'), null, 'nothing open: no save button');
});

test('signed out: the pills are sign-in links and there is no save', () => {
  const c = render(three(), { signedIn: false });
  assert.equal(c.querySelectorAll('a.cfd-pill').length, 6);
  assert.equal(c.querySelector('.pkv-lock'), null);
  assert.match(c.textContent, /Sign in to make your picks/);
});
