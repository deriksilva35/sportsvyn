// lib/house/pickRun.test.mjs - the house fills a short league, by the rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chalkRun, gutRun, homerRun, pickRun } from './pickRun.js';
import { playsGame, PERSONA_BY_KEY } from './personas.js';
import { SLOTS } from '../run/rules.js';

const CLUBS = [
  { teamId: 1, abbr: 'KC', bye: false }, { teamId: 2, abbr: 'LAD', bye: false },
  { teamId: 3, abbr: 'ATL', bye: false }, { teamId: 4, abbr: 'TEX', bye: true },
];
const BOARD = { round: 'wild_card', firstPitch: '2026-09-29T18:00:00Z', clubs: CLUBS };
const CTX = { board: BOARD, used: new Map(), now: new Date('2026-09-29T12:00:00Z') };
const P = (id, kind, teamId, ppg, team) => ({ playerId: String(id), name: `P${id}`, short: `P${id}`, kind, teamId, team, ppg });

const POOL = [
  P(1, 'arm', 1, 20, 'KC'), P(2, 'arm', 2, 18, 'LAD'), P(3, 'arm', 3, 16, 'ATL'), P(20, 'arm', 4, 30, 'TEX'),
  ...[[4, 1, 12, 'KC'], [5, 1, 11, 'KC'], [6, 1, 10, 'KC'], [7, 1, 9.5, 'KC'],
    [8, 2, 9, 'LAD'], [9, 2, 8.5, 'LAD'], [10, 2, 8, 'LAD'], [11, 2, 7.5, 'LAD'],
    [12, 3, 7, 'ATL'], [13, 3, 6.5, 'ATL'], [14, 3, 6, 'ATL'],
    [21, 4, 40, 'TEX']].map(([id, t, ppg, ab]) => P(id, 'bat', t, ppg, ab)),
];

test('THE FADE HAS NO ROW HERE EITHER (ruling R1)', () => {
  assert.equal(playsGame('fade', 'run'), false);
  assert.equal(pickRun('fade', POOL, CTX), null);
  for (const k of ['chalk', 'gut', 'homer']) assert.equal(playsGame(k, 'run'), true, k);
  assert.match(PERSONA_BY_KEY.chalk.method.run, /club cap/);
});

test('THE CHALK FILLS NINE, and the club cap binds it', () => {
  const c = chalkRun(POOL, CTX);
  assert.deepEqual(Object.keys(c).sort(), [...SLOTS].sort());
  // THREE MAX PER CLUB, counting the arms.
  const perClub = new Map();
  for (const s of SLOTS) perClub.set(c[s].teamId, (perClub.get(c[s].teamId) ?? 0) + 1);
  assert.ok([...perClub.values()].every((n) => n <= 3), 'no club over three');
  assert.equal([...perClub.values()].reduce((a, b) => a + b, 0), 9);
  // A BYE CLUB IS NEVER PICKED, however good its players are - Texas has the
  // best arm and the best bat in the pool and gets neither slot.
  assert.ok(!Object.values(c).some((p) => p.teamId === 4), 'Texas has a bye');
  assert.equal(c.arm1.playerId, '1', 'the best arm that is actually playing');
});

test('THE BURN BINDS THE HOUSE ACROSS ROUNDS', () => {
  const ctx = { ...CTX, used: new Map([['1', 'wild_card'], ['4', 'wild_card']]) };
  const c = chalkRun(POOL, ctx);
  assert.equal(c.arm1.playerId, '2', 'the best arm is spent');
  assert.ok(!Object.values(c).some((p) => p.playerId === '4'));
  assert.equal(Object.keys(c).length, 9);
});

test('A POOL IT CANNOT FILL LEAVES SLOTS OPEN - a DNF, not an illegal nine', () => {
  const thin = [P(1, 'arm', 1, 20, 'KC'), P(4, 'bat', 1, 12, 'KC'), P(5, 'bat', 1, 11, 'KC')];
  const c = chalkRun(thin, CTX);
  // Three from one club is the cap, so only three of the nine can be filled.
  assert.equal(Object.keys(c).length, 3);
  assert.equal(c.bat3, undefined);
});

test('THE GUT DIFFERS FROM THE CHALK and is still legal', () => {
  const c = gutRun(POOL, CTX, () => 0.999);
  assert.equal(Object.keys(c).length, 9);
  const perClub = new Map();
  for (const s of SLOTS) perClub.set(c[s].teamId, (perClub.get(c[s].teamId) ?? 0) + 1);
  assert.ok([...perClub.values()].every((n) => n <= 3));
  assert.ok(!Object.values(c).some((p) => p.teamId === 4));
  assert.notDeepEqual(Object.values(c).map((p) => p.playerId), Object.values(chalkRun(POOL, CTX)).map((p) => p.playerId));
});

test('THE HOMER TAKES ITS OWN WHERE THE ROUND HAS THEM', () => {
  const c = homerRun(POOL, CTX);
  // KC is one of HOMER_TEAMS: the arm and two bats, then the cap binds.
  assert.equal(c.arm1.teamId, 1);
  assert.equal(SLOTS.filter((s) => c[s].teamId === 1).length, 3);
  // A round with none of its teams is all chalk.
  const none = POOL.map((p) => ({ ...p, team: 'SEA' }));
  assert.deepEqual(
    Object.values(homerRun(none, CTX)).map((p) => p.playerId),
    Object.values(chalkRun(none, CTX)).map((p) => p.playerId),
  );
});
