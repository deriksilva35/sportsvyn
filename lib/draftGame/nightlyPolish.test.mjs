// wed-1b: the Nightly room's and finish screen's small words (pure), and the
// pool rows' round-of-pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  numberWord, finishTitle, countdownText, clockText, clockLow, avgTotal, roomBest, surname, surnames,
  takenLine, roundLine, lineupLine, nextDay, tomorrowLine, nightlyHeadLines, shareThree,
} from './nightlyCopy.js';
import { nightlyShape } from './nightly.js';
import { roomView } from './room.js';
import { advanceBots } from './rules.js';

test('number word and finish title follow the shape', () => {
  assert.equal(numberWord(3), 'THREE');
  assert.equal(numberWord(5), 'FIVE');
  assert.equal(numberWord(12), '12');
  assert.equal(finishTitle(3), 'YOUR THREE ARE IN');
  assert.equal(finishTitle(5), 'YOUR FIVE ARE IN');
});

test('countdown text', () => {
  const m = 60000;
  assert.equal(countdownText(2 * 3600000 + 7 * m + 5000), 'in 2 h 07 m');
  assert.equal(countdownText(7 * m), 'in 7 m');
  assert.equal(countdownText(40000), 'in 40 s');
  assert.equal(countdownText(0), 'now');
  assert.equal(countdownText(-5), 'now');
});

test('clock pill: m:ss, red under 0:05', () => {
  assert.equal(clockText(24), '0:24');
  assert.equal(clockText(0), '0:00');
  assert.equal(clockText(65), '1:05');
  assert.ok(clockLow(4) && !clockLow(5));
});

test('totals of averages and the room best', () => {
  const a = [{ proj: 50.25 }, { proj: 40 }, { proj: 30.5 }];
  const b = [{ proj: 60 }, { proj: 55 }, { proj: 20 }];
  assert.equal(avgTotal(a), 120.75);
  assert.equal(roomBest([{ picks: a }, { picks: b }]), 135);
  assert.equal(roomBest([]), 0);
});

test('surnames, with suffixes and hyphens', () => {
  assert.equal(surname('Tyrese Maxey'), 'Maxey');
  assert.equal(surname('Shai Gilgeous-Alexander'), 'Gilgeous-Alexander');
  assert.equal(surname('Jaren Jackson Jr.'), 'Jackson Jr.');
  assert.equal(surname('Nene'), 'Nene');
  assert.equal(surnames([{ name: 'Tyrese Maxey' }, { name: 'Mikal Bridges' }, { name: 'Jalen Brunson' }]), 'Maxey · Bridges · Brunson');
  assert.equal(shareThree([{ name: 'A Maxey' }, { name: 'B Bridges' }]), 'My NBA Nightly Draft on Sportsvyn: Maxey · Bridges.');
});

test('taken line, round line, lineup line', () => {
  assert.equal(takenLine({ takenBy: 'Bot A', takenRound: 1 }), 'taken by Bot A · Rd 1');
  assert.equal(takenLine({ takenBy: 'You', takenRound: null }), 'taken by You');
  assert.equal(roundLine({ round: 1, rounds: 3, yourTurn: true }), 'Round 1 of 3 · your pick');
  assert.equal(roundLine({ round: 2, rounds: 3, yourTurn: false, onClockLabel: 'Bot B' }), "Round 2 of 3 · Bot B's pick");
  assert.equal(lineupLine(nightlyShape(2)), 'G · F · UTIL · all 3 count');
});

test('header lines: date and games, then drafters, picks and the Pacific lock', () => {
  const h = nightlyHeadLines({ dayEt: '2026-10-20', games: [{}, {}], shape: nightlyShape(2), kickoffAt: '2026-10-20T23:00:00Z' });
  assert.equal(h.line1, 'TUE OCT 20 · 2 games');
  assert.equal(h.line2, '4 drafters · 3 picks · locks 4:00 PM PT');
});

test('tomorrow: the next ET day, and a line only when a room exists', () => {
  assert.equal(nextDay('2026-10-31'), '2026-11-01');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
  assert.equal(tomorrowLine({ games: new Array(11).fill({}), seats: 6, rounds: 5 }), 'Tomorrow: 11 games · 6 drafters · 5 picks');
  assert.equal(tomorrowLine(null), null);
  assert.equal(tomorrowLine({ games: [] }), null);
});

test('pool rows carry the round they were taken in, and the view says whose pick it is', () => {
  const shape = nightlyShape(2);
  const POS = ['G', 'F', 'C', 'G-F', 'F-C', 'G', 'F', 'G', 'F', 'C'];
  const board = Array.from({ length: 40 }, (_, i) => ({ id: 1000 + i, name: `P${i}`, pos: POS[i % POS.length], team: 'NYK', proj: 60 - i }));
  const contest = { id: 9, board, meta: { ...shape, nightly: true, games: [], day_et: '2026-10-20' }, status: 'scheduled', kickoff_at: '2099-01-01T00:00:00Z', settled: false };
  const made = advanceBots(board, [], { contestId: 9, userSeat: 3, shape });
  const v = roomView(contest, { seat: 3, picks: made, deadline: '2099-01-01T00:00:00Z' }, new Date('2026-10-20T20:00:00Z'));
  const first = v.pool.filter((p) => p.takenBy);
  assert.equal(first.length, 2, 'seats 1 and 2 picked');
  assert.ok(first.every((p) => p.takenRound === 1));
  assert.ok(v.pool.filter((p) => !p.takenBy).every((p) => p.takenRound === null));
  assert.equal(v.round, 1);
  assert.equal(v.onClockLabel, 'You');
});
