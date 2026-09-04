// lib/daily/seasonBoardRuns.test.mjs - buildRosterFromPicks is PURE and gets
// its own tests here; submitRun's DB path is proved by scripts/daily-board-
// run-sentinel.mjs against a real DEV board (a sentinel user, never a real
// one - see that script's own header).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRosterFromPicks } from './seasonBoardRuns.js';

const SLOTS3 = ['QB', 'RB', 'FLEX'];

function board() {
  return {
    board: [
      { key: 'T1', card: [{ position: 'QB', name: 'Q One', points: 20, meta: '' }] },
      { key: 'T2', card: [{ position: 'RB', name: 'R One', points: 15, meta: '' }] },
      { key: 'T3', card: [{ position: 'WR', name: 'W One', points: 12, meta: '' }] },
    ],
  };
}

test('a fully legal picks[] builds a roster with no gaps', () => {
  const picks = [
    { slotIndex: 0, teamKey: 'T1', playerName: 'Q One' },
    { slotIndex: 1, teamKey: 'T2', playerName: 'R One' },
    { slotIndex: 2, teamKey: 'T3', playerName: 'W One' }, // WR is FLEX-eligible
  ];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, true);
  assert.equal(r.roster[2].pick.player.name, 'W One');
  assert.equal(r.used.size, 3);
});

test('refuses a team not on this board - a client cannot invent a team', () => {
  const picks = [
    { slotIndex: 0, teamKey: 'GHOST', playerName: 'Nobody' },
    { slotIndex: 1, teamKey: 'T2', playerName: 'R One' },
    { slotIndex: 2, teamKey: 'T3', playerName: 'W One' },
  ];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, false);
  assert.match(r.reason, /not on this board/);
});

test('refuses a player not on the named team\'s card', () => {
  const picks = [
    { slotIndex: 0, teamKey: 'T1', playerName: 'W One' }, // W One is on T3, not T1
    { slotIndex: 1, teamKey: 'T2', playerName: 'R One' },
    { slotIndex: 2, teamKey: 'T3', playerName: 'W One' },
  ];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, false);
  assert.match(r.reason, /is not on/);
});

test('refuses an ineligible slot - a QB cannot fill RB', () => {
  const picks = [
    { slotIndex: 0, teamKey: 'T1', playerName: 'Q One' },
    { slotIndex: 1, teamKey: 'T1', playerName: 'Q One' }, // same team AND wrong position
    { slotIndex: 2, teamKey: 'T3', playerName: 'W One' },
  ];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, false);
});

test('refuses the same team used twice', () => {
  const picks = [
    { slotIndex: 0, teamKey: 'T1', playerName: 'Q One' },
    { slotIndex: 1, teamKey: 'T2', playerName: 'R One' },
    { slotIndex: 2, teamKey: 'T2', playerName: 'R One' },
  ];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, false);
  assert.match(r.reason, /used more than once/);
});

test('refuses a short picks array - every slot must be filled', () => {
  const picks = [{ slotIndex: 0, teamKey: 'T1', playerName: 'Q One' }];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, false);
});
