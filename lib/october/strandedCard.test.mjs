// lib/october/strandedCard.test.mjs - tue-9, 6 Oct's two-game Division Series
// slate: (A) a card stranded by the per-game cap once one game started, and
// (B) the clock reading the frozen placeholder first pitch. PURE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refuseReason, capLifted, nextLock, nextLockClock, maxPerGame } from './rules.js';

// MIL@SD frozen at a placeholder 04:00Z the night before; live time 01:30Z.
const BOARD = [
  { match_id: 42543, slug: 'mlb-2026-10-06-mil-sd', kickoff_at: '2026-10-06T04:00:00Z', away: { abbr: 'MIL' }, home: { abbr: 'SD' } },
  { match_id: 43748, slug: 'mlb-2026-10-06-lad-atl', kickoff_at: '2026-10-06T22:00:00Z', away: { abbr: 'LAD' }, home: { abbr: 'ATL' } },
];
const kickoffBy = new Map([['42543', '2026-10-07T01:30:00Z'], ['43748', '2026-10-06T22:00:00Z']]);
const statusBy = new Map([['42543', 'scheduled'], ['43748', 'live']]);
const NOW = new Date('2026-10-06T23:14:00Z'); // 4:14 PM PT
const opts = { board: BOARD, now: NOW, statusBy, kickoffBy };
const sd = (id) => ({ playerId: id, matchId: 42543, kind: 'bat' });
const THREE_SD = { arm: { playerId: 'a1', matchId: 42543 }, bat1: { playerId: 'b1', matchId: 42543 }, bat2: { playerId: 'b2', matchId: 42543 } };

test('A. two-game slate, one started, three from the open game: the cap lifts and the card can be finished', () => {
  assert.equal(maxPerGame(BOARD, { statusBy }), 3);
  assert.equal(capLifted(THREE_SD, 'bat3', BOARD, NOW, { statusBy, kickoffBy }), true);
  assert.equal(refuseReason(THREE_SD, 'bat3', sd('b3'), opts), null);
  const four = { ...THREE_SD, bat3: { playerId: 'b3', matchId: 42543 } };
  assert.equal(refuseReason(four, 'bat4', sd('b4'), opts), null);
});

test('A. the cap still holds while the other game is open and can fill the card', () => {
  const before = new Date('2026-10-06T21:00:00Z'); // LAD@ATL not started yet
  const sched = new Map([['42543', 'scheduled'], ['43748', 'scheduled']]);
  assert.equal(refuseReason(THREE_SD, 'bat3', sd('b3'), { ...opts, now: before, statusBy: sched }), 'max_from_game');
});

test('A. a started game stays closed whatever the cap does', () => {
  const lad = { playerId: 'x', matchId: 43748, kind: 'bat' };
  assert.equal(refuseReason(THREE_SD, 'bat3', lad, opts), 'game_started');
});

test('B. next lock is the earliest UNSTARTED effective first pitch, and the clock counts to it', () => {
  const next = nextLock(BOARD, NOW, { statusBy, kickoffBy });
  assert.equal(next.match_id, 42543);
  const clock = nextLockClock(next, NOW);
  assert.equal(clock.kickoffAt, '2026-10-07T01:30:00.000Z'); // 6:30 PM PDT, not the 9:00 placeholder
  assert.equal(clock.msAway, (2 * 60 + 16) * 60000); // 02:16 to go, not 00:00
});

test('B. entry.js ships the clock from nextLockClock, never the frozen kickoff_at', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./entry.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /next\.kickoff_at/);
  assert.match(src, /nextLockClock\(next, now\)/);
});
