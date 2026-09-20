// components/scores/yoursBand.test.mjs - the YOURS band, MOUNTED.
//
// lib/scores/yours.test.mjs proves the selection. This proves a reader sees
// it: the band has to reach the DOM as a real group with a real heading and
// real cards, and it has to be ABSENT signed out. A band that exists only in
// an array is the defect this codebase already shipped once with the app tab
// bar - the list was right and nothing rendered it.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
import { withYoursBand } from '../../lib/scores/yours.js';

install();

let React; let createRoot; let act; let ScoresV2; let dom;
const roots = new Set();

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'https://sportsvyn.test/scores' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.MutationObserver = dom.window.MutationObserver;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  ScoresV2 = (await import('./ScoresV2.js')).default;
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); document.getElementById('root').innerHTML = '';
});
after(() => { for (const r of roots) { try { r.unmount(); } catch { /* gone */ } } });

const KICK = '2026-09-19T19:30:00.000Z';
const game = (id, over = {}) => ({
  id, status: 'scheduled', kickoffAt: KICK, leagueSlug: 'cfb',
  homeScore: null, awayScore: null,
  home: { id: id * 10, abbreviation: 'HOM', name: 'Home Team' },
  away: { id: id * 10 + 1, abbreviation: 'AWY', name: 'Away Team' },
  ...over,
});
const STARRED = { pick: null, weekly: [], alerts: false, follow: 'home' };
const ALERTED = { pick: null, weekly: [], alerts: true, follow: null };

// THE SAME SHAPE scoresV2 BUILDS, per game. Card reads x.prob and friends
// unguarded, so an absent extras entry is a crash rather than a bare card -
// the fixture mirrors the real map instead of hoping undefined is tolerated.
const extraFor = (g, stake = null) => ({
  rank: { home: null, away: null },
  record: { home: null, away: null },
  spreadHome: null, total: null, preview: null, drive: null,
  stat: null, hasStats: false, prob: null, stake,
  open: g.status === 'scheduled',
});

function board(groups, { signedIn = true, stake = new Map() } = {}) {
  const v = {
    today: '2026-09-19', date: '2026-09-19', tz: 'America/New_York',
    sport: 'all', mine: false, top25: false, rankedToday: false,
    apWeek: null, apSeason: null, liveCount: 0, mineCount: 0,
    days: [], groups, liveAway: null,
    extras: new Map(groups.flatMap((grp) => grp.games.map((g) => [g.id, extraFor(g, stake.get(g.id) ?? null)]))),
  };
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(ScoresV2, {
    v, signedIn, isShell: false, zoneLabel: 'ET',
  })));
  return c;
}
const heads = (c) => [...c.querySelectorAll('.sv2-gh h2')].map((h) => h.textContent.trim());
const sections = (c) => [...c.querySelectorAll('.sv2-list')].map((l) => l.children.length);

test('THE BAND MOUNTS FIRST, WITH ITS CARDS', () => {
  const a = game(1, { status: 'live' });
  const b = game(2);
  const c3 = game(3);
  const groups = withYoursBand(
    [{ key: 'day', title: 'Today', sub: '3 games', games: [a, b, c3] }],
    { games: [a, b, c3], stake: new Map([[1, STARRED], [3, ALERTED]]), signedIn: true },
  );
  const c = board(groups);
  assert.deepEqual(heads(c), ['Yours', 'Today'], 'the band leads the board');
  // Two cards in the band, one left below - no card drawn twice.
  assert.deepEqual(sections(c), [2, 1]);
  const sub = c.querySelector('.sv2-gh small').textContent;
  assert.match(sub, /2 games/);
  assert.match(sub, /1 live/);
});

test('SIGNED OUT THE BAND IS NOT ON THE PAGE', () => {
  const a = game(1);
  const groups = withYoursBand(
    [{ key: 'day', title: 'Today', sub: '1 game', games: [a] }],
    { games: [a], stake: new Map([[1, STARRED]]), signedIn: false },
  );
  const c = board(groups, { signedIn: false });
  assert.deepEqual(heads(c), ['Today'], 'no YOURS heading at all');
  assert.equal(/Yours/i.test(c.textContent), false, 'and the word appears nowhere');
});

test('THE BAND DRAWS THE SAME CARD THE SLATE DOES - no redesign', () => {
  const a = game(1);
  const banded = withYoursBand(
    [{ key: 'day', title: 'Today', sub: '1 game', games: [a] }],
    { games: [a], stake: new Map([[1, STARRED]]), signedIn: true },
  );
  const inBand = board(banded).querySelector('.sv2-list').innerHTML;
  act(() => { for (const r of roots) r.unmount(); });
  roots.clear(); document.getElementById('root').innerHTML = '';

  const plain = board([{ key: 'day', title: 'Today', sub: '1 game', games: [a] }]);
  const inSlate = plain.querySelector('.sv2-list').innerHTML;
  assert.equal(inBand, inSlate, 'the card markup is byte-identical in both places');
});

test('NO CLAIM, NO BAND - the board renders exactly as before', () => {
  const a = game(1);
  const groups = withYoursBand(
    [{ key: 'day', title: 'Today', sub: '1 game', games: [a] }],
    { games: [a], stake: new Map(), signedIn: true },
  );
  const c = board(groups);
  assert.deepEqual(heads(c), ['Today']);
});
