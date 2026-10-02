// lib/nba/dayPickem.test.mjs - the daily NBA Pick'em, PURE half: the day key,
// the lock against the CURRENT tip, void games, the settle-time lock, the
// lobby row's words. No database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey, previousDay, etDay, dayGameLocked, withCurrentTips, dayResults, onTimePicks,
  isDayBoard, isVoidStatus, VOID_STATUSES, dayLabel,
} from './dayPickem.js';
import { NOT_PLAYED } from '../mlb/status.js';
import { nbaPickemItem, PLAY_REGISTRY } from '../games/playRegistry.js';
import { scoreLineup } from '../pickem/settle.js';

test('the day key is the ET date as YYYYMMDD; the day before crosses months and years', () => {
  assert.equal(dayKey('2026-10-20'), 20261020);
  assert.equal(dayKey('nope'), null);
  assert.equal(previousDay('2026-11-01'), '2026-10-31');
  assert.equal(previousDay('2027-01-01'), '2026-12-31');
  assert.equal(previousDay('2026-03-09'), '2026-03-08', 'a DST change is a calendar no-op');
});

test('etDay buckets a stored instant into its ET calendar day', () => {
  assert.equal(etDay(new Date('2026-10-21T01:30:00Z')), '2026-10-20', '9:30 PM ET is still the 20th');
  assert.equal(etDay(new Date('2026-10-21T04:30:00Z')), '2026-10-21', '12:30 AM ET is the 21st');
  assert.equal(etDay(new Date('2026-12-16T04:30:00Z')), '2026-12-15', 'EST: 11:30 PM the 15th');
});

test('dayLabel names a calendar day without a zone moving it', () => {
  assert.equal(dayLabel('2026-10-20'), 'Tue Oct 20');
  assert.equal(dayLabel(null), null);
});

test('void is NOT_PLAYED plus postponed - the shared list, not a copy', () => {
  for (const s of NOT_PLAYED) assert.ok(VOID_STATUSES.includes(s), s);
  assert.ok(isVoidStatus('postponed'));
  assert.ok(!isVoidStatus('final') && !isVoidStatus('scheduled') && !isVoidStatus('live'));
});

test('isDayBoard asks the row, not the sport', () => {
  assert.equal(isDayBoard({ sport: 'nba', meta: { day_board: true } }), true);
  assert.equal(isDayBoard({ sport: 'nba', meta: {} }), false, 'an NBA row without the mark is not a day board');
  assert.equal(isDayBoard({ sport: 'nfl', meta: null }), false);
  assert.equal(isDayBoard(null), false);
});

test('THE LOCK IS THE CURRENT TIP: open before it, sealed at it (<=), sealed off scheduled', () => {
  const tip = '2026-10-20T23:00:00Z';
  const m = { kickoff_at: tip, status: 'scheduled' };
  assert.equal(dayGameLocked(m, new Date('2026-10-20T22:59:59Z')), false);
  assert.equal(dayGameLocked(m, new Date(tip)), true, 'the boundary instant is locked');
  assert.equal(dayGameLocked({ ...m, status: 'live' }, new Date('2026-10-20T20:00:00Z')), true, 'tipped early');
  assert.equal(dayGameLocked({ ...m, status: 'postponed' }, new Date('2026-10-20T20:00:00Z')), true);
  assert.equal(dayGameLocked(null, new Date()), true, 'no row, no pick');
  assert.equal(dayGameLocked({ kickoff_at: null, status: 'scheduled' }, new Date()), true, 'no tip, no pick');
});

const BOARD = [
  { match_id: 1, kickoff_at: '2026-10-20T23:00:00.000Z', home: 'NYK', away: 'PHI' },
  { match_id: 2, kickoff_at: '2026-10-21T00:30:00.000Z', home: 'LAL', away: 'GSW' },
  { match_id: 3, kickoff_at: '2026-10-21T02:30:00.000Z', home: 'SAS', away: 'OKC' },
];

test('withCurrentTips writes the row tip over the frozen one and re-sorts by it', () => {
  const byId = new Map([
    [1, { kickoff_at: '2026-10-20T23:00:00Z' }],
    [2, { kickoff_at: '2026-10-21T03:00:00Z' }], // moved later, past game 3
    [3, { kickoff_at: '2026-10-21T02:30:00Z' }],
  ]);
  const b = withCurrentTips(BOARD, byId);
  assert.deepEqual(b.map((g) => [g.match_id, g.kickoff_at]), [
    [1, '2026-10-20T23:00:00.000Z'], [3, '2026-10-21T02:30:00.000Z'], [2, '2026-10-21T03:00:00.000Z']]);
  assert.equal(BOARD[1].kickoff_at, '2026-10-21T00:30:00.000Z', 'the snapshot itself is not mutated');
});

test('dayResults: waits on a live game; void is null; a final always names a side', () => {
  const live = new Map([[1, { status: 'final', home_score: 110, away_score: 100 }], [2, { status: 'live' }], [3, { status: 'cancelled' }]]);
  assert.deepEqual(dayResults(BOARD, live), { complete: false, remaining: 1, results: null, voided: [3] });
  const done = new Map([[1, { status: 'final', home_score: 110, away_score: 100 }],
    [2, { status: 'final', home_score: 98, away_score: 101 }], [3, { status: 'not_needed' }]]);
  assert.deepEqual(dayResults(BOARD, done), { complete: true, remaining: 0, results: { 1: 'home', 2: 'away', 3: null }, voided: [3] });
  const pp = new Map([[1, { status: 'postponed' }], [2, { status: 'postponed' }], [3, { status: 'postponed' }]]);
  assert.equal(dayResults(BOARD, pp).complete, true, 'a whole day called off still settles - void for everyone');
});

test('A VOID GAME IS NOT A LOSS: the scorer skips a null result', () => {
  const results = { 1: 'home', 2: 'away', 3: null };
  assert.equal(scoreLineup({ 1: 'home', 2: 'away', 3: 'home' }, results), 2);
  assert.equal(scoreLineup({ 3: 'away' }, results), 0, 'a pick on a void game is neither right nor wrong');
});

test('THE SETTLE-TIME LOCK: a pick stamped at or after the CURRENT tip is dropped, the rest kept', () => {
  const byId = new Map([[1, { kickoff_at: '2026-10-20T23:00:00Z' }], [2, { kickoff_at: '2026-10-20T22:00:00Z' }]]);
  const lineup = { 1: 'home', 2: 'away', 3: 'home' };
  const pickedAt = { 1: '2026-10-20T12:00:00Z', 2: '2026-10-20T22:00:00Z', 3: '2026-10-20T12:00:00Z' };
  const r = onTimePicks(lineup, pickedAt, byId);
  assert.deepEqual(r.lineup, { 1: 'home', 3: 'home' });
  assert.deepEqual(r.late, { 2: { side: 'away', picked_at: '2026-10-20T22:00:00Z', tip: '2026-10-20T22:00:00.000Z' } });
  assert.deepEqual(onTimePicks({ 1: 'home' }, {}, byId).lineup, { 1: 'home' }, 'no stamp is given the benefit');
});

// THE PLAY LOBBY (thu-38 + fri-1) replaced the v3 row, whose line baked
// "4:00 PM PT" into its words; the registry item carries the instant and the
// page renders it in the page's zone. Same counts, same three states.
test('the lobby item: open counts the pickable games and carries the next tip; locked and settled say so', () => {
  const now = new Date('2026-10-20T15:00:00Z');
  const e = PLAY_REGISTRY.find((x) => x.key === 'nba-pickem');
  const open = nbaPickemItem(e, { st: { settled: false, games: 3, pickable: 2, pickedOpen: 1, picked: 2, score: null, nextTip: '2026-10-20T23:00:00Z' } }, { signedIn: true, now });
  assert.equal(open.key, 'nba-pickem'); assert.equal(open.href, '/pickem/nba');
  assert.equal(open.status, '1 of 2 picked');
  assert.deepEqual(open.at, { iso: '2026-10-20T23:00:00.000Z', words: 'next lock' });
  const locked = nbaPickemItem(e, { st: { settled: false, games: 3, pickable: 0, pickedOpen: 0, picked: 3, nextTip: null } }, { signedIn: true, now });
  assert.equal(locked.status, '3 games · all tipped · 3 picked'); assert.equal(locked.locksAt, null);
  const settled = nbaPickemItem(e, { st: { settled: true, games: 3, pickable: 0, score: 2, max: 2 } }, { signedIn: true, now });
  assert.equal(settled.status, 'Settled · 2 of 2 right');
  assert.equal(nbaPickemItem(e, { st: { settled: true, games: 1, score: null } }, { signedIn: true, now }).status, '1 game · settled');
});
