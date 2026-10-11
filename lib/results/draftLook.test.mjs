// lib/results/draftLook.test.mjs - the weekly Draft's results in the shared result screen (sun-3). PURE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyDraftResultProps } from './draftLook.js';

const v = {
  played: true, week: 6,
  header: { score: 101.4, rank: 3, roomRank: 2, roomOf: 12 },
  field: { played: 40 },
  roomSeats: [
    { seat: 1, score: 110, user: false }, { seat: 2, score: 101.4, user: true }, { seat: 3, score: 101.4, user: false },
    ...Array.from({ length: 9 }, (_, i) => ({ seat: i + 4, score: 80 - i, user: false })),
  ],
  myPicks: [
    { overall: 2, pos: 'RB', name: 'A', points: 30, counted: true, at: '1.02', gapLabel: '+1 value' },
    { overall: 23, pos: 'WR', name: 'B', points: 3, counted: false, at: '2.11', gapLabel: null },
    { overall: 26, pos: 'WR', name: 'C', points: 20, counted: true, at: '3.02', gapLabel: '-4 reach' },
  ],
};

test('the weekly results map onto the Game Drafts result screen', () => {
  const p = weeklyDraftResultProps(v);
  assert.equal(p.eyebrow, 'THE DRAFT · NFL WEEK 6 · FINAL');
  assert.equal(p.points, 101.4);
  assert.equal(p.placeLine, 'points · 2nd of 12', 'a tie with seat 3 shares 2nd');
  assert.equal(p.topLine, 'Top 8% of everyone who drafted this week');
  assert.deepEqual(p.players.map((x) => [x.name, x.counted]), [['A', true], ['C', true], ['B', false]]);
  assert.equal(p.players[0].sub, '1.02 · +1 value');
  assert.equal(p.room.length, 12);
  assert.deepEqual(p.room.slice(0, 3).map((s) => [s.label, s.place]), [['Seat 1', '1st'], ['You', '2nd'], ['Seat 3', '2nd']]);
  assert.equal(p.back.href, '/draft');
});

test('no entry, no look: the field view stays', () => {
  assert.equal(weeklyDraftResultProps({ ...v, played: false }), null);
  assert.equal(weeklyDraftResultProps(null), null);
});
