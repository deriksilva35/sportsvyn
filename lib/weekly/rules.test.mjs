// lib/weekly/rules.test.mjs - the Weekly's laws. PURE.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  saveVerdict, isLocked, validateLineup, normalizeLineup, settleReadiness, SLOTS,
} = await import('./rules.js');

const POOL = [
  { id: 1, name: 'QB One', pos: 'QB' }, { id: 2, name: 'QB Two', pos: 'QB' },
  { id: 3, name: 'RB One', pos: 'RB' }, { id: 4, name: 'RB Two', pos: 'RB' },
  { id: 5, name: 'WR One', pos: 'WR' }, { id: 6, name: 'WR Two', pos: 'WR' },
  { id: 7, name: 'TE One', pos: 'TE' },
];
const FULL = { QB: 1, RB: 3, WR: 5, TE: 7, FLEX: 4, FLEX2: 6 };
const LOCK = '2026-09-10T20:20:00Z';
const at = (iso) => new Date(iso);

// ---------------------------------------------------------------------------
// THE LOCK LAW
// ---------------------------------------------------------------------------

test('LOCK LAW: a save one millisecond after lock is REFUSED', () => {
  assert.equal(saveVerdict(LOCK, at('2026-09-10T20:19:59.999Z')).ok, true);
  assert.equal(saveVerdict(LOCK, new Date(Date.parse(LOCK))).ok, false, 'exactly at lock is locked');
  assert.equal(saveVerdict(LOCK, new Date(Date.parse(LOCK) + 1)).ok, false);
  assert.equal(saveVerdict(LOCK, new Date(Date.parse(LOCK) + 1)).reason, 'locked');
});

test('LOCK LAW: NO GRACE PERIOD, unlike the Daily', () => {
  // The Daily grants 10s because a lock request travels at the end of a
  // three-minute sprint. A weekly deadline has been visible for five days; a
  // grace window on it is just a later deadline nobody was told about.
  assert.equal(saveVerdict(LOCK, new Date(Date.parse(LOCK) + 1_000)).ok, false);
  assert.equal(saveVerdict(LOCK, new Date(Date.parse(LOCK) + 9_000)).ok, false);
});

test('LOCK LAW: a missing lock time refuses rather than defaulting open', () => {
  assert.equal(saveVerdict(null).ok, false);
  assert.equal(saveVerdict('not-a-date').ok, false);
  assert.equal(saveVerdict(undefined).reason, 'no lock time');
});

test('LOCK LAW: isLocked is the same verdict, inverted', () => {
  assert.equal(isLocked(LOCK, at('2026-09-09T00:00:00Z')), false);
  assert.equal(isLocked(LOCK, at('2026-09-11T00:00:00Z')), true);
});

test('MOVED KICKOFF: the lock does not chase the schedule', () => {
  // locks_at is snapshotted at board creation. If Thursday's game moves, the
  // deadline players planned around is still the deadline - so the SAME
  // locks_at value keeps producing the same verdicts regardless of what the
  // schedule now says. This asserts the function reads only what it is given.
  const planned = '2026-09-10T20:20:00Z';
  const movedEarlier = '2026-09-10T17:00:00Z';
  const movedLater = '2026-09-11T00:30:00Z';
  const t = at('2026-09-10T19:00:00Z');   // after the earlier time, before the planned one
  assert.equal(saveVerdict(planned, t).ok, true, 'still open against the snapshotted deadline');
  assert.equal(saveVerdict(movedEarlier, t).ok, false, 'and would have been shut had it chased');
  assert.equal(saveVerdict(movedLater, t).ok, true);
});

// ---------------------------------------------------------------------------
// LINEUP VALIDATION
// ---------------------------------------------------------------------------

test('a full, legal lineup passes', () => {
  assert.deepEqual(validateLineup(FULL, POOL), { ok: true, errors: [], filled: 6 });
});

test('PARTIAL IS LEGAL before lock - this is a draft you come back to', () => {
  const r = validateLineup({ QB: 1, RB: 3 }, POOL);
  assert.equal(r.ok, true);
  assert.equal(r.filled, 2);
});

test('completeness is asked at SETTLE, and can be asked here on demand', () => {
  const r = validateLineup({ QB: 1, RB: 3 }, POOL, { requireComplete: true });
  assert.equal(r.ok, false);
  assert.equal(r.errors.filter((e) => e.endsWith('empty')).length, 4);
});

test('a player outside this week\'s pool is refused', () => {
  const r = validateLineup({ ...FULL, QB: 999 }, POOL);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /not in this week's pool/);
});

test('slot eligibility holds: FLEX takes RB/WR/TE, never QB', () => {
  assert.equal(validateLineup({ ...FULL, FLEX: 2 }, POOL).ok, false);
  assert.match(validateLineup({ ...FULL, FLEX: 2 }, POOL).errors.join(' '), /QB cannot fill FLEX/);
});

test('the same player cannot fill two slots', () => {
  const r = validateLineup({ ...FULL, FLEX2: 4 }, POOL);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /already in the lineup/);
});

test('normalizeLineup drops junk rather than rejecting the whole save', () => {
  // A stale client sending a traded-away player should not lose the other five
  // slots, so the save path normalises and then validates.
  const out = normalizeLineup({ QB: 1, RB: 999, WR: 5, BENCH: 3, TE: null }, POOL);
  assert.deepEqual(out, { QB: 1, WR: 5 });
});

test('normalizeLineup refuses to duplicate a player across slots', () => {
  assert.deepEqual(normalizeLineup({ RB: 3, FLEX: 3 }, POOL), { RB: 3 });
});

test('the slot list is the Daily\'s, shared not copied', () => {
  assert.deepEqual(SLOTS, ['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX2']);
});

// ---------------------------------------------------------------------------
// THE SETTLE GATE
// ---------------------------------------------------------------------------

const g = (id, label, status, statLines) => ({ id, label, status, statLines });

test('SETTLE: a complete week is ready', () => {
  const r = settleReadiness([g(1, 'A@B', 'final', 110), g(2, 'C@D', 'final', 98)]);
  assert.equal(r.ready, true);
  assert.equal(r.games, 2);
});

test('SETTLE REFUSES on one game not final, and NAMES it', () => {
  const r = settleReadiness([g(1, 'A@B', 'final', 110), g(2, 'C@D', 'live', 40)]);
  assert.equal(r.ready, false);
  assert.equal(r.reason, 'games not final');
  assert.deepEqual(r.missing.map((m) => m.label), ['C@D']);
});

test('SETTLE REFUSES on a final game with NO STAT LINES - the negative control', () => {
  // This is the one that matters. Every game final and the numbers absent is
  // exactly what a late BDL looks like, and settling then produces a perfect
  // lineup that is not perfect and scores quietly low for anyone who started a
  // player from that game.
  const r = settleReadiness([g(1, 'A@B', 'final', 110), g(2, 'C@D', 'final', 0)]);
  assert.equal(r.ready, false);
  assert.equal(r.reason, 'stat lines missing');
  assert.deepEqual(r.missing, [{ id: 2, label: 'C@D', why: 'final, no stat lines' }]);
});

test('SETTLE names EVERY missing game, not just the first', () => {
  const r = settleReadiness([g(1, 'A@B', 'final', 0), g(2, 'C@D', 'live', 0), g(3, 'E@F', 'final', 90)]);
  assert.equal(r.ready, false);
  assert.equal(r.missing.length, 2);
});

test('SETTLE refuses an empty week rather than declaring it complete', () => {
  // An empty list satisfies "every game is final" vacuously. That would settle
  // a week whose schedule failed to load, with a perfect lineup of nothing.
  assert.equal(settleReadiness([]).ready, false);
  assert.equal(settleReadiness(null).ready, false);
  assert.equal(settleReadiness([]).reason, 'no games');
});
