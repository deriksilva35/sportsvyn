// lib/house/personas.test.mjs - who the house is, and what it claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONAS, PARKED, HOUSE_HANDLES, HOMER_TEAMS, FADE_MAX,
  playsGame, methodLine, personaByHandle,
} from './personas.js';
import { houseMark, withHouse, houseElapsed } from './mark.js';
import { validateHandle } from '../daily/handles.js';

test('FOUR PERSONAS SHIP, and The Book is parked with a real reason', () => {
  assert.deepEqual(PERSONAS.map((p) => p.key), ['chalk', 'fade', 'gut', 'homer']);
  assert.deepEqual(PARKED.map((p) => p.key), ['book'],
    'no gridiron model exists, so The Book would file The Chalk\'s entry');
});

test('EVERY PERSONA HAS A METHOD FOR EVERY GAME IT PLAYS, and none for the rest', () => {
  for (const p of PERSONAS) {
    for (const game of ['daily', 'pickem', 'weekly', 'draft']) {
      const line = methodLine(p.key, game);
      if (p.plays.includes(game)) {
        assert.ok(line && line.length > 10, `${p.key} plays ${game} and must say how`);
        assert.equal(/\{|\}/.test(line), false, `${p.key}/${game} has an unfilled placeholder`);
      } else {
        assert.equal(line, null, `${p.key} does not play ${game} and must claim nothing`);
      }
    }
  }
});

test('THE CHALK IS OFF THE DAILY - it was the answer key, not a persona', () => {
  assert.equal(playsGame('chalk', 'daily'), false);
  assert.equal(methodLine('chalk', 'daily'), null);
  // It still plays the other three, where the obvious pick is beatable.
  for (const g of ['pickem', 'weekly', 'draft']) assert.equal(playsGame('chalk', g), true, g);
});

test('THE DAILY FIELD IS GUT AND HOMER, and nobody else', () => {
  const play = PERSONAS.filter((p) => p.plays.includes('daily')).map((p) => p.key);
  assert.deepEqual(play, ['gut', 'homer']);
});

test('THE FADE PLAYS ONLY WHERE THERE IS A LINE TO FADE (ruling R1)', () => {
  assert.equal(playsGame('fade', 'pickem'), true);
  assert.equal(playsGame('fade', 'draft'), true);
  assert.equal(playsGame('fade', 'daily'), false, 'the Daily board has no line on it');
  assert.equal(playsGame('fade', 'weekly'), false, 'nor does a player board');
});

test('the Fade\'s method line prints the real threshold, not the token', () => {
  const line = methodLine('fade', 'pickem');
  assert.match(line, new RegExp(`inside ${FADE_MAX} points`));
  assert.match(line, /Unpriced games are skipped/);
});

test('the Chalk\'s Weekly line says career PPG, not projection (ruling R3)', () => {
  assert.match(methodLine('chalk', 'weekly'), /career PPG/);
  assert.equal(/projection/i.test(methodLine('chalk', 'weekly')), false,
    'there is no projection in this product and the line must not claim one');
});

test('the Homer\'s Daily line states BOTH halves of its rule (ruling R1)', () => {
  const line = methodLine('homer', 'daily');
  assert.match(line, /own teams/i);
  assert.match(line, /chalk/i, 'a reader watching it take a stranger deserves to know why');
});

test('EVERY HOUSE HANDLE IS A LEGAL HANDLE, and every one is reserved', () => {
  for (const h of HOUSE_HANDLES) {
    // Legal by shape - these are real rows in `users`, not special cases.
    assert.match(h, /^[A-Za-z0-9_]{3,15}$/, `${h} is not a legal handle shape`);
    assert.equal(h.includes('__'), false);
    // And refused to everybody else.
    const v = validateHandle(h);
    assert.equal(v.ok, false, `${h} must be reserved`);
    assert.equal(v.reason, 'reserved');
    assert.equal(validateHandle(h.replace('_', '')).reason, 'reserved', `${h} without the underscore too`);
  }
});

test('a normal handle is still allowed', () => {
  assert.equal(validateHandle('Normal_Name').ok, true);
});

test('personaByHandle is case-insensitive and tolerates the at-sign', () => {
  assert.equal(personaByHandle('The_Chalk').key, 'chalk');
  assert.equal(personaByHandle('the_chalk').key, 'chalk');
  assert.equal(personaByHandle('@The_Chalk').key, 'chalk');
  assert.equal(personaByHandle('somebody'), null);
  assert.equal(personaByHandle(null), null);
});

test('the Homer\'s teams are fixed - a homer that changes its mind is not one', () => {
  assert.deepEqual([...HOMER_TEAMS], ['KC', 'GB', 'DAL', 'BUF']);
  assert.equal(Object.isFrozen(HOMER_TEAMS), true);
});

// ---------------------------------------------------------------------------
// THE MARK
// ---------------------------------------------------------------------------
test('a person is never marked', () => {
  assert.deepEqual(houseMark({ isHouse: false, handle: 'Someone' }, 'daily'),
    { house: false, persona: null, personaName: null, method: null });
  assert.deepEqual(houseMark({}, 'daily').house, false);
});

test('a house row carries the marker AND the method for that game', () => {
  const m = houseMark({ isHouse: true, handle: 'The_Fade' }, 'pickem');
  assert.equal(m.house, true);
  assert.equal(m.persona, 'fade');
  assert.equal(m.personaName, 'The Fade');
  assert.match(m.method, /underdog/);
});

test('A HOUSE ROW ON A GAME ITS PERSONA DOES NOT PLAY IS STILL MARKED, and claims nothing', () => {
  // It should not occur - no entry is filed - but if it ever does, "this is
  // the house" with no method beats a blank row pretending to be a person.
  const m = houseMark({ isHouse: true, handle: 'The_Fade' }, 'daily');
  assert.equal(m.house, true);
  assert.equal(m.method, null);
});

test('withHouse spreads onto a row without disturbing it', () => {
  const row = withHouse({ userId: 5, score: 12 }, { isHouse: true, handle: 'The_Gut' }, 'weekly');
  assert.equal(row.userId, 5);
  assert.equal(row.score, 12);
  assert.equal(row.persona, 'gut');
});

test('ELAPSED IS A DASH FOR A HOUSE ROW, and untouched for a person', () => {
  assert.equal(houseElapsed({ house: true }, 2), '-');
  assert.equal(houseElapsed({ house: false }, 137), 137);
  assert.equal(houseElapsed(null, 137), 137);
});
