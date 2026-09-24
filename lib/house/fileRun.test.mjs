// lib/house/fileRun.test.mjs - the house fills a short league, by the same
// door a reader uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { housesNeeded, RUN_LEAGUE_FLOOR } from './run.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const HOUSE = new Set([101, 102, 103, 104]);

test('THE HOUSE FILLS UP TO THE FLOOR, never beyond it', () => {
  assert.equal(RUN_LEAGUE_FLOOR, 6);
  // Three humans get three personas; five get one; six get none.
  assert.equal(housesNeeded([1, 2, 3], HOUSE), 3);
  assert.equal(housesNeeded([1, 2, 3, 4, 5], HOUSE), 1);
  assert.equal(housesNeeded([1, 2, 3, 4, 5, 6], HOUSE), 0);
  // A LEAGUE THAT IS ALREADY A CONTEST WANTS NO PADDING - and padding is the
  // thing lib/house/personas.js opens by saying these are not.
  assert.equal(housesNeeded([1, 2, 3, 4, 5, 6, 7, 8], HOUSE), 0);
  assert.equal(housesNeeded([], HOUSE), 6, 'an empty league is all house');
});

test('IT NEVER COUNTS ITSELF AS A HUMAN', () => {
  // Two humans and three personas is FIVE members but only two players, so
  // one more persona is still wanted. Counting the house as humans would make
  // that league look full, and the next human to join would tip it past the
  // floor with nobody noticing the board was mostly us.
  assert.equal(housesNeeded([1, 2, 101, 102, 103], HOUSE), 1);
  // And a league that is ALL house needs no more than the floor.
  assert.equal(housesNeeded([101, 102, 103, 104], HOUSE), 2);
  assert.equal(housesNeeded([1, 2, 3], new Set()), 3, 'no house ids, no house members');
});

test('IT PLAYS THE SAME RULES, through the same door', () => {
  const s = src('lib/house/run.js');
  const fn = s.slice(s.indexOf('export async function fileRun'), s.indexOf('// THE DRAFT - a whole room'));
  // EVERY PICK GOES THROUGH saveRunPick - the same function a reader's tap
  // calls - so the cap, the burn, the bye check and the lock all apply.
  assert.match(fn, /await saveRunPick\(/);
  assert.doesNotMatch(fn, /INSERT INTO contest_entries/, 'no private path into the table');
  // PICK BY PICK, not as one lineup: the cap and the burn are evaluated
  // against the roster AS IT STANDS.
  assert.match(fn, /for \(const slot of RUN_SLOTS\)/);
  // The burn list is read for THIS persona, excluding this round's own roster,
  // ON THE ROUND'S SIDE OF THE PREVIEW LINE - the scope saveRunPick reads. The
  // unscoped read is what refused the house as 'used' on 24 Sep.
  assert.match(fn, /runUsedPlayers\(userId, contest\.season_year, \{\s*excludeContestId: contest\.id, preview: isRunPreview\(contest\),\s*\}\)/);
  // A locked round stops the whole filing - the lock is the round's, so if
  // one pick is late they all are.
  assert.match(fn, /round_locked/);
  assert.match(fn, /late: true/);
  // A SHORT NINE IS FILED SHORT AND WILL DNF - the same consequence a reader
  // takes, not a private exemption.
  assert.match(fn, /short: filed < RUN_ROSTER/);
  // The rng is seeded from the persona and the contest, never Math.random -
  // a cron that filed a different nine every hour would be five entries.
  assert.match(fn, /seedFor\(personaKey, contest\.id\)/);
});

test('ONLY PERSONAS WITH A METHOD ON THIS GAME FILE ONE', () => {
  const s = src('lib/house/run.js');
  const fn = s.slice(s.indexOf('export async function fileRun'), s.indexOf('// THE DRAFT - a whole room'));
  // Ruling R1 again: The Fade has no line on a player to fade, so it has no
  // method on this game and no row - checked before any work is done.
  assert.match(fn, /if \(!playsGame\(personaKey, 'run'\)\) return skip/);
});
