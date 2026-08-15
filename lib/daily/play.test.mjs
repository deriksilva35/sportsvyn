// lib/daily/play.test.mjs - the rules of an entry. PURE, no DB, no clock.
//
// The clock law is the one that has to be right: a browser timer is a courtesy,
// and everything here tests the verdict the SERVER reaches from a stored
// timestamp it issued.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  clockVerdict, validateLineup, scoreLineup, bonusFor, applyBonus, bandFor,
  slotAccepts, nextOpenSlot, SLOTS, CLOCK_MS, GRACE_MS, BONUS,
} = await import('./play.js');

// A minimal board: enough of each position to fill six slots and misfill them.
const BOARD = [
  { id: 1, name: 'QB One', pos: 'QB', points: 25 },
  { id: 2, name: 'QB Two', pos: 'QB', points: 18 },
  { id: 3, name: 'RB One', pos: 'RB', points: 20 },
  { id: 4, name: 'RB Two', pos: 'RB', points: 12 },
  { id: 5, name: 'WR One', pos: 'WR', points: 30 },
  { id: 6, name: 'WR Two', pos: 'WR', points: 8 },
  { id: 7, name: 'TE One', pos: 'TE', points: 15 },
  { id: 8, name: 'TE Two', pos: 'TE', points: 3 },
];
const GOOD = { QB: 1, RB: 3, WR: 5, TE: 7, FLEX: 4, FLEX2: 6 };

// ---------------------------------------------------------------------------
// THE CLOCK - server law
// ---------------------------------------------------------------------------

const at = (ms) => new Date(1_000_000 + ms);
const START = at(0).toISOString();

test('CLOCK: inside two minutes is fine', () => {
  assert.equal(clockVerdict(START, at(0)).ok, true);
  assert.equal(clockVerdict(START, at(119_000)).ok, true);
  assert.equal(clockVerdict(START, at(CLOCK_MS)).ok, true, 'exactly 2:00 is not late');
});

test('CLOCK: the 10s grace is real, and it is applied to the DEADLINE', () => {
  assert.equal(clockVerdict(START, at(CLOCK_MS + GRACE_MS)).ok, true, '2:10 still lands');
  assert.equal(clockVerdict(START, at(CLOCK_MS + GRACE_MS + 1)).ok, false, 'a millisecond past is late');
  assert.equal(GRACE_MS, 10_000, 'the ruling, not a feel');
});

test('CLOCK: a late lock is REFUSED however good the lineup is', () => {
  const v = clockVerdict(START, at(600_000)); // ten minutes
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'too late');
  assert.equal(v.elapsedMs, 600_000, 'and it reports how late, for the log');
});

test('CLOCK: a start time in the FUTURE is refused - the server issued it', () => {
  const v = clockVerdict(at(50_000).toISOString(), at(0));
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'start time is in the future');
});

test('CLOCK: a missing or unparseable start is refused, not defaulted', () => {
  assert.equal(clockVerdict(null).ok, false);
  assert.equal(clockVerdict('not-a-date').ok, false);
  assert.equal(clockVerdict(undefined).reason, 'no start time');
});

// ---------------------------------------------------------------------------
// LINEUP VALIDATION
// ---------------------------------------------------------------------------

test('a well-formed lineup passes', () => {
  assert.deepEqual(validateLineup(GOOD, BOARD), { ok: true, errors: [] });
});

test('slot eligibility: FLEX takes RB/WR/TE, never QB', () => {
  for (const p of ['RB', 'WR', 'TE']) {
    assert.equal(slotAccepts('FLEX', p), true);
    assert.equal(slotAccepts('FLEX2', p), true);
  }
  assert.equal(slotAccepts('FLEX', 'QB'), false, 'a superflex is a different game');
  assert.equal(slotAccepts('QB', 'RB'), false);
});

test('a player cannot occupy two slots', () => {
  const r = validateLineup({ ...GOOD, FLEX2: 4 }, BOARD); // RB Two in FLEX and FLEX2
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /already in the lineup/);
});

test('a player who is not on the board is refused', () => {
  const r = validateLineup({ ...GOOD, QB: 999 }, BOARD);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /not on today's board/);
});

test('EVERY failure is named, not just the first', () => {
  const r = validateLineup({ QB: 3, RB: null, WR: 5, TE: 7, FLEX: 1, FLEX2: 6 }, BOARD);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 3, 'a QB slot with an RB, an empty RB slot, and a QB in FLEX');
  assert.match(r.errors.join(' '), /QB: a RB cannot fill QB/);
  assert.match(r.errors.join(' '), /RB: empty/);
  assert.match(r.errors.join(' '), /FLEX: a QB cannot fill FLEX/);
});

test('an unknown slot key is refused rather than ignored', () => {
  const r = validateLineup({ ...GOOD, K: 1 }, BOARD);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /unknown slot: K/);
});

test('the slot list is the six the product specified', () => {
  assert.deepEqual(SLOTS, ['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX2']);
});

// ---------------------------------------------------------------------------
// DROP-WORST SCORING - against hand fixtures
// ---------------------------------------------------------------------------

test('DROP-WORST: six filled, five counted, and the dropped one is named', () => {
  // 25 + 20 + 30 + 15 + 12 + 8, worst is WR Two at 8.
  const r = scoreLineup(GOOD, BOARD);
  assert.equal(r.baseScore, 25 + 20 + 30 + 15 + 12, 'hand sum of the five best');
  assert.equal(r.baseScore, 102);
  assert.equal(r.droppedSlot, 'FLEX2');
  assert.equal(r.picks.filter((p) => p.dropped).length, 1);
  assert.equal(r.picks.find((p) => p.dropped).name, 'WR Two');
});

test('DROP-WORST: the drop follows the SCORE, not the slot', () => {
  // TE Two at 3 is now the worst, in the TE slot.
  const r = scoreLineup({ ...GOOD, TE: 8 }, BOARD);
  assert.equal(r.droppedSlot, 'TE');
  assert.equal(r.baseScore, 25 + 20 + 30 + 12 + 8);
});

test('DROP-WORST: a tie for worst drops exactly one', () => {
  const board = BOARD.map((p) => ({ ...p, points: 10 }));
  const r = scoreLineup(GOOD, board);
  assert.equal(r.picks.filter((p) => p.dropped).length, 1);
  assert.equal(r.baseScore, 50, 'five of six tens');
});

test('scoring rounds to one decimal, like everything else that shows a score', () => {
  const board = BOARD.map((p) => ({ ...p, points: 3.33 }));
  const r = scoreLineup(GOOD, board);
  assert.equal(r.baseScore, 16.7, '5 x 3.33 = 16.65 -> 16.7');
});

// ---------------------------------------------------------------------------
// THE GUESS BONUS
// ---------------------------------------------------------------------------

test('BONUS: both > season > week > nothing', () => {
  const truth = { season: 2017, week: 4 };
  assert.equal(bonusFor({ season: 2017, week: 4 }, truth), BONUS.both);
  assert.equal(bonusFor({ season: 2017, week: 9 }, truth), BONUS.season);
  assert.equal(bonusFor({ season: 2019, week: 4 }, truth), BONUS.week);
  assert.equal(bonusFor({ season: 2019, week: 9 }, truth), BONUS.none);
  assert.ok(BONUS.both > BONUS.season && BONUS.season > BONUS.week && BONUS.week > 0);
});

test('BONUS: no guess is no bonus, and does not throw', () => {
  assert.equal(bonusFor(null, { season: 2017, week: 4 }), 0);
  assert.equal(bonusFor({}, { season: 2017, week: 4 }), 0);
});

test('BONUS: string input from a form select still compares', () => {
  assert.equal(bonusFor({ season: '2017', week: '4' }, { season: 2017, week: 4 }), BONUS.both);
});

test('applyBonus multiplies the base and rounds to 1dp', () => {
  assert.equal(applyBonus(102, 0.10), 112.2);
  assert.equal(applyBonus(102, 0), 102);
});

// ---------------------------------------------------------------------------
// PERCENTILE BANDS
// ---------------------------------------------------------------------------

test('BANDS: the top score is Top 5%', () => {
  const all = Array.from({ length: 100 }, (_, i) => i);
  assert.equal(bandFor(99, all), 'Top 5%');
});

test('BANDS: ties share a band - two equal scores never read differently', () => {
  const all = [50, 50, 50, 10];
  assert.equal(bandFor(50, all), bandFor(50, all));
  assert.equal(bandFor(50, all), 'Top 5%', 'nobody is strictly better than a 50 here');
});

test('BANDS: the floor is a band, not a rank', () => {
  const all = Array.from({ length: 100 }, (_, i) => i);
  assert.equal(bandFor(0, all), 'Bottom half');
  // And the labels never contain a position or a name.
  for (const s of [0, 40, 70, 90, 99]) {
    assert.equal(/#|\d+(st|nd|rd|th)/.test(bandFor(s, all)), false, 'a band is not a leaderboard');
  }
});

test('BANDS: an empty field or a missing score gives null, not a fake band', () => {
  assert.equal(bandFor(10, []), null);
  assert.equal(bandFor(null, [1, 2, 3]), null);
});

test('BANDS: the only entrant is in the top band', () => {
  assert.equal(bandFor(42, [42]), 'Top 5%');
});

// ---------------------------------------------------------------------------
// AUTO-ADVANCE - focus after a pick
// ---------------------------------------------------------------------------
// SLOTS is ['QB','RB','WR','TE','FLEX','FLEX2'].

test('AUTO-ADVANCE: an empty board walks the slots in order', () => {
  assert.equal(nextOpenSlot('QB', { QB: 1 }), 'RB');
  assert.equal(nextOpenSlot('RB', { QB: 1, RB: 2 }), 'WR');
  assert.equal(nextOpenSlot('TE', { QB: 1, RB: 2, WR: 3, TE: 4 }), 'FLEX');
});

test('AUTO-ADVANCE SKIPS FILLED SLOTS - the whole point of the fix', () => {
  // Player filled WR and TE by tapping those slots directly, then fills QB.
  // Focus must jump the two filled slots and land on the first real gap.
  assert.equal(nextOpenSlot('QB', { QB: 1, WR: 3, TE: 4 }), 'RB');
  assert.equal(nextOpenSlot('RB', { QB: 1, RB: 2, WR: 3, TE: 4 }), 'FLEX');
});

test('AUTO-ADVANCE WRAPS past the end of the slot list', () => {
  // Filling the LAST slot with QB still open sends focus back to the top.
  assert.equal(nextOpenSlot('FLEX2', { WR: 3, TE: 4, FLEX: 5, FLEX2: 6 }), 'QB');
  assert.equal(nextOpenSlot('FLEX', { QB: 1, WR: 3, TE: 4, FLEX: 5, FLEX2: 6 }), 'RB');
});

test('AUTO-ADVANCE stands still on a complete board rather than jumping somewhere arbitrary', () => {
  const full = { QB: 1, RB: 2, WR: 3, TE: 4, FLEX: 5, FLEX2: 6 };
  for (const s of SLOTS) assert.equal(nextOpenSlot(s, full), s);
});

test('AUTO-ADVANCE never returns the slot just filled while another is open', () => {
  // The regression that would make the fix a no-op: computing from the OLD
  // lineup leaves the just-filled slot looking empty, and focus never moves.
  for (const from of SLOTS) {
    const next = nextOpenSlot(from, { [from]: 99 });
    assert.notEqual(next, from, `${from} must hand focus on when five slots are still open`);
    assert.ok(SLOTS.includes(next));
  }
});

test('AUTO-ADVANCE tolerates an unknown slot and a missing lineup', () => {
  assert.equal(nextOpenSlot('NOPE', {}), 'QB', 'unknown origin falls back to the first open slot');
  assert.equal(nextOpenSlot('QB', null), 'RB', 'a null lineup is an empty one, not a crash');
  assert.equal(nextOpenSlot('QB', undefined), 'RB');
});
