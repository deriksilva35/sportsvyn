// lib/mlb/schedule.test.mjs - the slug a game is written with, and the order
// the writes go in. PURE; the same rules through the real writer against DEV
// are lib/mlb/resync.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMlbSlug, planSlugs, slugWriteOrder, slugsFor } from './schedule.js';

const g = (id, date, away = 'BAL', home = 'NYY') => ({ id, date, away_team: { abbreviation: away }, home_team: { abbreviation: home } });
const shuffleEvery = (xs) => [xs, [...xs].reverse()];

test('parseMlbSlug reads the day, the clubs and the game number, and nothing else', () => {
  assert.deepEqual(parseMlbSlug('mlb-2026-09-25-bal-nyy'), { day: '2026-09-25', away: 'bal', home: 'nyy', n: 1 });
  assert.deepEqual(parseMlbSlug('mlb-2026-09-25-bal-nyy-g2'), { day: '2026-09-25', away: 'bal', home: 'nyy', n: 2 });
  assert.equal(parseMlbSlug('mlb-2026-09-25-bal-nyy-moving-5060179'), null, 'a parked slug is no slug');
  assert.equal(parseMlbSlug('nfl-2026-w3-kc-buf'), null);
});

test('A NEW DOUBLEHEADER: base to the earlier game, -g2 to the later, in EITHER order BDL lists them', () => {
  for (const rows of shuffleEvery([g(2, '2026-09-25T23:05:00Z'), g(1, '2026-09-25T20:05:00Z')])) {
    const p = planSlugs(rows);
    assert.equal(p.get('1'), 'mlb-2026-09-25-bal-nyy');
    assert.equal(p.get('2'), 'mlb-2026-09-25-bal-nyy-g2');
  }
  // and the first import agrees with the old rule, which is what PROD was written with
  const rows = [g(1, '2026-09-25T20:05:00Z'), g(2, '2026-09-25T23:05:00Z')];
  assert.deepEqual(planSlugs(rows), slugsFor(rows));
});

test('THE MOVED GAME 1 (25 Sep, BAL @ NYY): the row already on Friday keeps its slug; the moved game takes -g2', () => {
  const existing = new Map([
    ['5060160', { slug: 'mlb-2026-09-25-bal-nyy' }],        // Friday 23:05, on readers' screens
    ['5060179', { slug: 'mlb-2026-09-26-bal-nyy' }],        // filed Saturday, moved into Friday 20:05
  ]);
  for (const rows of shuffleEvery([g(5060160, '2026-09-25T23:05:00Z'), g(5060179, '2026-09-25T20:05:00Z')])) {
    const p = planSlugs(rows, existing);
    assert.equal(p.get('5060160'), 'mlb-2026-09-25-bal-nyy', 'never renamed');
    assert.equal(p.get('5060179'), 'mlb-2026-09-25-bal-nyy-g2', 'the second row filed under Friday');
    const order = slugWriteOrder(p, new Map([...existing].map(([b, e]) => [b, e.slug])));
    assert.ok(order.every((s) => !s.temp), 'nothing to park: no two rows want the same slug');
  }
});

test('A NEW MAKEUP ID (TOR @ BAL, 23 Sep) on a day whose game is already filed takes the next suffix', () => {
  const existing = new Map([['5060132', { slug: 'mlb-2026-09-23-tor-bal' }]]);
  for (const rows of shuffleEvery([g(5060132, '2026-09-23T22:35:00Z', 'TOR', 'BAL'), g(15156303, '2026-09-23T17:35:00Z', 'TOR', 'BAL')])) {
    const p = planSlugs(rows, existing);
    assert.equal(p.get('5060132'), 'mlb-2026-09-23-tor-bal');
    assert.equal(p.get('15156303'), 'mlb-2026-09-23-tor-bal-g2');
  }
});

test('a slug held OUTSIDE the batch is never taken; a moved row releases its old one', () => {
  const p = planSlugs([g(9, '2026-09-25T20:05:00Z')], new Map(), new Set(['mlb-2026-09-25-bal-nyy']));
  assert.equal(p.get('9'), 'mlb-2026-09-25-bal-nyy-g2');
  // game 7 moves off Saturday; the new game 8 on Saturday may have its slug
  const existing = new Map([['7', { slug: 'mlb-2026-09-26-bal-nyy' }]]);
  const q = planSlugs([g(7, '2026-09-25T20:05:00Z'), g(8, '2026-09-26T23:15:00Z')], existing);
  assert.equal(q.get('7'), 'mlb-2026-09-25-bal-nyy');
  assert.equal(q.get('8'), 'mlb-2026-09-26-bal-nyy');
  const order = slugWriteOrder(q, new Map([['7', 'mlb-2026-09-26-bal-nyy']]));
  assert.deepEqual(order.map((s) => s.bdl), ['7', '8'], 'the row vacating a slug is written before the row taking it');
});

test('A SWAP IS BROKEN BY PARKING ONE ROW, and every row still ends on its planned slug', () => {
  const plan = new Map([['1', 'mlb-2026-09-25-bal-nyy-g2'], ['2', 'mlb-2026-09-25-bal-nyy']]);
  const current = new Map([['1', 'mlb-2026-09-25-bal-nyy'], ['2', 'mlb-2026-09-25-bal-nyy-g2']]);
  const order = slugWriteOrder(plan, current);
  assert.equal(order.filter((s) => s.temp).length, 1);
  // replay it: no step may take a slug another row holds at that moment
  const held = new Map([...current].map(([b, s]) => [s, b]));
  const at = new Map(current);
  for (const s of order) {
    const h = held.get(s.slug);
    assert.ok(h == null || h === s.bdl, `step ${JSON.stringify(s)} collides with ${h}`);
    held.delete(at.get(s.bdl)); held.set(s.slug, s.bdl); at.set(s.bdl, s.slug);
  }
  assert.equal(at.get('1'), plan.get('1')); assert.equal(at.get('2'), plan.get('2'));
});
