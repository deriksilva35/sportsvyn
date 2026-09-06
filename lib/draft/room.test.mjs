// lib/draft/room.test.mjs - seatForPick() is the inverse of lib/draft/view.js's
// snakePick(). PURE, no DB - the DB-backed roomStandings() itself is proved
// against a real 12-seat room in lib/weekly/replay.test.mjs, alongside the
// settle path it is meant to run inside.

import test from 'node:test';
import assert from 'node:assert/strict';
import { seatForPick } from './room.js';

// The same formula lib/draft/view.js's snakePick(seat, round, teamsCount)
// encodes forward - reproduced here, not imported, so this test can assert
// seatForPick is its TRUE inverse rather than merely agreeing with itself.
function snakePick(seat, round, teamsCount) {
  return round % 2 === 1
    ? (round - 1) * teamsCount + seat
    : (round - 1) * teamsCount + (teamsCount - seat + 1);
}

test('seatForPick inverts snakePick for every seat, every round, a 12-team room', () => {
  const teamsCount = 12;
  for (let round = 1; round <= 8; round++) {
    for (let seat = 1; seat <= teamsCount; seat++) {
      const overall = snakePick(seat, round, teamsCount);
      assert.equal(seatForPick(overall, round, teamsCount), seat,
        `round ${round}, seat ${seat} -> overall ${overall}`);
    }
  }
});

test('odd rounds run left to right, even rounds reverse (the snake)', () => {
  assert.equal(seatForPick(1, 1, 12), 1, 'round 1 pick 1 is seat 1');
  assert.equal(seatForPick(12, 1, 12), 12, 'round 1 pick 12 is seat 12');
  assert.equal(seatForPick(13, 2, 12), 12, 'round 2 pick 1 (overall 13) is seat 12');
  assert.equal(seatForPick(24, 2, 12), 1, 'round 2 pick 12 (overall 24) is seat 1');
});
