// components/scores/expandCard.test.mjs - the arcade card's drawer, in a DOM (scores-v4 step 2).
//
// THE ORDER IS THE CONTRACT: the line score is on screen the moment the card
// opens, from the row, BEFORE the fetch answers; the key moments and the last
// plays arrive with it. A closed card never reads; a live card re-reads on
// every open, a final reads once.
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

let React, act, createRoot, ExpandCard; const roots = new Set();
before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://sportsvyn.test/scores' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
  ExpandCard = (await import('./ExpandCard.js')).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });

const LINE = { columns: ['1', '2'], rows: [{ side: 'away', abbr: 'PHI', cells: ['0', '3'], total: 3, extra: [] }, { side: 'home', abbr: 'CHI', cells: ['7', '0'], total: 7, extra: [] }], total: 'T', extra: [] };
const PAYLOAD = { status: 'live', line: LINE,
  scoring: [{ when: 'Q1 9:12', abbr: 'CHI', text: 'Williams 12 pass to Odunze', score: '0-7' }],
  last: [{ when: 'Q2 4:10', text: 'Hurts 4 yd run' }, { when: 'Q2 4:50', text: 'Hurts pass incomplete' }] };

function mount(props) {
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el); roots.add(root);
  act(() => root.render(React.createElement(ExpandCard, { articleProps: { className: 'sv4-card live', 'data-slug': 'g-7' }, league: 'nfl', slug: 'g-7', label: 'PHI at CHI', gameHref: '/nfl/game/g-7', line: LINE, ...props }, React.createElement('div', { className: 'face' }, 'face'))));
  return el;
}
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };

test('closed: the face only, no drawer, no read', () => {
  const calls = [];
  const el = mount({ fetcher: (u) => { calls.push(u); return Promise.resolve(PAYLOAD); } });
  assert.equal(el.querySelector('article').dataset.open, '0');
  assert.equal(el.querySelector('.sv4-x'), null);
  assert.equal(el.querySelector('.face').textContent, 'face');
  assert.equal(calls.length, 0);
});

test('open: the line score from the row BEFORE the fetch answers, then the moments and the last plays', async () => {
  const d = deferred(); const calls = [];
  const el = mount({ live: true, fetcher: (u) => { calls.push(u); return d.p; } });
  act(() => el.querySelector('button.sv4-hit').click());
  assert.deepEqual(calls, ['/api/scores/expand/nfl/g-7']);
  assert.equal(el.querySelector('.sv4-hit').getAttribute('aria-expanded'), 'true');
  const rows = [...el.querySelectorAll('.sv4-ls tbody tr')].map((r) => r.textContent);
  assert.deepEqual(rows, ['PHI033', 'CHI707'], 'the line is drawn before any answer');
  assert.ok(el.querySelector('[data-loading="1"]'));
  assert.equal(el.querySelector('[data-x="scoring"]'), null);
  await act(async () => { d.resolve(PAYLOAD); await d.p; });
  assert.equal(el.querySelector('[data-loading="1"]'), null);
  assert.match(el.querySelector('[data-x="scoring"]').textContent, /Q1 9:120-7CHI Williams 12 pass to Odunze/);
  assert.equal(el.querySelectorAll('[data-x="last"] li').length, 2);
  assert.equal(el.querySelector('.sv4-xgo').getAttribute('href'), '/nfl/game/g-7');
});

test('a live card re-reads on every open; a final reads once', async () => {
  for (const [live, want] of [[true, 2], [false, 1]]) {
    const calls = [];
    const el = mount({ live, fetcher: (u) => { calls.push(u); return Promise.resolve(PAYLOAD); } });
    const btn = () => el.querySelector('button.sv4-hit');
    await act(async () => { btn().click(); });
    await act(async () => { btn().click(); });           // close
    await act(async () => { btn().click(); });           // open again
    assert.equal(calls.length, want, live ? 'live: every open' : 'final: once');
  }
});

test('a failed read says so and keeps the line', async () => {
  const el = mount({ fetcher: () => Promise.reject(new Error('503')) });
  await act(async () => { el.querySelector('button.sv4-hit').click(); });
  assert.ok(el.querySelector('.sv4-ls'));
  assert.match(el.querySelector('.sv4-x').textContent, /did not load/);
});

test('no line on the row: the drawer opens without a table and waits for the read', async () => {
  const d = deferred();
  const el = mount({ line: null, fetcher: () => d.p });
  act(() => el.querySelector('button.sv4-hit').click());
  assert.equal(el.querySelector('.sv4-ls'), null);
  await act(async () => { d.resolve(PAYLOAD); await d.p; });
  assert.ok(el.querySelector('.sv4-ls'), 'the payload\'s line fills in');
});

test('EPL is not expandable: one link to the match page, no button', () => {
  const el = mount({ expandable: false, league: 'epl', gameHref: '/match/g-5' });
  assert.equal(el.querySelector('button'), null);
  assert.equal(el.querySelector('a.sv4-hit').getAttribute('href'), '/match/g-5');
});
