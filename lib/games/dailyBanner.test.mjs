// lib/games/dailyBanner.test.mjs - the Daily banner's two states (mon-2), on fixtures.
//
// Every instant is relative to NOW, which is passed: no dated cheques.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyBanner, editionLabel, bannerShareCaption, PLAYED_FLOOR } from './dailyBanner.js';
import { beatPct } from '../daily/openReveal.js';

const NOW = new Date('2026-10-05T18:00:00Z');
const H = 3_600_000;
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();

const home = (o = {}) => ({
  editionDate: '2026-10-05', board: { id: 7, closesAt: at(10 * H) }, run: null, playingToday: 0, ...o,
});
const done = (score, o = {}) => ({ startedAt: at(-H), completedAt: at(-H + 150_000), pct: 0.91, score, ...o });
const row = (userId, primary, rank) => ({ userId, primary, rank });

test('editionLabel: the edition date as OCT 4 - a calendar date, no zone', () => {
  assert.equal(editionLabel('2026-10-04'), 'OCT 4');
  assert.equal(editionLabel('2026-01-31'), 'JAN 31');
  assert.equal(editionLabel('nope'), null);
});

test('NO EDITION, NO BANNER; a live edition with no row yet still gets the before state', () => {
  assert.equal(dailyBanner({ home: null }), null);
  assert.equal(dailyBanner({ home: home({ board: null }), live: false }), null, 'pre-epoch / no board');
  const b = dailyBanner({ home: home({ board: null }), live: true, userId: 1, now: NOW });
  assert.equal(b.state, 'before');
  assert.equal(b.href, '/daily/board');
});

test('BEFORE (signed in, unplayed): date, streak when there is one, PLAY to the board', () => {
  const b = dailyBanner({ home: home(), streak: 4, userId: 1, now: NOW });
  assert.equal(b.state, 'before');
  assert.equal(b.date, 'OCT 5');
  assert.equal(b.streak, 4);
  assert.equal(b.resume, false);
  assert.equal(dailyBanner({ home: home(), streak: 0, userId: 1, now: NOW }).streak, null, 'no streak, no pill - never a 0');
  const started = dailyBanner({ home: home({ run: { startedAt: at(-60_000), completedAt: null, score: null } }), userId: 1, now: NOW });
  assert.equal(started.state, 'before', 'started and not finished is still before');
  assert.equal(started.resume, true);
});

test('SIGNED OUT: the before state, no streak, whatever run data was passed', () => {
  const b = dailyBanner({ home: home({ run: done(140) }), streak: 9, userId: null, now: NOW });
  assert.equal(b.state, 'before');
  assert.equal(b.streak, null);
});

test(`"N played today" only from ${PLAYED_FLOOR} finishers up; otherwise omitted`, () => {
  assert.equal(PLAYED_FLOOR, 25);
  assert.equal(dailyBanner({ home: home({ playingToday: 24 }), userId: 1, now: NOW }).playedToday, null);
  assert.equal(dailyBanner({ home: home({ playingToday: 25 }), userId: 1, now: NOW }).playedToday, 25);
  assert.equal(dailyBanner({ home: home({ playingToday: 214 }), userId: null, now: NOW }).playedToday, 214, 'signed out too');
  assert.equal(dailyBanner({ home: home({ playingToday: 0 }), userId: null, now: NOW }).playedToday, null);
});

test('AFTER: score, BEAT N% (openReveal\'s beatPct over today\'s field), #rank of N, countdown to the close', () => {
  const field = [row(9, 150.2, 1), row(1, 142.6, 2), row(4, 142.6, 2), row(5, 120, 4), row(6, 99.1, 5)];
  const b = dailyBanner({ home: home({ run: done(142.6), playingToday: 5 }), field, streak: 5, userId: 1, now: NOW });
  assert.equal(b.state, 'after');
  assert.equal(b.score, 142.6);
  assert.equal(b.beatPct, 50, 'two of the four OTHER runs scored strictly lower; the tie is not a win');
  assert.equal(b.beatPct, beatPct(field.map((r) => r.primary), 142.6), 'the board page\'s own number');
  assert.equal(b.rank, 2);
  assert.equal(b.of, 5);
  assert.equal(b.streak, 5);
  assert.equal(b.nextAt, at(10 * H), 'the next board opens as this one closes');
});

test('AFTER, the only finisher: no BEAT number (FIRST TO FINISH), #1 of 1', () => {
  const b = dailyBanner({ home: home({ run: done(100) }), field: [row(1, 100, 1)], userId: 1, now: NOW });
  assert.equal(b.beatPct, null);
  assert.equal(b.rank, 1);
  assert.equal(b.of, 1);
});

test('NO PCT WHILE THE DAY IS OPEN (openReveal ruling 27 Sep): % of perfect only once the board has closed', () => {
  const open = dailyBanner({ home: home({ run: done(142.6) }), field: [row(1, 142.6, 1)], userId: 1, now: NOW });
  assert.equal(open.pctOfPerfect, null, 'pct is the score over the hidden ceiling - the answer, before midnight');
  assert.doesNotMatch(bannerShareCaption(open), /perfect|91/);
  const closed = dailyBanner({ home: home({ run: done(142.6), board: { id: 7, closesAt: at(-H) } }), field: [row(1, 142.6, 1)], userId: 1, now: NOW });
  assert.equal(closed.pctOfPerfect, '91.0%', 'the one formatter (lib/daily/format.js)');
  assert.equal(closed.nextAt, null, 'no countdown to a close that has passed');
});

test('the share caption: date, score, beat, rank, streak', () => {
  const field = [row(1, 142.6, 1), row(2, 99, 2)];
  const b = dailyBanner({ home: home({ run: done(142.6) }), field, streak: 3, userId: 1, now: NOW });
  assert.equal(bannerShareCaption(b), 'The Daily · OCT 5\n142.6 pts · beat 100% · #1 of 2 · streak 3');
  assert.equal(bannerShareCaption(dailyBanner({ home: home(), userId: 1, now: NOW })), null, 'nothing to share before playing');
});
