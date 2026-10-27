// components/pickem/winPct.test.mjs - records on every board, win % instead of
// the spread (wed-1). The real PickemBoard in jsdom for the row facts; pure
// tests for the NBA feed shaping (lib/pickem/nbaFeed.js).
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
import { winPctText } from '../../lib/pickem/winPctLine.js';
import { homeWinPct } from '../../lib/pickem/view.js';
import { shapeFeedMoneylines, impliedFromAmerican, nbaMoneylines, nbaRecords } from '../../lib/pickem/nbaFeed.js';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = stubPath(`__winpct_actions_${process.pid}.mjs`);
registerHooks({ resolve(spec, ctx, next) {
  if (/^@\/app\/actions\/(pickem|confirm|handle)$/.test(spec)) return { url: pathToFileURL(STUB).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let createRoot; let act; let PickemBoard; let dom; let tmp; const roots = new Set();
const future = () => new Date(Date.now() + 3 * 3600_000).toISOString();

before(async () => {
  writeFileSync(STUB, `
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
  ({ act } = await import('react')); ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'PickemBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), { filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false }).code;
  tmp = stubPath(`__winpct_board_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  PickemBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { for (const f of [tmp, STUB]) { try { unlinkSync(f); } catch { /* gone */ } } });

const game = (o = {}) => ({
  match_id: 1, slug: 'a-at-b', home: 'Packers', away: 'Bears', kickoff_at: future(), status: 'scheduled', kicked: false,
  my_side: null, graded: null, spread_home: -6.5, frozen_spread_home: -3.5, home_win_pct: 64,
  home_rank: null, away_rank: null, home_record: '5-2', away_record: '3-4', home_score: null, away_score: null, ...o,
});
function render(sport, games, extra = {}) {
  const c = document.getElementById('root'); const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(PickemBoard, {
    view: { contest: { id: 1, boardNumber: 2, sport, displayWeek: 2, week: 2 }, games },
    signedIn: true, signinHref: '/signin', hasHandle: true, initialConfirmedAt: null, locksAt: future(), ...extra,
  })));
  return c;
}

test('win % shows on NFL, CFB and NBA rows as "FAVOURITE NN%", with the records under both names', () => {
  for (const sport of ['nfl', 'cfb', 'nba']) {
    const c = render(sport, [game()]);
    assert.equal(c.querySelector('.pkv-line').textContent, 'Packers 64%', sport);
    const small = [...c.querySelectorAll('.pkv-nm small')].map((s) => s.textContent).sort();
    assert.deepEqual(small, ['3-4', '5-2'], `${sport}: a record under every name`);
    assert.match(c.querySelector('.pkv-pace').textContent, /Straight up · win % from betting odds/, sport);
    act(() => { for (const r of roots) r.unmount(); }); roots.clear();
  }
});

test('the NBA record shows (W-L under each name) and an away favourite is named', () => {
  const c = render('nba', [game({ home: 'Celtics', away: 'Knicks', home_record: '4-1', away_record: '2-3', home_win_pct: 41 })]);
  assert.deepEqual([...c.querySelectorAll('.pkv-nm small')].map((s) => s.textContent).sort(), ['2-3', '4-1']);
  assert.equal(c.querySelector('.pkv-line').textContent, 'Knicks 59%');
});

test('a ranked CFB team keeps "#rank · W-L"', () => {
  const c = render('cfb', [game({ away_rank: 12 })]);
  assert.ok([...c.querySelectorAll('.pkv-nm small')].some((s) => s.textContent === '#12 · 3-4'));
});

test('a game with no moneyline shows neither a win % nor the spread', () => {
  const c = render('nfl', [game({ home_win_pct: null, spread_home: -6.5 })]);
  assert.equal(c.querySelector('.pkv-line'), null);
  assert.doesNotMatch(c.querySelector('.pkv-g').textContent, /6\.5|%/);
});

test('exactly 50% shows nothing', () => {
  assert.equal(render('nfl', [game({ home_win_pct: 50 })]).querySelector('.pkv-line'), null);
});

test('a locked or live game shows no line', () => {
  const c = render('nfl', [game({ status: 'live', kicked: true, kickoff_at: new Date(Date.now() - 3600_000).toISOString() })]);
  assert.equal(c.querySelector('.pkv-line'), null);
});

test('an ATS league board keeps the FROZEN spread, not the win %, and its own footer', () => {
  const c = render('nfl', [game()], { ats: true });
  const line = c.querySelector('[data-ats-line]');
  assert.ok(line);
  assert.match(line.textContent, /Bears .*3\.5.*Packers .*3\.5/);
  assert.doesNotMatch(line.textContent, /%/);
  assert.equal(c.querySelector('[data-winpct]'), null);
  assert.match(c.querySelector('.pkv-pace').textContent, /Against the spread/);
  assert.doesNotMatch(c.querySelector('.pkv-pace').textContent, /win %/);
});

test('winPctText: favourite name and rounded pct; null for no moneyline or 50', () => {
  assert.equal(winPctText({ home: 'A', away: 'B', home_win_pct: 36 }), 'B 64%');
  assert.equal(winPctText({ home: 'A', away: 'B', home_win_pct: null }), null);
  assert.equal(winPctText({ home: 'A', away: 'B', home_win_pct: 50 }), null);
});

// ---- the NBA feed shaping ----
test('moneylines de-vig to the same home win % the football path computes', () => {
  assert.ok(Math.abs(impliedFromAmerican(-150) - 0.6) < 1e-9);
  assert.ok(Math.abs(impliedFromAmerican(130) - 100 / 230) < 1e-9);
  const m = shapeFeedMoneylines([{ game_id: 9, vendor: 'x', moneyline_home_odds: -150, moneyline_away_odds: 130 }]);
  assert.equal(homeWinPct(m.get('9')), 58);
});

test('shapeFeedMoneylines: draftkings preferred, a one-sided or missing line is absent', () => {
  const m = shapeFeedMoneylines([
    { game_id: 1, vendor: 'betmgm', moneyline_home_odds: -110, moneyline_away_odds: -110 },
    { game_id: 1, vendor: 'draftkings', moneyline_home_odds: -200, moneyline_away_odds: 170 },
    { game_id: 2, vendor: 'draftkings', moneyline_home_odds: -200, moneyline_away_odds: null },
    { game_id: 3, vendor: 'draftkings' },
  ]);
  assert.deepEqual([...m.keys()], ['1']);
  assert.equal(homeWinPct(m.get('1')), 64);
});

test('nbaMoneylines / nbaRecords map feed ids back to our ids; empty in, empty out', async () => {
  const feed = {
    readOddsMany: async (ids) => { assert.deepEqual(ids, ['g1']); return [{ game_id: 'g1', vendor: 'draftkings', moneyline_home_odds: -150, moneyline_away_odds: 130 }]; },
    readStandings: async () => [{ team: { id: 'b1' }, wins: 4, losses: 1 }, { team: { id: 'b2' }, wins: 0, losses: 0 }],
  };
  const ml = await nbaMoneylines(new Map([[10, 'g1'], [11, null]]), feed);
  assert.deepEqual([...ml.keys()], [10]);
  const rec = await nbaRecords(new Map([[1, 'b1'], [2, 'b2'], [3, 'b9']]), 2026, feed);
  assert.deepEqual([...rec], [[1, '4-1']], '0-0 and unknown teams stay absent');
  assert.equal((await nbaMoneylines(new Map(), feed)).size, 0);
  assert.equal((await nbaRecords(new Map(), 2026, feed)).size, 0);
});
