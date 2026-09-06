// lib/live/teamAbbr.test.mjs - a team always has something to be called
// (defect 1). PURE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbbr } from './teamAbbr.js';
import { scoreHeadline } from './scoreEvent.js';

test('the abbreviation wins when we have one', () => {
  const r = resolveAbbr({ abbreviation: 'SYR', short_name: 'Syracuse', name: 'Syracuse Orange' });
  assert.deepEqual(r, { value: 'SYR', source: 'abbreviation' });
});

test('short_name is next, then a derived code - in that order', () => {
  assert.deepEqual(resolveAbbr({ abbreviation: null, short_name: 'Syracuse', name: 'Syracuse Orange' }),
    { value: 'Syracuse', source: 'short_name' });
  assert.deepEqual(resolveAbbr({ abbreviation: '', short_name: '', name: 'Syracuse' }),
    { value: 'SYRA', source: 'derived' });
});

test('a multi-word name derives initials, capped at four', () => {
  // '&' is stripped to a space, so this is three words: T-A-M.
  assert.equal(resolveAbbr({ name: 'Texas A&M' }).value, 'TAM');
  assert.equal(resolveAbbr({ name: 'Southern Methodist University' }).value, 'SMU');
  assert.equal(resolveAbbr({ name: 'North Carolina Agricultural and Technical State' }).value, 'NCAA');
});

test('only a team with no name at all resolves to nothing', () => {
  assert.deepEqual(resolveAbbr({}), { value: null, source: 'none' });
  assert.deepEqual(resolveAbbr({ abbreviation: null, short_name: null, name: '   ' }),
    { value: null, source: 'none' });
});

test('THE DEFECT: a match whose HOME team has a null abbr still gets a headline', () => {
  // This returned null before, which killed the Wire event and - through
  // pushPayload's identical guard - every push for the match, silently.
  const h = scoreHeadline({
    awayAbbr: 'ECU', awayScore: 10,
    homeAbbr: null, homeScore: 48,
    home: { short_name: null, name: 'Alabama Crimson Tide' },
    liveState: { period: 4, clock: '06:15' },
    matchId: 1,
  });
  assert.equal(h, 'ECU 10, ACT 48 · Q4 06:15');
});

test('and with a short_name it uses that rather than deriving', () => {
  assert.equal(scoreHeadline({
    awayAbbr: null, awayScore: 3, homeAbbr: 'SYR', homeScore: 66,
    away: { short_name: 'Colgate', name: 'Colgate Raiders' }, matchId: 2,
  }), 'Colgate 3, SYR 66');
});

test('a null SCORE still refuses - that guard was always right', () => {
  assert.equal(scoreHeadline({ awayAbbr: 'A', awayScore: null, homeAbbr: 'B', homeScore: 1 }), null);
});
