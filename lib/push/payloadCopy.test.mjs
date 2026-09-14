// lib/push/payloadCopy.test.mjs - what the five game notifications SAY.
//
// SCORE FIRST, EVENT SECOND, ON ONE LINE (relay ruling R3). The numbers are
// what survives a glance at a lock screen, so they lead; the word that says
// why they moved follows on the same line rather than in a body the phone may
// truncate away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pushPayload, scoreKindLabel } from './payload.js';

const base = { homeAbbr: 'KC', awayAbbr: 'SF', leagueSlug: 'nfl', slug: 'sf-kc', network: 'CBS' };

test('the title leads with the score and names the event after it', () => {
  const score = pushPayload('score', {
    ...base, homeScore: 21, awayScore: 14, period: 2, clock: '7:14',
    scoreKind: 'KC touchdown', scorer: 'D.Henry',
  });
  assert.equal(score.title, 'SF 14, KC 21 · KC touchdown, D.Henry');
  assert.equal(score.body, 'Q2 7:14 · CBS', 'the body keeps the clock and the network');
});

test('the kickoff push says Kickoff, in the title, once', () => {
  const kick = pushPayload('kickoff', { ...base, homeScore: 0, awayScore: 0 });
  assert.equal(kick.title, 'SF 0, KC 0 · Kickoff');
  assert.equal(kick.body, 'CBS', 'it moved out of the body and must not be said twice');
});

test('quarter, close and final keep their titles, and their bodies', () => {
  const q = pushPayload('quarter', { ...base, homeScore: 21, awayScore: 14, period: 2 });
  assert.equal(q.title, 'SF 14, KC 21');
  assert.equal(q.body, 'End of Q2 · CBS');
  const c = pushPayload('close', { ...base, homeScore: 21, awayScore: 20, period: 4, clock: '3:40' });
  assert.equal(c.title, 'SF 20, KC 21');
  assert.equal(c.body, 'One score, under five minutes · CBS');
  const f = pushPayload('final', { ...base, homeScore: 24, awayScore: 20 });
  assert.equal(f.title, 'SF 20, KC 24');
  assert.equal(f.body, 'Final · CBS');
});

test('A SCORER IS NAMED ONLY WHERE THE PLAY GAVE ONE', () => {
  const b = { ...base, homeScore: 16, awayScore: 14 };
  // A safety names nobody by design - the text is about the team that conceded
  // it - so the comma clause is absent rather than filled with a guess.
  assert.equal(pushPayload('score', { ...b, scoreKind: 'KC safety' }).title, 'SF 14, KC 16 · KC safety');
  assert.equal(pushPayload('score', { ...b, scoreKind: 'KC safety', scorer: null }).title, 'SF 14, KC 16 · KC safety');
});

test('the event word never rides a scoreline we do not have', () => {
  const p = pushPayload('score', {
    ...base, homeScore: null, awayScore: null, scoreKind: 'KC touchdown', scorer: 'D.Henry',
  });
  assert.equal(p.title, 'SF at KC');
});

test('no kind, no suffix - a score we cannot name is still a score', () => {
  const p = pushPayload('score', { ...base, homeScore: 21, awayScore: 14, period: 2, clock: '7:14' });
  assert.equal(p.title, 'SF 14, KC 21');
  assert.equal(p.body, 'Q2 7:14 · CBS');
});

test('the tag still replaces rather than stacks, one per game', () => {
  assert.equal(pushPayload('score', { ...base, homeScore: 1, awayScore: 0 }).tag, 'sv-game-sf-kc');
  assert.equal(pushPayload('final', { ...base, homeScore: 1, awayScore: 0 }).tag, 'sv-game-sf-kc');
});

test('THE DELTA-DERIVED FLOOR IS UNTOUCHED - it is what runs when no play landed', () => {
  assert.equal(scoreKindLabel(6, { teamAbbr: 'KC' }), 'KC touchdown');
  assert.equal(scoreKindLabel(3, { teamAbbr: 'KC' }), 'KC field goal');
  assert.equal(scoreKindLabel(1, { teamAbbr: 'KC' }), 'KC extra point');
  assert.equal(scoreKindLabel(2, { teamAbbr: 'KC' }), 'KC safety');
  assert.equal(scoreKindLabel(2, { teamAbbr: 'KC', priorWasTouchdown: true }), 'KC two-point');
  assert.equal(scoreKindLabel(0, { teamAbbr: 'KC' }), null, 'no name beats a guess');
  assert.equal(scoreKindLabel(4, { teamAbbr: 'KC' }), null);
});

test('no em dash reaches a lock screen', () => {
  for (const ev of ['score', 'kickoff', 'quarter', 'close', 'final']) {
    const p = pushPayload(ev, { ...base, homeScore: 21, awayScore: 14, period: 2, clock: '7:14', scoreKind: 'KC touchdown', scorer: 'D.Henry' });
    assert.equal(/[—–]/.test(`${p.title} ${p.body ?? ''}`), false, `${ev} carries a dash`);
  }
});
