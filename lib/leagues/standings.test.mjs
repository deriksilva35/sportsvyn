// lib/leagues/standings.test.mjs - the league table's rules (PURE): rank
// points, the thu-14 rulings (a) no entry = 0, (b) ties share the higher
// place, (c) the guillotine's double tie, drop-worst, movement, buckets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { competitionRanks, unitPoints, computeStandings, chop, ordinal } from './standings.js';
import { tuesdayOf, bucketUnit, shapeResults, bucketLabel } from './results.js';
import { buildTable } from './table.js';

const M = (...ids) => ids.map((id) => ({ userId: id, handle: `u${id}` }));
const R = (userId, score, { game = 'pickem', sport = 'nfl', period = 'w5', bucket = 'b1', final = true } = {}) =>
  ({ userId, score, game, sport, period, bucket, final });

test('(b) ties share the HIGHER place - competition ranking 1, 2, 2, 4', () => {
  const r = competitionRanks([{ key: 'a', value: 9 }, { key: 'b', value: 7 }, { key: 'c', value: 7 }, { key: 'd', value: 3 }]);
  assert.deepEqual([...r.values()], [1, 2, 2, 4]);
});

test('rank points: 1st scores N (the member count), tied places share the higher points', () => {
  const u = unitPoints([R(1, 9), R(2, 7), R(3, 7), R(4, 3)], { scoring: 'rank', memberCount: 5 });
  const by = [...u.values()][0].byUser;
  assert.deepEqual([1, 2, 3, 4].map((id) => by.get(id).points), [5, 4, 4, 2]);
});

test('(a) no entry in a period = 0 points - never ranked last, never ranked at all', () => {
  const s = computeStandings({ members: M(1, 2, 3), results: [R(1, 5), R(2, 1)], scoring: 'rank' });
  const pts = Object.fromEntries(s.rows.map((r) => [r.userId, r.total]));
  assert.deepEqual(pts, { 1: 3, 2: 2, 3: 0 }, 'the two who played rank 1st and 2nd of 3; the one who did not scores 0');
});

test('total points add the game\'s own score; a bundle adds rank points across games', () => {
  const tot = computeStandings({ members: M(1, 2), results: [R(1, 11.5), R(2, 9), R(1, 3, { period: 'w6', bucket: 'b2' })], scoring: 'total' });
  assert.deepEqual(tot.rows.map((r) => [r.userId, r.total]), [[1, 14.5], [2, 9]]);
  const bundle = computeStandings({
    members: M(1, 2), scoring: 'rank',
    results: [R(1, 10), R(2, 8), R(1, 50, { game: 'weekly' }), R(2, 90, { game: 'weekly' })],
  });
  assert.deepEqual(bundle.rows.map((r) => r.total), [3, 3], 'pickem 1st+weekly 2nd = weekly 1st+pickem 2nd');
  assert.deepEqual(bundle.rows.map((r) => r.place), [1, 1], 'level on points share the place');
});

test('drop-worst drops each member\'s lowest bucket - a missed bucket (0) is the one dropped', () => {
  const results = [R(1, 10, { bucket: 'b1' }), R(1, 2, { bucket: 'b2', period: 'w6' }), R(1, 7, { bucket: 'b3', period: 'w7' }),
    R(2, 9, { bucket: 'b1' }), R(2, 9, { bucket: 'b3', period: 'w7' })];
  const s = computeStandings({ members: M(1, 2), results, scoring: 'total', dropWorst: true });
  const by = Object.fromEntries(s.rows.map((r) => [r.userId, r]));
  assert.equal(by[1].total, 17); assert.equal(by[1].dropped, 'b2');
  assert.equal(by[2].total, 18); assert.equal(by[2].dropped, 'b2', 'the week they missed');
  const one = computeStandings({ members: M(1), results: [R(1, 4)], scoring: 'total', dropWorst: true });
  assert.equal(one.rows[0].total, 4, 'nothing is dropped from a single bucket');
});

test('movement is the place before the current bucket counted', () => {
  const s = computeStandings({
    members: M(1, 2), scoring: 'total',
    results: [R(1, 10, { bucket: 'b1' }), R(2, 5, { bucket: 'b1' }), R(2, 20, { bucket: 'b2', period: 'w6' })],
  });
  const by = Object.fromEntries(s.rows.map((r) => [r.userId, r]));
  assert.equal(by[2].move, 1); assert.equal(by[1].move, -1);
  assert.equal(computeStandings({ members: M(1), results: [R(1, 1)], scoring: 'total' }).rows[0].move, null);
});

test('a non-member\'s result is never on the table', () => {
  const s = computeStandings({ members: M(1), results: [R(1, 1), R(9, 99)], scoring: 'rank' });
  assert.deepEqual(s.rows.map((r) => r.userId), [1]);
  assert.equal(s.rows[0].total, 1, 'and does not take a place from a member (1 member: 1st = 1)');
});

test('(c) THE GUILLOTINE: lowest goes; a period tie goes to the higher season total; a double tie - all survive', () => {
  const members = M(1, 2, 3, 4);
  const by = new Map([
    [1, { b1: 10, b2: 5, b3: 9 }],
    [2, { b1: 8, b2: 5, b3: 9 }],
    [3, { b1: 3, b2: 9, b3: 9 }],
    [4, { b1: 9, b2: 7, b3: 1 }],
  ]);
  const out = chop({ members, finishedBuckets: ['b1', 'b2', 'b3'], byBucket: by });
  assert.deepEqual(out.map((c) => [c.userId, c.bucket]), [[3, 'b1'], [2, 'b2'], [4, 'b3']],
    'b1: 3 is lowest; b2: 1 and 2 tie on 5, 2 has the lower season (13 < 15); b3: 4');
  // Double tie: both on 5 in the bucket AND level on the season - nobody goes.
  const tie = chop({ members: M(1, 2, 3), finishedBuckets: ['b1'], byBucket: new Map([[1, { b1: 5 }], [2, { b1: 5 }], [3, { b1: 9 }]]) });
  assert.deepEqual(tie, [], 'ruling (c): both survive the bucket');
  // A decided bucket is never re-decided, and its chop stays out.
  const again = chop({ members, finishedBuckets: ['b1', 'b2'], byBucket: by, decided: [{ userId: 1, bucket: 'b1' }] });
  assert.deepEqual(again.map((c) => c.userId), [2], 'b1 stands as persisted (1 out, even though 3 scored lower now)');
  // Last one standing: nothing more to chop.
  const end = chop({ members: M(1, 2), finishedBuckets: ['b1', 'b2'], byBucket: new Map([[1, { b1: 1, b2: 1 }], [2, { b1: 2, b2: 2 }]]) });
  assert.deepEqual(end.map((c) => c.bucket), ['b1']);
});

test('buckets: Tuesday-to-Monday weeks, ET days; the unit follows the span and the games', () => {
  assert.equal(tuesdayOf('2026-10-08'), '2026-10-06', 'Thursday night belongs to the Tuesday week');
  assert.equal(tuesdayOf('2026-10-12'), '2026-10-06', 'and Monday night');
  assert.equal(tuesdayOf('2026-10-13'), '2026-10-13');
  assert.equal(bucketUnit({ span: 'season', games: ['pickem', 'daily'] }), 'week');
  assert.equal(bucketUnit({ span: 'season', games: ['daily'] }), 'day');
  assert.equal(bucketUnit({ span: 'weekly', games: ['daily'] }), 'week');
  assert.equal(bucketLabel('2026-10-06', 'week', new Map([['2026-10-06', 5]])), 'Week 5');
  assert.equal(bucketLabel('2026-10-06', 'week'), 'Week of Tue, Oct 6');
  assert.equal(ordinal(1), '1st'); assert.equal(ordinal(12), '12th'); assert.equal(ordinal(23), '23rd');
});

test('THE DAILY IS v2: final once its board closes; a week league buckets it into the Tuesday week', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const { results, nflWeeks } = shapeResults({
    unit: 'week', now,
    contestRows: [{ game: 'pickem', sport: 'nfl', season_year: 2026, week: 5, pd: null, locks_at: '2026-10-09T00:15:00Z', settled: false, user_id: 1, score: 7 }],
    dailyRows: [{ d: '2026-10-02', closes_at: '2026-10-03T04:00:00Z', user_id: 1, score: 88 }, { d: '2026-10-03', closes_at: '2026-10-04T04:00:00Z', user_id: 1, score: 50 }],
  });
  assert.deepEqual(results.map((r) => [r.game, r.bucket, r.final]),
    [['pickem', '2026-10-06', false], ['daily', '2026-09-29', true], ['daily', '2026-09-29', false]]);
  assert.equal(nflWeeks.get('2026-10-06'), 5);
});

test('the table: season counts finished buckets only; a weekly league is its latest finished bucket', () => {
  const members = M(1, 2);
  const results = [R(1, 10, { bucket: 'b1' }), R(2, 4, { bucket: 'b1' }), R(1, 1, { bucket: 'b2', period: 'w6' }), R(2, 6, { bucket: 'b2', period: 'w6' }),
    R(1, 9, { bucket: 'b3', period: 'w7', final: false })];
  const season = buildTable({ league: { span: 'season', scoring: 'total', drop_worst: false }, members, results, unit: 'week' });
  assert.deepEqual(season.standings.rows.map((r) => [r.userId, r.total]), [[1, 11], [2, 10]], 'the unfinished b3 is not counted');
  assert.equal(season.live, 'b3');
  assert.equal(season.thisBucket.rows[0].current, 9, 'but this week shows it so far');
  const weekly = buildTable({ league: { span: 'weekly', scoring: 'total', drop_worst: false }, members, results, unit: 'week' });
  assert.deepEqual(weekly.standings.rows.map((r) => [r.userId, r.total]), [[2, 6], [1, 1]], 'only b2, the latest finished week');
});
