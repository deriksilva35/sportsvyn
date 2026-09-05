// lib/weekly/homeModule.test.mjs - the Weekly's homepage module. PURE.
//
// THESE ASSERT ON THE SERIALIZED VIEW, not on the shape in memory, because the
// homepage renders for signed-out strangers and half the internet. The question
// this file exists to answer is what is ABSENT: a field that is missing cannot
// be printed by a component that forgets to check, and JSON.stringify is the
// only check that proves missing rather than falsy.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { weeklyHomeView } = await import('./homeModule.js');
const { tierFor } = await import('../daily/reveal.js');

const OPENS = '2026-09-08T13:00:00Z';
const LOCKS = '2026-09-11T00:20:00Z';
const OPEN = { season_year: 2026, week: 1, opens_at: OPENS, locks_at: LOCKS, settled: false };
const during = new Date('2026-09-09T12:00:00Z');
const afterLock = new Date('2026-09-12T12:00:00Z');
const SIX = { QB: 1, RB: 2, WR: 3, TE: 4, FLEX: 5, FLEX2: 6 };

const wire = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// ABSENCE
// ---------------------------------------------------------------------------

test('NO BOARD, NO MODULE - an empty frame on the homepage is worse than none', () => {
  assert.equal(weeklyHomeView({ contest: null }), null);
  assert.equal(weeklyHomeView({}), null);
});

test('a board that has not OPENED yet renders nothing', () => {
  // Boards are created ahead of their open time; a module that appeared the
  // moment a row was inserted would announce next week's board early.
  assert.equal(weeklyHomeView({ contest: OPEN, now: new Date('2026-09-07T12:00:00Z') }), null);
});

test('NO SCORE FIELD EXISTS BEFORE SETTLE, in any pre-settle state', () => {
  // Not a null score - no key at all. contest_entries.score is null until the
  // settle job runs, so a score on this surface would be an invention.
  for (const [label, args] of [
    ['play', { contest: OPEN, entry: null, now: during }],
    ['building', { contest: OPEN, entry: { lineup: SIX }, now: during }],
    ['locked', { contest: OPEN, entry: { lineup: SIX }, now: afterLock }],
  ]) {
    const v = wire(weeklyHomeView(args));
    assert.equal('score' in v, false, `${label} must not carry a score`);
    assert.equal('perfect' in v, false, `${label} must not carry a perfect total`);
    assert.equal('tier' in v, false, `${label} must not carry a tier`);
    assert.equal('pct' in v, false, `${label} must not carry a percentage`);
  }
});

test('NO OTHER PLAYER APPEARS, in any state', () => {
  const settled = { ...OPEN, settled: true, perfect: { score: 140 } };
  for (const args of [
    { contest: OPEN, entry: null, now: during },
    { contest: OPEN, entry: { lineup: SIX }, now: during },
    { contest: OPEN, entry: { lineup: SIX }, now: afterLock },
    { contest: settled, entry: { lineup: SIX, score: 91.2 }, now: afterLock },
  ]) {
    const s = JSON.stringify(weeklyHomeView(args));
    for (const k of ['entrants', 'winner', 'rank', 'standings', 'handle', 'user_id', 'userId']) {
      assert.equal(s.includes(k), false, `${k} has no business on this surface: ${s}`);
    }
  }
});

test('EVERY STATE HAS AN EXACT KEY SET, and a new field has to be argued for', () => {
  // THIS ASSERTS THE WHOLE SHAPE, not the absence of a list of names I happened
  // to think of. The first version of this test grepped the serialized view for
  // player ids and failed on `"week":1` matching the substring `:1,` - a leak
  // test that fires on its own fixture is worse than no leak test, because the
  // next person makes it pass by loosening it. An exact key set cannot be
  // fooled by a substring and it catches fields nobody predicted: add anything
  // to this view and this test fails until someone looks at it.
  const settled = { ...OPEN, settled: true, perfect: { score: 140 } };
  const cases = [
    [{ contest: OPEN, entry: null, now: during }, ['season', 'week', 'href', 'state', 'locksAt']],
    [{ contest: OPEN, entry: { lineup: SIX }, now: during },
      ['season', 'week', 'href', 'state', 'filled', 'remaining', 'locksAt']],
    [{ contest: OPEN, entry: { lineup: SIX }, now: afterLock },
      ['season', 'week', 'href', 'state', 'filled', 'entered']],
    [{ contest: settled, entry: { lineup: SIX, score: 91.2 }, now: afterLock },
      ['season', 'week', 'href', 'state', 'played', 'score', 'perfect', 'tier', 'pct']],
    [{ contest: settled, entry: null, now: afterLock },
      ['season', 'week', 'href', 'state', 'played', 'perfect']],
  ];
  for (const [args, allowed] of cases) {
    const v = wire(weeklyHomeView(args));
    assert.deepEqual(Object.keys(v).sort(), [...allowed].sort(),
      `${v.state} carries an unexpected shape: ${JSON.stringify(v)}`);
  }
});

test('the lineup itself never reaches the wire - only a count of it', () => {
  // Which six a player chose is theirs until lock, and the homepage has no use
  // for it after. Player ids here are deliberately far from any week number so
  // a value collision cannot make this pass by accident.
  const far = { QB: 8801, RB: 8802, WR: 8803, TE: 8804, FLEX: 8805, FLEX2: 8806 };
  const s = JSON.stringify(weeklyHomeView({ contest: OPEN, entry: { lineup: far }, now: during }));
  assert.equal(s.includes('lineup'), false, 'no lineup key');
  assert.equal(/"(QB|RB|WR|TE|FLEX2?)"\s*:/.test(s), false, 'no slot keys');
  for (const id of Object.values(far)) {
    assert.equal(s.includes(String(id)), false, `player id ${id} leaked: ${s}`);
  }
});

// ---------------------------------------------------------------------------
// THE STATES
// ---------------------------------------------------------------------------

test('play: no entry at all', () => {
  const v = weeklyHomeView({ contest: OPEN, entry: null, now: during });
  assert.equal(v.state, 'play');
  assert.equal(v.week, 1);
  assert.equal(v.href, '/weekly');
});

test('AN EMPTY ENTRY IS STILL `play`, not `building`', () => {
  // saveLineup accepts a partial lineup, and an empty object is partial. A row
  // with nothing in it is somebody who opened the builder and left; telling
  // them they have 0/6 filled is worse than inviting them in.
  const v = weeklyHomeView({ contest: OPEN, entry: { lineup: {} }, now: during });
  assert.equal(v.state, 'play');
});

test('building counts what is filled and what remains', () => {
  const v = weeklyHomeView({ contest: OPEN, entry: { lineup: { QB: 1, RB: 2 } }, now: during });
  assert.equal(v.state, 'building');
  assert.equal(v.filled, 2);
  assert.equal(v.remaining, 4);
  assert.equal(v.locksAt, LOCKS, 'the deadline is the actionable fact here');
});

test('a complete lineup before lock is building with nothing remaining', () => {
  const v = weeklyHomeView({ contest: OPEN, entry: { lineup: SIX }, now: during });
  assert.equal(v.state, 'building');
  assert.deepEqual([v.filled, v.remaining], [6, 0]);
});

test('LOCKED IS THE STATE THE DAILY COULD NOT HAVE HAD', () => {
  // The Daily's round opens and closes inside one day, so it has no interval
  // where an entry is committed and unscoreable. The Weekly spends four days
  // there, and it is where a returning reader most often lands.
  const v = weeklyHomeView({ contest: OPEN, entry: { lineup: SIX }, now: afterLock });
  assert.equal(v.state, 'locked');
  assert.equal(v.entered, true);
  assert.equal(v.filled, 6);
});

test('locked with no entry says so rather than inviting a play that cannot happen', () => {
  const v = weeklyHomeView({ contest: OPEN, entry: null, now: afterLock });
  assert.equal(v.state, 'locked');
  assert.equal(v.entered, false);
  assert.equal(v.filled, 0);
});

test('the lock boundary is inclusive, matching saveVerdict and weeklyState', () => {
  const t = new Date(LOCKS).getTime();
  const e = { lineup: SIX };
  assert.equal(weeklyHomeView({ contest: OPEN, entry: e, now: new Date(t - 1) }).state, 'building');
  assert.equal(weeklyHomeView({ contest: OPEN, entry: e, now: new Date(t) }).state, 'locked');
});

test('settled reports the score against the perfect, on the Daily tier ladder', () => {
  const contest = { ...OPEN, settled: true, perfect: { score: 140 } };
  const v = weeklyHomeView({ contest, entry: { lineup: SIX, score: 91.2 }, now: afterLock });
  assert.equal(v.state, 'settled');
  assert.equal(v.played, true);
  assert.equal(v.score, 91.2);
  assert.equal(v.perfect, 140);
  assert.equal(v.pct, 65);
  assert.equal(v.tier, tierFor(91.2, 140).label, 'the same ladder as the Daily');
});

test('SETTLED BEATS LOCKED even if the clock disagrees', () => {
  const contest = { ...OPEN, settled: true, perfect: { score: 140 } };
  const v = weeklyHomeView({ contest, entry: { lineup: SIX, score: 91.2 }, now: during });
  assert.equal(v.state, 'settled', 'the settled flag is the authority, not the clock');
});

test('a DNF gets the perfect score as the yardstick, never a zero', () => {
  const contest = { ...OPEN, settled: true, perfect: { score: 140 } };
  const v = weeklyHomeView({ contest, entry: { lineup: SIX, score: null }, now: afterLock });
  assert.equal(v.state, 'settled');
  assert.equal(v.played, false);
  assert.equal(v.perfect, 140);
  assert.equal('score' in v, false, 'a zero would be a lie and a null would get printed');
});

test('someone who never entered a settled week sees the week, not a result', () => {
  const contest = { ...OPEN, settled: true, perfect: { score: 140 } };
  const v = weeklyHomeView({ contest, entry: null, now: afterLock });
  assert.equal(v.played, false);
  assert.equal(v.perfect, 140);
});

test('a settled week with no perfect total does not divide by zero', () => {
  const contest = { ...OPEN, settled: true, perfect: null };
  const v = weeklyHomeView({ contest, entry: { lineup: SIX, score: 91.2 }, now: afterLock });
  assert.equal(v.perfect, null);
  assert.equal(v.pct, null, 'no perfect means no percentage, not Infinity');
});
