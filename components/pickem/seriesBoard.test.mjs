// components/pickem/seriesBoard.test.mjs - the round board, MOUNTED.
//
// THE ROW IS A SERIES, and that is what these assertions are about: a running
// record rather than a score, wins rather than runs, one lock for the round
// rather than one per game, and a grade that only appears once the SERIES is
// decided - not when a game is.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACTION = path.join(__dirname, '__series_action_stub.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec.endsWith('app/actions/seriesPickem')) return { url: pathToFileURL(ACTION).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, SeriesBoard, createRoot, act, dom, action;
const roots = new Set();
before(async () => {
  writeFileSync(ACTION, [
    'export const calls = [];',
    'export let reply = { ok: true };',
    'export function setReply(r) { reply = r; }',
    'export async function saveSeriesPickAction(contestId, seriesKey, teamId) {',
    '  calls.push({ contestId, seriesKey, teamId }); return reply;',
    '}',
  ].join('\n') + '\n');
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'https://sportsvyn.test/pickem/mlb' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react'); ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  SeriesBoard = (await import('./SeriesBoard.js')).default;
  action = await import(pathToFileURL(ACTION).href);
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { try { unlinkSync(ACTION); } catch { /* gone */ } });

const team = (id, abbr, name, seed, extra = {}) => ({
  team_id: id, abbr, name, seed, colors: { primary: '#111111', secondary: '#EEEEEE' },
  wins: 0, picked: false, winner: false, ...extra,
});

const ROWS = () => [
  { seriesKey: 'division:LAD-PHI', stage: 'division', bestOf: 5, points: 2,
    firstPitch: '2026-10-04T20:08:00Z', status: 'live', record: '2-1', nextGame: 4, graded: null,
    teams: [team(1, 'PHI', 'Phillies', 2, { wins: 1 }), team(2, 'LAD', 'Dodgers', 3, { wins: 2, picked: true })] },
  { seriesKey: 'division:CHC-MIL', stage: 'division', bestOf: 5, points: 2,
    firstPitch: '2026-10-04T18:08:00Z', status: 'final', record: '3-2', nextGame: null, graded: 'L',
    teams: [team(3, 'MIL', 'Brewers', 1, { wins: 3, winner: true }), team(4, 'CHC', 'Cubs', 4, { wins: 2, picked: true })] },
];

const CONTEST = (o = {}) => ({
  id: 77, season: 2026, week: 2, stage: 'division', label: 'Division Series',
  pointsPerPick: 2, locksAt: '2026-10-04T18:08:00Z', maxPoints: 8,
  phase: 'open', made: 2, total: 2, score: null, ...o,
});

const html = (props) => renderToStaticMarkup(React.createElement(SeriesBoard, props));

test('A ROW IS A SERIES: a record, wins, and the round\'s points', () => {
  const h = html({ contest: CONTEST(), rows: ROWS(), signedIn: true });
  assert.match(h, /<h2>Division Series<\/h2>/);
  assert.match(h, /Best of 5 · <b>2<\/b> points a series/);
  assert.equal([...h.matchAll(/data-series="([^"]+)"/g)].map((m) => m[1]).length, 2);
  // THE RUNNING RECORD, not a score. A series is 2-1.
  assert.match(h, /<span class="sb-live">2-1 · G4 next<\/span>/);
  assert.match(h, /<span class="sb-rec">3-2<\/span>/);
  // WINS IN THE SERIES on each side, and the points on the row.
  assert.match(h, /<b class="sb-w">2<\/b>/);
  assert.match(h, /<span class="sb-pts">\+2<\/span>/);
  // A LIVE SERIES CARRIES THE RED EDGE, the same mark a live game does.
  assert.match(h, /class="sb-row live"/);
});

test('THE GRADE APPEARS WHEN THE SERIES IS DECIDED, not when a game is', () => {
  const h = html({ contest: CONTEST(), rows: ROWS(), signedIn: true });
  // The live 2-1 row carries NO grade - a lead is not a result.
  const live = h.slice(h.indexOf('data-series="division:LAD-PHI"'), h.indexOf('data-series="division:CHC-MIL"'));
  assert.doesNotMatch(live, /sb-grade/);
  // The decided one does, and it is an L because the pick lost.
  assert.match(h, /<span class="sb-grade l">L<\/span>/);
  assert.match(h, /class="sb-side on"/, 'and the pick is still marked');
  assert.match(h, /class="sb-side on won"|class="sb-side won"/);
});

test('SIGNED OUT THE BOARD IS READ-ONLY, and says how to change that', () => {
  const h = html({ contest: CONTEST(), rows: ROWS(), signedIn: false, signinHref: '/signin?next=x' });
  assert.match(h, /<a class="sb-cta" href="\/signin\?next=x">Sign in to pick<\/a>/);
  // Every side disabled - no pick leaves or arrives without a session.
  assert.equal([...h.matchAll(/<button[^>]*class="sb-side[^"]*"[^>]*disabled/g)].length, 4);
});

test('A LOCKED ROUND SEALS EVERY SIDE AND SAYS WHY', () => {
  const h = html({ contest: CONTEST({ phase: 'locked' }), rows: ROWS(), signedIn: true });
  assert.equal([...h.matchAll(/<button[^>]*class="sb-side[^"]*"[^>]*disabled/g)].length, 4);
  assert.match(h, /The round has started\. Picks are sealed/);
  assert.doesNotMatch(h, /Sign in to pick/);
});

test('A SETTLED BOARD SHOWS POINTS, not a pick count', () => {
  const h = html({ contest: CONTEST({ phase: 'settled', score: 5 }), rows: ROWS(), signedIn: true });
  assert.match(h, /<b>5<\/b> of 8/);
  assert.doesNotMatch(h, /picked/);
});

test('THE SERVER\'S ANSWER WINS: a refused pick is repainted, with its reason', async () => {
  const el = document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  action.calls.length = 0;
  action.setReply({ ok: true });
  await act(async () => {
    root.render(React.createElement(SeriesBoard,
      { contest: CONTEST(), rows: ROWS(), signedIn: true }));
  });
  const row = el.querySelector('[data-series="division:LAD-PHI"]');
  const [phi, lad] = row.querySelectorAll('.sb-side');
  assert.ok(lad.className.includes('on'), 'LAD is the stored pick');

  // AN ACCEPTED TAP PAINTS AND STAYS.
  await act(async () => { phi.click(); });
  assert.ok(row.querySelectorAll('.sb-side')[0].className.includes('on'));
  assert.deepEqual(action.calls.at(-1), { contestId: 77, seriesKey: 'division:LAD-PHI', teamId: 1 });

  // A REFUSED ONE PAINTS, THEN GOES BACK, and says why. An optimistic paint
  // the server rejects must not be left standing as a pick the reader
  // believes they made.
  action.setReply({ ok: false, reason: 'round_locked' });
  await act(async () => { row.querySelectorAll('.sb-side')[1].click(); });
  const after2 = el.querySelector('[data-series="division:LAD-PHI"]').querySelectorAll('.sb-side');
  assert.ok(after2[0].className.includes('on'), 'the earlier pick is restored');
  assert.ok(!after2[1].className.includes('on'));
  assert.match(el.textContent, /The round has started - picks are sealed\./);
});
