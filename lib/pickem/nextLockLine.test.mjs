// lib/pickem/nextLockLine.test.mjs - the lobby row and the board page now ask
// ONE question about a Pick'em board: which game locks next.
//
// THE DEFECT THIS PINS. /games read pickem.firstKickoff - the board's EARLIEST
// kickoff - so on Tue 8 Sep 2026 the lobby advertised CFB board 3 as "first
// lock Mon Sep 7", a lock a day in the past, while 23 of its 24 games were
// still open. /pickem/cfb, reading the next un-kicked kickoff, was correct on
// the same board at the same moment. Two computations of "the lock", one of
// them describing the board's past.
//
// PURE. No database, no fixtures: these are the two exported functions the
// board and the lobby both route through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasKicked, nextUnlockedKickoff, nextKickoff, gameRows } from './view.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
// CODE, NOT PROSE. The first cut of the guard below failed on read.js's own
// comment explaining what the field used to be - a guard that cannot tell an
// explanation from a live read would force the explanation to be deleted.
const code = (rel) => src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NOW = new Date('2026-09-08T15:00:00Z'); // Tue 8 Sep, 08:00 PT

// CFB board 3's actual shape on launch morning: one game already final on the
// Monday, the rest still ahead.
const BOARD = [
  { match_id: 1, home: 'FSU', away: 'SMU', kickoff_at: '2026-09-07T23:30:00Z' }, // played
  { match_id: 2, home: 'MIA', away: 'FAMU', kickoff_at: '2026-09-11T00:00:00Z' },
  { match_id: 3, home: 'IND', away: 'HOW', kickoff_at: '2026-09-10T23:00:00Z' }, // EARLIER than #2
];

test('hasKicked: the timestamp OR a status the provider has moved off scheduled', () => {
  assert.equal(hasKicked(BOARD[0], { now: NOW }), true, 'kickoff already passed');
  assert.equal(hasKicked(BOARD[1], { now: NOW }), false, 'still ahead');
  // A game still in the future but no longer 'scheduled' is locked anyway -
  // moved, postponed or started early. The lobby cannot see this (it loads no
  // live rows) and correctly falls back to the timestamp half.
  assert.equal(hasKicked(BOARD[1], { status: 'in_progress', now: NOW }), true);
  assert.equal(hasKicked(BOARD[1], { status: 'scheduled', now: NOW }), false);
});

test('nextUnlockedKickoff takes the MINIMUM un-kicked kickoff, not board order', () => {
  // #3 is stored after #2 but kicks first. Array order would name #2.
  assert.equal(nextUnlockedKickoff(BOARD, { now: NOW }), '2026-09-10T23:00:00Z');
});

test('the past kickoff is never the answer while anything is still ahead', () => {
  const got = nextUnlockedKickoff(BOARD, { now: NOW });
  assert.notEqual(got, BOARD[0].kickoff_at, 'this is exactly the /games defect');
  assert.ok(new Date(got) > NOW, 'a lock line must name a lock that has not happened');
});

test('every game kicked -> null, which the row reads as the settle state', () => {
  const later = new Date('2026-09-12T00:00:00Z');
  assert.equal(nextUnlockedKickoff(BOARD, { now: later }), null);
  // Not an error and not an empty board - a real state: unsettled but
  // unpickable. lib/games/read.js turns this null into "all kicked · awaiting
  // grade" and a muted pill rather than a lock line with nothing in it.
});

test('empty and missing boards resolve null rather than throwing', () => {
  assert.equal(nextUnlockedKickoff([], { now: NOW }), null);
  assert.equal(nextUnlockedKickoff(undefined, { now: NOW }), null);
});

test('THE LOBBY AND THE BOARD AGREE - same board, same instant, same answer', () => {
  // The board page's own path: gameRows decides `kicked` per row via
  // hasKicked, then nextKickoff picks the minimum un-kicked one.
  const rows = gameRows({ board: BOARD, now: NOW });
  const fromBoardPage = nextKickoff(rows);
  const fromLobbyCard = nextUnlockedKickoff(BOARD, { now: NOW });
  assert.equal(fromBoardPage, fromLobbyCard);
  // And it is not merely that both are null.
  assert.ok(fromBoardPage != null);
});

test('the lobby row reads nextKickoff, and firstKickoff is gone from both sides', () => {
  // A SOURCE GUARD, because this failure mode is SILENT. pickemCardData no
  // longer returns firstKickoff, so a row that still read it would get
  // undefined, render locksAt as null, and quietly fall through to line2
  // forever - a lock line that simply stops appearing, with nothing thrown
  // and no test failing. Asserted against the source rather than trusted.
  const read = code('lib/games/read.js');
  const entry = code('lib/pickem/entry.js');
  assert.ok(!/pickem\.firstKickoff/.test(read), 'lib/games/read.js still reads pickem.firstKickoff');
  assert.ok(!/firstKickoff:/.test(entry), 'pickemCardData still returns a firstKickoff field');
  assert.match(read, /locksAt: pickem\.nextKickoff/, 'the row must carry the shared next-lock value');
});
