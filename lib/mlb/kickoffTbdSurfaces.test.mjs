// lib/mlb/kickoffTbdSurfaces.test.mjs - the DATA LAYERS that carry the Time TBD
// flag to every list/card (tue-10, Time TBD everywhere). PURE except readers.js,
// which imports lib/db (the suite sources .env.local; nothing here queries).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowToGame } from '../gridiron/readers.js';
import { gameRows } from '../pickem/view.js';
import { playTimeLabel } from '../games/playTime.js';
import { cardSummary } from '../games/playLobby.js';

const PLACEHOLDER = '2026-10-11T04:00:00Z'; // midnight ET
const away = (o = {}) => ({ id: 1, slug: 'a-at-b', league_slug: 'mlb', status: 'scheduled', kickoff_at: PLACEHOLDER, metadata: {}, ...o });

test('rowToGame (scoreboards): an MLB placeholder row is kickoffTbd; a real time is not', () => {
  assert.equal(rowToGame(away({ metadata: { kickoff_tbd: true } })).kickoffTbd, true);
  assert.equal(rowToGame(away()).kickoffTbd, true); // clock fallback, MLB only
  assert.equal(rowToGame(away({ kickoff_at: '2026-10-11T23:08:00Z' })).kickoffTbd, false);
  assert.equal(rowToGame(away({ metadata: { kickoff_tbd: false }, kickoff_at: '2026-10-11T23:08:00Z' })).kickoffTbd, false);
});

test('rowToGame: NON-MLB rows are never TBD by their clock (midnight ET stays a time)', () => {
  assert.equal(rowToGame(away({ league_slug: 'nfl' })).kickoffTbd, false);
  assert.equal(rowToGame(away({ league_slug: 'epl' })).kickoffTbd, false);
});

test('Pick\'em gameRows: kickoff_tbd rides the wire row from the match read, false otherwise', () => {
  const board = [
    { match_id: 1, slug: 'a', kickoff_at: PLACEHOLDER, home: 'H', away: 'A' },
    { match_id: 2, slug: 'b', kickoff_at: '2026-10-11T23:08:00Z', home: 'H', away: 'A' },
    { match_id: 3, slug: 'c', kickoff_at: '2026-10-12T23:08:00Z', home: 'H', away: 'A' },
  ];
  const liveById = new Map([[1, { status: 'scheduled', kickoff_tbd: true }], [2, { status: 'scheduled', kickoff_tbd: false }]]);
  const rows = gameRows({ board, liveById, now: new Date('2026-10-09T12:00:00Z') });
  assert.deepEqual(rows.map((r) => r.kickoff_tbd), [true, false, false]);
});

test('playTimeLabel (the lobby): tbd reads Time TBD, otherwise the shared label', () => {
  assert.equal(playTimeLabel(PLACEHOLDER, { tz: null, tbd: true }), 'Time TBD');
  assert.equal(playTimeLabel(PLACEHOLDER, { tz: null }), 'Sun 12:00 AM');
});

test('cardSummary: the soonest lock is flagged TBD only for an MLB row at the placeholder', () => {
  const soon = new Date(Date.now() + 3600_000).toISOString();
  const row = (o) => ({ key: 'k', name: 'N', game: 'pickem', phase: 'open', locksAt: PLACEHOLDER, ...o });
  assert.equal(cardSummary([row({ sport: 'mlb' })]).nextLockTbd, true);
  assert.equal(cardSummary([row({ sport: 'nfl' })]).nextLockTbd, false);
  assert.equal(cardSummary([row({ sport: 'mlb', locksAt: soon })]).nextLockTbd, false);
});
