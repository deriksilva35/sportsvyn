// lib/mlb/kickoffTbd.test.mjs - "Time TBD" end to end (tue-10). PURE.
// The provider's placeholder is a midnight-ET date; it must never be stored,
// locked on, counted down to, or printed as a real first pitch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlaceholderKickoff } from './kickoffTbd.js';
import { shapeMlbMatch } from './schedule.js';
import { refuseReason, lockedSlots, dayState, nextLock, nextLockClock, effectiveKickoff, capLifted } from '../october/rules.js';
import { boardFor } from '../run/create.js';

test('midnight ET is the placeholder, in EDT and EST; real times are not', () => {
  assert.equal(isPlaceholderKickoff('2026-10-11T04:00:00.000Z'), true);  // EDT
  assert.equal(isPlaceholderKickoff('2026-11-03T05:00:00Z'), true);      // EST
  assert.equal(isPlaceholderKickoff('2026-10-07T01:30:00Z'), false);
  assert.equal(isPlaceholderKickoff('2026-10-10T00:00:00Z'), false);     // 8 PM ET, a real time
  assert.equal(isPlaceholderKickoff(null), false);
});

test('the schedule writer stores a placeholder FLAGGED, and a real time unflagged', () => {
  const row = (date) => ({ id: 1, date, season: 2026, postseason: true, status: 'STATUS_SCHEDULED',
    home_team: { id: 10 }, away_team: { id: 20 } });
  const ids = new Map([['10', 1], ['20', 2]]);
  const tbd = shapeMlbMatch(row('2026-10-11T04:00:00.000Z'), 'mlb-2026-10-11-a-b', ids, []);
  const real = shapeMlbMatch(row('2026-10-11T00:08:00.000Z'), 'mlb-2026-10-10-a-b', ids, []);
  assert.equal(tbd.metadata.kickoff_tbd, true);
  assert.equal(real.metadata.kickoff_tbd, false);
});

// October: board 42's shape - one game live, the other TBD on both sides.
const NOW = new Date('2026-10-11T15:00:00Z');
const BOARD = [
  { match_id: 1, slug: 'mlb-2026-10-11-a-b', kickoff_at: '2026-10-11T04:00:00Z', away: { abbr: 'A' }, home: { abbr: 'B' } },
  { match_id: 2, slug: 'mlb-2026-10-11-c-d', kickoff_at: '2026-10-11T04:00:00Z', away: { abbr: 'C' }, home: { abbr: 'D' } },
];
const kickoffBy = new Map([['1', '2026-10-11T04:00:00Z'], ['2', '2026-10-11T04:00:00Z']]);
const statusBy = new Map([['1', 'scheduled'], ['2', 'scheduled']]);
const o = { kickoffBy, statusBy };

test('October: a TBD game does not lock at midnight - it stays pickable, no slot seals, the day is open', () => {
  assert.ok(Number.isNaN(effectiveKickoff('2026-10-11T04:00:00Z', '2026-10-11T04:00:00Z')));
  const lineup = { arm: { playerId: 'p', matchId: 1 } };
  assert.equal(refuseReason(lineup, 'bat1', { playerId: 'b', matchId: 1, kind: 'bat' }, { board: BOARD, now: NOW, ...o }), null);
  assert.equal(lockedSlots(lineup, BOARD, NOW, o).size, 0);
  assert.equal(dayState(lineup, BOARD, NOW, o).state, 'open');
  assert.equal(capLifted(lineup, 'bat1', BOARD, NOW, o), false, 'TBD games are open room');
});

test('October: the clock says TBD rather than counting to the placeholder or "all locked"', () => {
  const next = nextLock(BOARD, NOW, o);
  assert.equal(next.tbd, true);
  assert.deepEqual(nextLockClock(next, NOW), { kickoffAt: null, msAway: null, tbd: true });
});

test('October: once the real time posts, the clock counts to it (frozen placeholder ignored)', () => {
  const posted = new Map([['1', '2026-10-11T20:08:00Z'], ['2', '2026-10-11T04:00:00Z']]);
  const next = nextLock(BOARD, NOW, { statusBy, kickoffBy: posted });
  assert.equal(next.match_id, 1);
  assert.equal(nextLockClock(next, NOW).kickoffAt, '2026-10-11T20:08:00.000Z');
});

test('The Run: a round whose earliest day is TBD has no first pitch (no early lock)', () => {
  const series = (k1, k2) => [
    { key: 's1', bestOf: 7, teams: [{ id: 1, abbreviation: 'A' }, { id: 2, abbreviation: 'B' }], games: [{ id: 11, kickoffAt: k1 }] },
    { key: 's2', bestOf: 7, teams: [{ id: 3, abbreviation: 'C' }, { id: 4, abbreviation: 'D' }], games: [{ id: 12, kickoffAt: k2 }] },
  ];
  assert.equal(boardFor({ round: 'lcs', series: series('2026-10-11T04:00:00Z', '2026-10-12T00:08:00Z') }).meta.firstPitch, null);
  assert.equal(boardFor({ round: 'lcs', series: series('2026-10-11T20:08:00Z', '2026-10-12T04:00:00Z') }).meta.firstPitch, '2026-10-11T20:08:00.000Z');
});
