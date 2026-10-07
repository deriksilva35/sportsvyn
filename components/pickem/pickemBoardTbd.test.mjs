// components/pickem/pickemBoardTbd.test.mjs - a TBD MLB first pitch on the Pick'em
// board (tue-10, Time TBD everywhere): the row says "Time TBD", no countdown is
// built from the placeholder, and a board whose only open game is TBD is not
// "locked". The real component in jsdom; the server actions are stubbed.

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
const STUB = stubPath(`__tbd_actions_${process.pid}.mjs`);
registerHooks({ resolve(spec, ctx, next) {
  if (/^@\/app\/actions\/(pickem|confirm|handle)$/.test(spec)) return { url: pathToFileURL(STUB).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let createRoot; let act; let PickemBoard; let dom; let tmp;
const roots = new Set();

const HOUR = 3600_000;
// Relative to now: a dated cheque goes stale (pickemBoardV2.test's lesson).
const future = (h) => new Date(Date.now() + h * HOUR).toISOString();

const game = (o = {}) => ({
  match_id: 1, slug: 'a-at-b', home: 'Dodgers', away: 'Brewers',
  kickoff_at: future(30), kickoff_tbd: false, status: 'scheduled', kicked: false, my_side: null, graded: null,
  spread_home: null, home_rank: null, away_rank: null, home_record: null, away_record: null,
  home_colors: null, away_colors: null,
  home_score: null, away_score: null, period: null, clock: null, network: null,
  ...o,
});

before(async () => {
  writeFileSync(STUB, `
    export async function savePickAction() { return { ok: true }; }
    export async function confirmPickemEntry() { return { ok: true, confirmedAt: null }; }
    export async function checkHandle() { return { ok: true, message: 'Available' }; }
    export async function claimHandle() { return { ok: true, handle: 'x' }; }
  `);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/pickem/mlb' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'PickemBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), {
    filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false,
  }).code;
  tmp = stubPath(`__pickem_tbd_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  PickemBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { for (const f of [tmp, STUB]) { try { unlinkSync(f); } catch { /* gone */ } } });

function render(games) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(PickemBoard, {
    view: { contest: { id: 1, boardNumber: 2, sport: 'mlb', displayWeek: 2, week: 2 }, games },
    signedIn: true, signinHref: '/signin', hasHandle: true, initialConfirmedAt: null,
    locksAt: future(30), season: null,
  })));
  return c;
}
const tops = (c) => [...c.querySelectorAll('.pkv-gtop')].map((e) => e.textContent);

test('a TBD game row says Time TBD - no clock - and a real game keeps its time', () => {
  const c = render([
    game({ match_id: 1, kickoff_tbd: true }),
    game({ match_id: 2, slug: 'c-at-d', kickoff_at: future(31) }),
  ]);
  const [tbd, real] = tops(c);
  assert.match(tbd, /Time TBD/);
  assert.doesNotMatch(tbd, /\d:\d\d/);
  assert.match(real, /\d:\d\d [AP]M/);
  assert.doesNotMatch(real, /Time TBD/);
});

test('no countdown is built from a TBD placeholder, and an open TBD-only board is not "locked"', () => {
  const only = render([game({ match_id: 1, kickoff_tbd: true })]);
  assert.doesNotMatch(only.textContent, /next lock/);
  assert.doesNotMatch(only.textContent, /· locked/);
});

test('the countdown skips a TBD game and counts to the next real first pitch', () => {
  const c = render([
    game({ match_id: 1, kickoff_tbd: true, kickoff_at: future(2) }),
    game({ match_id: 2, slug: 'c-at-d', kickoff_at: future(5) }),
  ]);
  const m = c.textContent.match(/next lock\s*(\d+)h/);
  assert.ok(m, 'a countdown to the real game is present');
  assert.ok(Number(m[1]) >= 4, `counts to the 5h game, not the 2h placeholder (got ${m[1]}h)`);
});
