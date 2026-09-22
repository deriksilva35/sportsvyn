// lib/house/pickOctober.test.mjs - the house plays October by the same rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chalkOctober, gutOctober, homerOctober, pickOctober } from './pickOctober.js';
import { PERSONA_BY_KEY, playsGame } from './personas.js';
import { SLOTS, maxPerGame } from '../october/rules.js';

const BOARD = [
  { match_id: 1, slug: 'a', kickoff_at: '2026-10-05T18:00:00Z' },
  { match_id: 2, slug: 'b', kickoff_at: '2026-10-05T22:00:00Z' },
];
const CTX = { board: BOARD, used: new Set(), now: new Date('2026-10-05T12:00:00Z') };

const P = (id, kind, matchId, ppg, team = 'XXX') =>
  ({ playerId: String(id), name: `P${id}`, short: `P${id}`, kind, matchId, ppg, team });

// Four bats and two arms per game, descending PPG.
const POOL = [
  P(1, 'arm', 1, 20, 'KC'), P(2, 'arm', 2, 18, 'LAD'),
  P(3, 'bat', 1, 12, 'KC'), P(4, 'bat', 1, 11, 'KC'), P(5, 'bat', 1, 10, 'KC'),
  P(6, 'bat', 2, 9, 'LAD'), P(7, 'bat', 2, 8, 'LAD'), P(8, 'bat', 2, 7, 'LAD'),
];

test('THE FADE HAS NO ROW HERE, and that is ruling R1 applied consistently', () => {
  // There is no line on an individual player, so it has nothing to be
  // contrarian about. An absent row says that; a faked one says the opposite.
  assert.equal(playsGame('fade', 'october'), false);
  assert.equal(pickOctober('fade', POOL, CTX), null);
  for (const k of ['chalk', 'gut', 'homer']) assert.equal(playsGame(k, 'october'), true, k);
  assert.match(PERSONA_BY_KEY.chalk.method.october, /Highest PPG/);
});

test('THE CHALK TAKES THE BEST NUMBER, and obeys two-from-one-game', () => {
  const c = chalkOctober(POOL, CTX);
  // TWO GAMES, SO THE CAP IS ceil(5/2) = 3 - and the card is still five.
  assert.equal(maxPerGame(BOARD), 3);
  assert.deepEqual(Object.keys(c).sort(), [...SLOTS].sort());
  assert.equal(c.arm.playerId, '1', 'the best arm');
  // THE CAP BINDS AT THREE: the arm plus two game-1 bats, then game 2 fills
  // the rest even though they score lower. The house plays the same rules.
  const fromGame1 = SLOTS.filter((s) => c[s].matchId === 1).length;
  assert.equal(fromGame1, 3);
  assert.deepEqual([c.bat1.playerId, c.bat2.playerId, c.bat3.playerId, c.bat4.playerId], ['3', '4', '6', '7']);
});

test('THE BURN BINDS THE HOUSE TOO', () => {
  const ctx = { ...CTX, used: new Set(['1', '3']) };
  const c = chalkOctober(POOL, ctx);
  assert.equal(c.arm.playerId, '2', 'the best arm is spent, so the next one');
  assert.ok(!Object.values(c).some((p) => p.playerId === '3'));
  // And with the arm now in game 2, the bats redistribute accordingly.
  assert.ok(SLOTS.filter((s) => c[s].matchId === 2).length <= maxPerGame(BOARD));
});

test('A CARD IT CANNOT FILL IS LEFT SHORT - a DNF, not an illegal pick', () => {
  // Only two players exist in the whole pool, so three slots go unfilled
  // rather than inventing one. The house DNFs like anybody else.
  const thin = [P(1, 'arm', 1, 20), P(3, 'bat', 1, 12)];
  const c = chalkOctober(thin, CTX);
  assert.equal(Object.keys(c).length, 2);
  assert.equal(c.bat2, undefined);
});

test('A ONE-GAME DAY: the house takes all five from it', () => {
  const one = [{ match_id: 1, slug: 'a', kickoff_at: '2026-10-05T18:00:00Z' }];
  const ctx = { board: one, used: new Set(), now: new Date('2026-10-05T12:00:00Z') };
  const pool = [P(1, 'arm', 1, 20), P(3, 'bat', 1, 12), P(4, 'bat', 1, 11), P(5, 'bat', 1, 10), P(9, 'bat', 1, 9)];
  const c = chalkOctober(pool, ctx);
  assert.equal(maxPerGame(one), 5);
  assert.equal(Object.keys(c).length, 5);
  assert.equal(SLOTS.filter((s) => c[s].matchId === 1).length, 5);
});

test('THE GUT IS RANDOM INSIDE THE TOP TIER, and still legal', () => {
  // Deterministic rng: always the last of the tier.
  const c = gutOctober(POOL, CTX, () => 0.999);
  assert.equal(Object.keys(c).length, 5, 'the card is always five');
  assert.ok(SLOTS.filter((s) => c[s].matchId === 1).length <= maxPerGame(BOARD));
  // It differs from the chalk, which is the whole point of a second persona.
  const chalk = chalkOctober(POOL, CTX);
  assert.notDeepEqual(Object.values(c).map((p) => p.playerId), Object.values(chalk).map((p) => p.playerId));
});

test('THE HOMER TAKES ITS OWN WHERE TODAY HAS THEM, the chalk elsewhere', () => {
  const c = homerOctober(POOL, CTX);
  // KC is one of HOMER_TEAMS, so the KC arm and a KC bat go first.
  assert.equal(c.arm.playerId, '1');
  assert.equal(c.bat1.playerId, '3');
  // With the cap at three it takes a second KC bat too, and only THEN does
  // the cap bind and the chalk fill the rest from game 2.
  assert.equal(c.bat2.playerId, '4');
  assert.equal(c.bat3.playerId, '6');
  // ITS TEAMS ARE FOOTBALL TEAMS: a day with none of them is all chalk.
  const noOwn = POOL.map((p) => ({ ...p, team: 'SEA' }));
  assert.deepEqual(
    Object.values(homerOctober(noOwn, CTX)).map((p) => p.playerId),
    Object.values(chalkOctober(noOwn, CTX)).map((p) => p.playerId),
  );
});
