// lib/daily/boardScheduling.test.mjs — board-level dedup and the season-
// recency schedule, including the hand-provable N-vs-window result.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boardIdentity, drawDistinctBoards, seasonEligibleOn, simulateSeasonSchedule, RECENCY_WINDOW_DAYS } from './boardScheduling.js';
import { buildCard } from './boardGenerator.js';
import { makeRng } from './pool.js';

test('boardIdentity is order-independent - the same 12 teams shuffled twice are the same board', () => {
  const a = [{ key: 'C' }, { key: 'A' }, { key: 'B' }];
  const b = [{ key: 'B' }, { key: 'C' }, { key: 'A' }];
  assert.equal(boardIdentity(a), boardIdentity(b));
  assert.notEqual(boardIdentity(a), boardIdentity([{ key: 'A' }, { key: 'B' }, { key: 'D' }]));
});

test('seasonEligibleOn: a season not in recent history is eligible, one that is is not', () => {
  assert.equal(seasonEligibleOn(2023, [2020, 2021, 2022]), true);
  assert.equal(seasonEligibleOn(2023, [2021, 2022, 2023]), false);
});

function richTeamCards(n) {
  const cards = new Map();
  for (let i = 0; i < n; i++) {
    const key = `T${i}`;
    cards.set(key, buildCard([
      { team_key: key, position: 'QB', pass_yds: 3000 + i, pass_td: 20, pass_int: 5 },
      { team_key: key, position: 'RB', rush_yds: 900 + i, rush_td: 6 },
      { team_key: key, position: 'WR', rec: 70, rec_yds: 900 + i, rec_td: 6 },
      { team_key: key, position: 'PK', fgm: 25, xp: 30 },
    ]));
  }
  return cards;
}

test('drawDistinctBoards over a rich pool finds `count` genuinely distinct boards with room to spare', () => {
  const cards = richTeamCards(32);
  const { boards, attempts, seasonExhausted } = drawDistinctBoards(cards, makeRng('sched-1'), { count: 30 });
  assert.equal(boards.length, 30, 'a 32-team pool drawing 12 at a time should never struggle to find 30 distinct sets');
  assert.equal(seasonExhausted, false);
  const ids = boards.map((b) => boardIdentity(b.teams));
  assert.equal(new Set(ids).size, 30, 'every board actually is distinct, not just under quota');
  assert.ok(attempts >= 30, 'at least one attempt per board found');
});

test('drawDistinctBoards stops honestly when the season itself cannot field a board', () => {
  const cards = richTeamCards(10); // fewer than TEAM_COUNT (12)
  const { boards, seasonExhausted } = drawDistinctBoards(cards, makeRng('sched-2'), { count: 5 });
  assert.equal(boards.length, 0);
  assert.equal(seasonExhausted, true);
});

// ---------------------------------------------------------------------------
// THE HAND-PROVABLE RESULT. With N seasons and a W-day recency window,
// N < W: day 0..N-1 must each use a season never used before (every prior
// pick is still inside its cooldown for as long as the elapsed days stay
// under W), so all N get used exactly once by day N-1. At day N, EVERY
// season was used within the last N (<W) days, so the eligible set is empty
// and the schedule is stuck. This holds for ANY tie-breaking the RNG makes -
// only WHICH remaining season is picked is random, not WHETHER one is
// available - so sustainedDays = N is deterministic, not a seed-dependent
// observation.
// ---------------------------------------------------------------------------
test('N seasons < a W-day window: the schedule sustains EXACTLY N days, then is provably stuck', () => {
  for (const N of [5, 27, 29]) {
    const seasons = Array.from({ length: N }, (_, i) => 1990 + i);
    const res = simulateSeasonSchedule(seasons, { days: N + 10, windowDays: 30, rng: makeRng(`stuck-${N}`) });
    assert.equal(res.stuck, true, `N=${N}`);
    assert.equal(res.sustainedDays, N, `N=${N}: hand proof says exactly N days, got ${res.sustainedDays}`);
    assert.equal(new Set(res.order).size, N, 'every season really was used exactly once before the wall');
  }
});

test('N seasons >= a W-day window: the schedule never gets stuck, sustains the full run', () => {
  const seasons = Array.from({ length: 30 }, (_, i) => 1990 + i); // N == W
  const res = simulateSeasonSchedule(seasons, { days: 400, windowDays: RECENCY_WINDOW_DAYS, rng: makeRng('never-stuck') });
  assert.equal(res.stuck, false);
  assert.equal(res.sustainedDays, 400);
});

test('a single season with a real window always gets stuck immediately on day 1', () => {
  const res = simulateSeasonSchedule([1999], { days: 10, windowDays: 30, rng: makeRng('one-season') });
  assert.equal(res.stuck, true);
  assert.equal(res.sustainedDays, 1, 'day 0 uses the only season; day 1 finds it still on cooldown');
});
