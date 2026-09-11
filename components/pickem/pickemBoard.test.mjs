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
function renderMany(sport, games) {
  const container = document.getElementById('root'); const root = createRoot(container); roots.add(root);
  act(() => root.render(React.createElement(PickemBoard, {
    view: { contest: { id: 1, boardNumber: 1, sport, displayWeek: 1, week: 1 }, games },
    signedIn: true, signinHref: '/signin', hasHandle: true, initialConfirmedAt: null, locksAt: future,
  })));
  return container;
}
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

// ---------------------------------------------------------------------------
// HELMETS (relay HELMETS item 5c/6). A dressed row draws one helmet per side,
// facing each other across the "at"; an undressed row draws none - never a
// grey one; and a side with a helmet in it still saves the pick on tap.
// ---------------------------------------------------------------------------
const dressed = () => ({
  ...game(), home_team_id: 2, away_team_id: 1,
  home_colors: { primary: '#002244', secondary: '#69BE28' }, away_colors: { primary: '#002244', secondary: '#C60C30' },
});

test('helmets: a dressed row draws two, facing each other; an undressed row draws none', () => {
  const c = render('nfl', dressed());
  const hm = [...c.querySelectorAll('.pk-hm')];
  assert.equal(hm.length, 2);
  const away = byName(c, 'Patriots'); const home = byName(c, 'Seahawks');
  assert.equal(away.querySelector('.pk-hm').getAttribute('data-facing'), 'right', 'away looks right, toward the at');
  assert.equal(home.querySelector('.pk-hm').getAttribute('data-facing'), 'left', 'home looks left');
  for (const s of [away, home]) assert.equal(s.firstElementChild.classList.contains('pk-hm'), true, 'the helmet comes before the name');
  assert.equal(home.querySelector('.pk-hm').nextElementSibling.classList.contains('pk-nmwrap'), true);
  const bare = render('nfl', { ...game(), home_colors: null, away_colors: null });
  assert.equal(bare.querySelectorAll('.pk-hm').length, 0, 'no colors, no helmet');
  const half = render('nfl', { ...game(), home_colors: { primary: '#002244', secondary: null }, away_colors: null });
  assert.equal(half.querySelectorAll('.pk-hm').length, 0, 'one color is not a dressed team');
});

test('helmets: BOTH OR NEITHER - an FCS-at-FBS row draws none, an FBS-at-FBS row draws two', () => {
  const famuAtMiami = { ...game(), slug: 'cfb-2026-reg-w2-florida-a-m-miami', home: 'Miami', away: 'Florida A&M', home_team_id: 2, away_team_id: 1,
    home_colors: { primary: '#F47321', secondary: '#005030' }, away_colors: null };
  const c1 = render('cfb', famuAtMiami);
  assert.equal(c1.querySelectorAll('.pk-hm').length, 0, 'Miami is dressed, Florida A&M is not: neither side draws');
  assert.equal(byName(c1, 'Miami').firstElementChild.classList.contains('pk-nmwrap'), true, 'the names align as before helmets');
  const c2 = render('cfb', { ...famuAtMiami, away: 'Notre Dame', away_colors: { primary: '#0C2340', secondary: '#C99700' } });
  assert.equal(c2.querySelectorAll('.pk-hm').length, 2, 'both dressed: two');
});

test('helmets: tapping a side that carries a helmet still saves the pick', async () => {
  const { calls } = await stub(); const n = calls.length;
  const c = render('nfl', dressed());
  await click(byName(c, 'Seahawks').querySelector('.pk-hm'));
  assert.equal(calls.length, n + 1, 'one save');
  assert.match(JSON.stringify(calls[n]), /"home"/, 'the home side');
  assert.match(JSON.stringify(calls[n]), /20749/, 'this game');
  assert.equal(byName(c, 'Seahawks').classList.contains('on'), true, 'and the side reads as picked');
});

// ---------------------------------------------------------------------------
// ROLLING LOCK: a kicked row wears pk-locked and its pk-at slot shows the
// kickoff time; an unkicked row on the same board stays live.
// ---------------------------------------------------------------------------
test('rolling lock: a kicked row is pk-locked with its kickoff where "at" was; the next row is live', () => {
  const past = new Date(Date.now() - 3 * 3600_000).toISOString();
  const kicked = { ...game(), match_id: 20749, kickoff_at: past, kicked: true, status: 'live', home_score: 3, away_score: 10 };
  const live = { ...game(), match_id: 20750, slug: 'nfl-2026-reg-w1-sf-lar', home: 'Rams', away: '49ers' };
  const c = renderMany('nfl', [kicked, live]);
  const rows = [...c.querySelectorAll('.pk-game')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].classList.contains('pk-locked'), true);
  assert.equal(rows[1].classList.contains('pk-locked'), false);
  assert.notEqual(rows[0].querySelector('.pk-at').textContent.trim(), 'at', 'the kickoff time, not "at"');
  assert.match(rows[0].querySelector('.pk-at').textContent, /\d/);
  assert.equal(rows[1].querySelector('.pk-at').textContent.trim(), 'at');
  assert.equal(rows[0].querySelectorAll('button.pk-side[disabled]').length, 2, 'both sides inert');
  assert.equal(rows[1].querySelectorAll('button.pk-side:not([disabled])').length, 2, 'both sides live');
});
