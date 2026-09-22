// lib/house/pickOctober.test.mjs - the house plays October by the same rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chalkOctober, gutOctober, homerOctober, pickOctober } from './pickOctober.js';
import { PERSONA_BY_KEY, playsGame } from './personas.js';
import { slotsFor } from '../october/rules.js';

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
  // TWO GAMES IS A FOUR-SLOT CARD - 2 x games, capped at five. The house
  // fields the card the reader is fielding.
  assert.deepEqual(Object.keys(c).sort(), [...slotsFor(BOARD)].sort());
  assert.equal(c.arm.playerId, '1', 'the best arm');
  // MAX TWO FROM ONE GAME BINDS: the arm is from game 1, so only ONE more
  // game-1 bat can join it, and the rest come from game 2 even though they
  // score lower. The house plays the same rules as everyone.
  const fromGame1 = slotsFor(BOARD).filter((s) => c[s].matchId === 1).length;
  assert.equal(fromGame1, 2);
  assert.deepEqual([c.bat1.playerId, c.bat2.playerId, c.bat3.playerId], ['3', '6', '7']);
});

test('THE BURN BINDS THE HOUSE TOO', () => {
  const ctx = { ...CTX, used: new Set(['1', '3']) };
  const c = chalkOctober(POOL, ctx);
  assert.equal(c.arm.playerId, '2', 'the best arm is spent, so the next one');
  assert.ok(!Object.values(c).some((p) => p.playerId === '3'));
  // And with the arm now in game 2, the bats redistribute accordingly.
  assert.equal(slotsFor(BOARD).filter((s) => c[s].matchId === 2).length, 2);
});

test('A CARD IT CANNOT FILL IS LEFT SHORT - a DNF, not an illegal pick', () => {
  // Only two legal bats exist, so three slots go unfilled rather than
  // breaking the two-from-a-game cap.
  const thin = [P(1, 'arm', 1, 20), P(3, 'bat', 1, 12)];
  const c = chalkOctober(thin, CTX);
  assert.equal(Object.keys(c).length, 2);
  assert.equal(c.bat2, undefined);
});

test('THE GUT IS RANDOM INSIDE THE TOP TIER, and still legal', () => {
  // Deterministic rng: always the last of the tier.
  const c = gutOctober(POOL, CTX, () => 0.999);
  assert.equal(Object.keys(c).length, 4, 'two games, a four-slot card');
  assert.equal(slotsFor(BOARD).filter((s) => c[s].matchId === 1).length <= 2, true);
  // It differs from the chalk, which is the whole point of a second persona.
  const chalk = chalkOctober(POOL, CTX);
  assert.notDeepEqual(Object.values(c).map((p) => p.playerId), Object.values(chalk).map((p) => p.playerId));
});

test('THE HOMER TAKES ITS OWN WHERE TODAY HAS THEM, the chalk elsewhere', () => {
  const c = homerOctober(POOL, CTX);
  // KC is one of HOMER_TEAMS, so the KC arm and a KC bat go first.
  assert.equal(c.arm.playerId, '1');
  assert.equal(c.bat1.playerId, '3');
  // Then the cap binds and it falls to the chalk among what is left.
  assert.equal(c.bat2.playerId, '6');
  // ITS TEAMS ARE FOOTBALL TEAMS: a day with none of them is all chalk.
  const noOwn = POOL.map((p) => ({ ...p, team: 'SEA' }));
  assert.deepEqual(
    Object.values(homerOctober(noOwn, CTX)).map((p) => p.playerId),
    Object.values(chalkOctober(noOwn, CTX)).map((p) => p.playerId),
  );
});
