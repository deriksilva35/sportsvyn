// components/pickem/pickemBoard.test.mjs - Pick'em reads as straight up, and
// a pick tap never reads or writes the spread. Press-the-button: the real
// component in jsdom, the real tap, a recording stand-in for the server action.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(__dirname, '__actions_stub.mjs');
// The three server-action modules pull in auth and the database; a pick test
// needs none of that. One stub answers all three, and RECORDS every call.
registerHooks({ resolve(spec, ctx, next) {
  if (/^@\/app\/actions\/(pickem|confirm|handle)$/.test(spec)) return { url: pathToFileURL(STUB).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, createRoot, act, PickemBoard, dom, tmp; const roots = new Set();

before(async () => {
  writeFileSync(STUB, `
    export const calls = [];
    export async function savePickAction(...args) { calls.push(args); return { ok: true }; }
    export async function confirmPickemEntry() { return { ok: true }; }
    export async function checkHandle() { return { ok: true, message: 'Available' }; }
    export async function claimHandle() { return { ok: true, handle: 'x' }; }
  `);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/pickem/nfl' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react')); ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'PickemBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), { filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false }).code;
  tmp = path.join(__dirname, `__pickem_test_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  PickemBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { for (const f of [tmp, STUB]) { try { unlinkSync(f); } catch { /* gone */ } } });

const stub = async () => import(pathToFileURL(STUB).href);
const future = new Date(Date.now() + 3 * 3600_000).toISOString();
const game = () => ({
  match_id: 20749, slug: 'nfl-2026-reg-w1-ne-sea', home: 'Seahawks', away: 'Patriots',
  kickoff_at: future, status: 'scheduled', kicked: false, my_side: null, graded: null,
  spread_home: -3, home_rank: null, away_rank: null, home_record: null, away_record: null,
  home_score: null, away_score: null,
});
function render(sport = 'nfl', g = game()) {
  const container = document.getElementById('root'); const root = createRoot(container); roots.add(root);
  act(() => root.render(React.createElement(PickemBoard, {
    view: { contest: { id: 1, boardNumber: 1, sport, displayWeek: 1, week: 1 }, games: [g] },
    signedIn: true, signinHref: '/signin', hasHandle: true, initialConfirmedAt: null, locksAt: future,
  })));
  return container;
}
const sides = (c) => [...c.querySelectorAll('.pk-side')];
const byName = (c, n) => sides(c).find((b) => b.querySelector('.pk-nm')?.textContent === n);
const click = (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

test('1. one line under the header, the same words on both sports', () => {
  for (const sport of ['nfl', 'cfb']) {
    const c = render(sport);
    const p = c.querySelector('.pk-straight');
    assert.ok(p, `${sport}: the line exists`);
    assert.equal(p.textContent, 'Pick the winner. Straight up. The line is for reference.');
    assert.equal(c.querySelector('header.hdr').nextElementSibling, p, 'directly under the board header');
    act(() => { for (const r of roots) r.unmount(); }); roots.clear();
  }
});

test('2. the line sits BELOW both sides, muted mono, prefixed "line" - never in the kickoff row', () => {
  const c = render();
  const line = c.querySelector('.pk-line'); assert.ok(line, 'the line renders pre-kick');
  assert.match(line.textContent, /^line\s*Seahawks\s*−3$/u);
  assert.equal(line.querySelector('.pk-line-k').textContent, 'line');
  const sidesEl = c.querySelector('.pk-sides'); const eb = c.querySelector('.pk-eb');
  assert.ok(sidesEl.compareDocumentPosition(line) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'after the sides');
  assert.ok(!eb.contains(line), 'not in the eyebrow');
  assert.doesNotMatch(eb.textContent, /[−+-]\s*\d/, 'the kickoff row carries no odds');
  assert.equal(c.querySelector('.pk-spread'), null, 'the old chip is gone');
});

test('3. a pick reads as a winner: volt stays, the other side goes muted, YOUR PICK on the pick, no odds on any button', async () => {
  const c = render();
  const sea = byName(c, 'Seahawks'), ne = byName(c, 'Patriots');
  assert.ok(sea && ne);
  for (const b of [sea, ne]) { assert.doesNotMatch(b.textContent, /YOUR PICK/); assert.doesNotMatch(b.className, /\bdim\b|\bon\b/); }
  await click(sea);
  assert.match(sea.className, /\bon\b/, 'picked side keeps the volt fill');
  assert.match(sea.textContent, /YOUR PICK/);
  assert.match(ne.className, /\bdim\b/, 'the unpicked side drops to muted');
  assert.doesNotMatch(ne.textContent, /YOUR PICK/);
  for (const b of sides(c)) {
    assert.doesNotMatch(b.textContent, /[−+-]\s*\d/, 'no odds anywhere on a button');
    assert.doesNotMatch(b.textContent, /\bline\b/i);
    assert.equal(b.querySelector('.pk-line'), null);
  }
});

test('4. a pick tap neither reads nor writes the spread', async () => {
  const { calls } = await stub(); calls.length = 0;
  const c = render();
  await click(byName(c, 'Seahawks'));
  assert.equal(calls.length, 1, 'one save');
  assert.deepEqual(calls[0], [1, 20749, 'home'], 'contest, match, side - and nothing else');
  assert.ok(!calls[0].some((a) => a === -3 || a === '-3' || (a && typeof a === 'object' && 'spread' in a)), 'the spread never travels');
  // And the handlers never even read it: a source guard on tap()/savePick().
  const src = readFileSync(path.join(__dirname, 'PickemBoard.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // From tap() through the end of savePick()'s body - the first `\n  }\n`
  // after savePick opens closes it (both handlers sit at two-space indent).
  const start = src.indexOf('function tap(');
  const sp = src.indexOf('async function savePick(');
  const end = src.indexOf('\n  }\n', sp) + 4;
  const handlers = src.slice(start, end);
  assert.match(handlers, /savePickAction\(/, 'the slice reached savePick');
  assert.doesNotMatch(handlers, /spread/, 'tap/savePick reference no spread');
});
