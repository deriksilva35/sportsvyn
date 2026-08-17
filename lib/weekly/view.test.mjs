// lib/weekly/view.test.mjs - the Weekly's state machine and settled view. PURE.
//
// THE STATE MACHINE IS WHAT DECIDES WHICH SURFACE A READER GETS, so the cases
// worth pinning are the boundaries: the instant of lock, a settled week with no
// entry, and the case that would be a leak if it went wrong - a week that has
// locked but not settled must never render anybody's score.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { weeklyState, timeToLock, lineupRows, settledView } = await import('./view.js');
const { tierFor } = await import('../daily/reveal.js');

const LOCKS = '2026-09-11T00:20:00Z';
const before = new Date('2026-09-08T12:00:00Z');
const after = new Date('2026-09-13T12:00:00Z');

test('no contest renders nothing, not an empty frame', () => {
  assert.equal(weeklyState({ contest: null }), 'none');
  assert.equal(weeklyState({}), 'none');
});

test('rules before an entry exists, building once it does', () => {
  const contest = { locks_at: LOCKS };
  assert.equal(weeklyState({ contest, entry: null, now: before }), 'rules');
  assert.equal(weeklyState({ contest, entry: { id: 1 }, now: before }), 'building');
});

test('THE LOCK IS AN INSTANT, not a window - the boundary is inclusive', () => {
  const contest = { locks_at: LOCKS };
  const t = new Date(LOCKS).getTime();
  assert.equal(weeklyState({ contest, entry: { id: 1 }, now: new Date(t - 1) }), 'building');
  assert.equal(weeklyState({ contest, entry: { id: 1 }, now: new Date(t) }), 'locked',
    'at exactly locks_at the week is locked, matching saveVerdict');
  assert.equal(weeklyState({ contest, entry: { id: 1 }, now: new Date(t + 1) }), 'locked');
});

test('a locked week with NO entry is still locked - it does not fall back to rules', () => {
  // Otherwise someone arriving after kickoff would be shown a builder for a
  // week they can no longer enter, and every save would 409.
  assert.equal(weeklyState({ contest: { locks_at: LOCKS }, entry: null, now: after }), 'locked');
});

test('settled beats everything, including a lock time in the future', () => {
  // Belt and braces: if a week is somehow settled early, the reveal is the
  // correct surface. A builder over a settled contest could accept saves.
  assert.equal(weeklyState({ contest: { locks_at: LOCKS, settled: true }, now: before }), 'settled');
});

test('timeToLock decomposes, and clamps at zero rather than going negative', () => {
  const t = timeToLock(LOCKS, before);
  assert.deepEqual([t.days, t.hours, t.mins], [2, 12, 20]);
  assert.equal(t.locked, false);
  const done = timeToLock(LOCKS, after);
  assert.equal(done.locked, true);
  assert.equal(done.ms, 0);
  assert.equal(timeToLock(null), null, 'a contest with no lock time is not a countdown of NaN');
  assert.equal(timeToLock('not a date'), null);
});

test('lineupRows returns one row per slot whether filled or not', () => {
  const board = [{ id: 7, name: 'A Player', pos: 'QB', team: 'KC' }];
  const rows = lineupRows({ QB: 7 }, board);
  assert.equal(rows.length, 6, 'six slots, always');
  assert.equal(rows[0].name, 'A Player');
  assert.equal(rows[1].name, null, 'an empty slot is a row, not a gap');
  assert.deepEqual(rows.map((r) => r.slot), ['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX2']);
});

test('LINEUP KEY ORDER CANNOT LEAK THROUGH - the locked card walks SLOTS', () => {
  // The locked surface first shipped using Object.entries(lineup), and lineup is
  // jsonb: the keys come back in whatever order they were written. A player who
  // filled TE before WR saw their card listed QB, RB, TE, WR, FLEX, FLEX.
  const board = [
    { id: 1, name: 'Q', pos: 'QB' }, { id: 2, name: 'R', pos: 'RB' },
    { id: 3, name: 'W', pos: 'WR' }, { id: 4, name: 'T', pos: 'TE' },
  ];
  const scrambled = { TE: 4, QB: 1, FLEX2: null, WR: 3, RB: 2 };
  assert.deepEqual(lineupRows(scrambled, board).map((r) => r.slot),
    ['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX2']);
  assert.deepEqual(lineupRows(scrambled, board).map((r) => r.name),
    ['Q', 'R', 'W', 'T', null, null]);
});

test('lineupRows survives a lineup naming a player who is not on the board', () => {
  const rows = lineupRows({ QB: 999 }, [{ id: 7, name: 'A', pos: 'QB' }]);
  assert.equal(rows[0].name, null);
});

// ---------------------------------------------------------------------------
// THE SETTLED VIEW
// ---------------------------------------------------------------------------

const BOARD = [
  { id: 1, name: 'QB One', pos: 'QB', team: 'KC', points: 25.4 },
  { id: 2, name: 'RB One', pos: 'RB', team: 'SF', points: 18.2 },
  { id: 3, name: 'WR One', pos: 'WR', team: 'MIN', points: 22.0 },
  { id: 4, name: 'TE One', pos: 'TE', team: 'BAL', points: 9.1 },
  { id: 5, name: 'RB Two', pos: 'RB', team: 'DET', points: 14.6 },
  { id: 6, name: 'WR Two', pos: 'WR', team: 'CIN', points: 3.2 },
];
const CONTEST = {
  season_year: 2026, week: 1, settled: true, perfect: { total: 120.0, picks: [] },
};
const LINEUP = { QB: 1, RB: 2, WR: 3, TE: 4, FLEX: 5, FLEX2: 6 };

test('settledView pairs your six against the perfect, with the drop marked', () => {
  const v = settledView({
    contest: CONTEST,
    entry: { lineup: LINEUP, score: 89.3, meta: { droppedSlot: 'FLEX2' } },
    board: BOARD,
  });
  assert.equal(v.you.score, 89.3);
  assert.equal(v.perfect, 120);
  assert.equal(v.you.picks.length, 6);
  assert.equal(v.you.picks.find((p) => p.slot === 'FLEX2').dropped, true);
  assert.equal(v.you.picks.filter((p) => p.dropped).length, 1, 'exactly one pick is dropped');
  assert.equal(v.you.picks[0].points, 25.4);
});

test('THE TIERS ARE THE DAILY\'S, from the same tierFor', () => {
  // This is what makes a Weekly PRO BOWLER worth the same season points as a
  // Daily one. If the Weekly ever grew its own ladder the standings spine
  // would be adding unlike things together.
  const v = settledView({
    contest: CONTEST, entry: { lineup: LINEUP, score: 89.3, meta: {} }, board: BOARD,
  });
  assert.equal(v.you.tier, tierFor(89.3, 120).label);
  assert.equal(v.you.pct, tierFor(89.3, 120).pct);
});

test('no entry means no `you` block - nulls are not a result', () => {
  const v = settledView({ contest: CONTEST, entry: null, board: BOARD });
  assert.equal(v.you, null);
  assert.equal(v.dnf, false, 'not entering is not a DNF');
});

test('an entry with no score is a DNF and carries no picks', () => {
  const v = settledView({
    contest: CONTEST, entry: { lineup: LINEUP, score: null, meta: {} }, board: BOARD,
  });
  assert.equal(v.dnf, true);
  assert.equal(v.you, null, 'a DNF must not render a scoreline');
});

test('a missing perfect total does not become a zero denominator', () => {
  const v = settledView({
    contest: { season_year: 2026, week: 1, perfect: null },
    entry: { lineup: LINEUP, score: 89.3, meta: {} }, board: BOARD,
  });
  assert.equal(v.perfect, null);
  assert.equal(v.you.pct, null, 'no perfect means no percentage, not Infinity or NaN');
});

// ---------------------------------------------------------------------------
// THE POOL ORDER
// ---------------------------------------------------------------------------
// These exist because the Weekly's board measured 1,269 players against the
// Daily's 64, and activePool emits ORDER BY np.id. 153 quarterbacks in
// insertion order is not a builder.

const { poolRows } = await import('./view.js');

const RES = (ppg, rest = '120 g · Somewhere') => `${ppg} PPG · ${rest}`;
const POOL = [
  { id: 1, name: 'Mid QB', pos: 'QB', resume: RES('18.5') },
  { id: 2, name: 'Best QB', pos: 'QB', resume: RES('24.1') },
  { id: 3, name: 'Rookie QB', pos: 'QB', resume: null },
  { id: 4, name: 'Low QB', pos: 'QB', resume: RES('9.2') },
  { id: 5, name: 'A Back', pos: 'RB', resume: RES('15.0') },
  { id: 6, name: 'A Receiver', pos: 'WR', resume: RES('16.4') },
  { id: 7, name: 'A End', pos: 'TE', resume: RES('11.1') },
];

test('poolRows sorts a position tab by PPG, best first', () => {
  const names = poolRows(POOL, 'QB').map((p) => p.name);
  assert.deepEqual(names, ['Best QB', 'Mid QB', 'Low QB', 'Rookie QB']);
});

test('A BLANK PPG SORTS LAST, not first - a blank is not a zero and not a lead', () => {
  // Number.parseFloat('') is NaN, and NaN comparisons return false: left alone
  // the sort strands these rows wherever they happened to be, which on the real
  // board means a rookie with no career games leading the tab.
  const rows = poolRows(POOL, 'QB');
  assert.equal(rows[rows.length - 1].name, 'Rookie QB');
  assert.ok(rows.every((p) => p.name != null), 'no row is dropped by the sort');
});

test('poolRows respects the slot filter, and FLEX mixes three positions', () => {
  assert.deepEqual(poolRows(POOL, 'WR').map((p) => p.name), ['A Receiver']);
  // FLEX takes RB/WR/TE and sorts them against each other, which is the whole
  // point of the tab - you are comparing across positions there.
  assert.deepEqual(poolRows(POOL, 'FLEX').map((p) => p.name),
    ['A Receiver', 'A Back', 'A End']);
  assert.deepEqual(poolRows(POOL, 'FLEX2').map((p) => p.name),
    ['A Receiver', 'A Back', 'A End'], 'both flex tabs read identically');
});

test('poolRows does not mutate the board it was handed', () => {
  // board is the frozen contest snapshot, shared by every render and every
  // slot tab. An in-place sort here would reorder it for everyone.
  const before = POOL.map((p) => p.id);
  poolRows(POOL, 'QB'); poolRows(POOL, 'FLEX');
  assert.deepEqual(POOL.map((p) => p.id), before);
});

test('poolRows survives an absent board', () => {
  assert.deepEqual(poolRows(null, 'QB'), []);
  assert.deepEqual(poolRows(undefined, 'QB'), []);
});

// ---------------------------------------------------------------------------
// THE POOL SEARCH
// ---------------------------------------------------------------------------
// A filter on the Weekly's 1,269-row board only. The Daily's 64-row board does
// NOT get one - the scan under a three-minute clock is that game.

const SEARCH_POOL = [
  { id: 1, name: 'Josh Allen', pos: 'QB', resume: RES('22.2') },
  { id: 2, name: 'Keenan Allen', pos: 'WR', resume: RES('14.8') },
  { id: 3, name: 'Braelon Allen', pos: 'RB', resume: RES('6.1') },
  { id: 4, name: 'JuJu Smith-Schuster', pos: 'WR', resume: RES('10.2') },
  { id: 5, name: 'Amon-Ra St. Brown', pos: 'WR', resume: RES('19.4') },
  { id: 6, name: 'Brandon Aiyuk', pos: 'WR', resume: RES('13.0') },
  { id: 7, name: 'Travis Kelce', pos: 'TE', resume: RES('16.6') },
];

test('an empty query changes nothing', () => {
  for (const q of ['', '   ', undefined]) {
    assert.equal(poolRows(SEARCH_POOL, 'WR', q).length,
      poolRows(SEARCH_POOL, 'WR').length, `query ${JSON.stringify(q)} must be a no-op`);
  }
});

test('THE FILTER IS SCOPED TO THE ACTIVE TAB - "Allen" on WR is not Josh Allen', () => {
  // The tab is the question and the query narrows it. Returning a QB here would
  // offer a pick that is illegal for the slot the reader is filling.
  assert.deepEqual(poolRows(SEARCH_POOL, 'WR', 'allen').map((p) => p.name), ['Keenan Allen']);
  assert.deepEqual(poolRows(SEARCH_POOL, 'QB', 'allen').map((p) => p.name), ['Josh Allen']);
  assert.deepEqual(poolRows(SEARCH_POOL, 'RB', 'allen').map((p) => p.name), ['Braelon Allen']);
});

test('FLEX searches across its three positions, still PPG-sorted', () => {
  const names = poolRows(SEARCH_POOL, 'FLEX', 'allen').map((p) => p.name);
  assert.deepEqual(names, ['Keenan Allen', 'Braelon Allen'], 'WR 14.8 before RB 6.1');
});

test('matching is case-insensitive and matches mid-name, not just the start', () => {
  assert.equal(poolRows(SEARCH_POOL, 'TE', 'KELCE').length, 1);
  assert.equal(poolRows(SEARCH_POOL, 'TE', 'elc').length, 1, 'substring, not prefix');
});

test('PUNCTUATION IS FOLDED - "smith schuster" and "st brown" are what people type', () => {
  assert.equal(poolRows(SEARCH_POOL, 'WR', 'smith schuster')[0].name, 'JuJu Smith-Schuster');
  assert.equal(poolRows(SEARCH_POOL, 'WR', 'smith-schuster')[0].name, 'JuJu Smith-Schuster');
  assert.equal(poolRows(SEARCH_POOL, 'WR', 'st brown')[0].name, 'Amon-Ra St. Brown');
  assert.equal(poolRows(SEARCH_POOL, 'WR', 'st. brown')[0].name, 'Amon-Ra St. Brown');
  assert.equal(poolRows(SEARCH_POOL, 'WR', 'amon ra')[0].name, 'Amon-Ra St. Brown');
});

test('DIACRITICS ARE FOLDED BOTH WAYS - a phone keyboard cannot type most of them', () => {
  const pool = [{ id: 9, name: 'Amon-Ré Ståhl', pos: 'WR', resume: RES('9.9') }];
  assert.equal(poolRows(pool, 'WR', 'stahl').length, 1, 'plain query finds accented name');
  assert.equal(poolRows(pool, 'WR', 'ståhl').length, 1, 'accented query still finds it');
});

test('THE RESUME IS NOT SEARCHED - a reader is looking for a person', () => {
  // Matching the college would mean typing a name silently competes with every
  // product of that school. RES() puts "Somewhere" in every resume line.
  assert.equal(poolRows(SEARCH_POOL, 'WR', 'somewhere').length, 0);
  assert.equal(poolRows(SEARCH_POOL, 'WR', '120').length, 0, 'nor the games-played figure');
});

test('a query matching nothing returns an empty array, not everything', () => {
  // The failure direction matters: falling back to the full pool would look
  // like the filter silently gave up.
  assert.deepEqual(poolRows(SEARCH_POOL, 'WR', 'zzzzz'), []);
});

test('search still respects the board being absent', () => {
  assert.deepEqual(poolRows(null, 'WR', 'allen'), []);
});
