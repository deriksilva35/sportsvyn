import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  outsLabel, countLabel, basesLabel, situationLine, stripCells, baseballStrip, newestScoringPlay,
} from './strip.js';

test('outs and the count are dropped whole when they are not known', () => {
  assert.equal(outsLabel(0), '0 out');
  assert.equal(outsLabel(1), '1 out', 'singular, and it is the only singular');
  assert.equal(outsLabel(2), '2 out');
  // Number(null) IS 0 AND FINITE - the fourth time this trap has appeared in
  // this build. Unguarded, "the provider did not say" renders as "0 out".
  assert.equal(outsLabel(null), null);
  assert.equal(outsLabel(undefined), null);
  assert.equal(outsLabel(''), null);
  assert.equal(outsLabel(4), null, 'four outs is not a state this sport has');
  assert.equal(outsLabel(-1), null);
  assert.equal(countLabel(3, 2), '3-2');
  assert.equal(countLabel(0, 0), '0-0', 'a fresh count is a real count');
  // "3-" IS NOT A COUNT. Both halves or neither.
  assert.equal(countLabel(3, null), null, 'not "3-0"');
  assert.equal(countLabel(null, 2), null);
  assert.equal(countLabel(3, ''), null);
  assert.equal(countLabel(undefined, undefined), null);
  assert.equal(countLabel(5, 2), null);
  assert.equal(countLabel(3, 4), null);
});

test('THE DIAMOND IS ABSENT, NOT EMPTY, WHEN THE BASES ARE UNKNOWN', () => {
  // The single most important distinction in this module. balldontlie carries
  // no runners at all, so with MLB_STATSAPI off the bases are null on every
  // game - and "bases empty" would then be a claim made on every pitch of
  // every game, on no evidence.
  assert.equal(basesLabel(null), null);
  assert.equal(basesLabel(undefined), null);
  assert.equal(basesLabel({ first: false, second: false, third: false }), 'bases empty');
  assert.equal(basesLabel({ first: true, second: false, third: true }), 'runners 1st, 3rd');
  assert.equal(basesLabel({ first: true, second: false, third: false }), 'runners 1st');
  assert.equal(basesLabel({ first: false, second: true, third: false }), 'runners 2nd');
  assert.equal(basesLabel({ first: true, second: true, third: true }), 'bases loaded');
  assert.equal(basesLabel({ first: true, second: true, third: false }), 'runners 1st, 2nd');
});

test('THE SITUATION LINE drops each part it does not have', () => {
  assert.equal(situationLine({ period: 7, half: 'Top', outs: 2, balls: 3, strikes: 2,
    bases: { first: true, second: false, third: true } }),
  'Top 7th · 2 out · 3-2 · runners 1st, 3rd');
  // No bases (the flag is off): the line is still true, just shorter.
  assert.equal(situationLine({ period: 7, half: 'Top', outs: 2, balls: 3, strikes: 2 }),
    'Top 7th · 2 out · 3-2');
  // No play yet this poll: the inning and the half alone.
  assert.equal(situationLine({ period: 7, half: 'Bottom' }), 'Bot 7th');
  assert.equal(situationLine({ period: 9 }), '9th', 'no half is still an inning');
  assert.equal(situationLine(null), null);
  assert.equal(situationLine({}), null);
});

test('NOBODY IS BATTING BETWEEN HALVES, so the count does not ride into it', () => {
  // In Mid and End the outs and count belong to the half that just ended.
  // Carrying "3 out · 3-2" into "Mid 7th" describes a moment that is over.
  assert.equal(situationLine({ period: 7, half: 'Mid', outs: 3, balls: 3, strikes: 2,
    bases: { first: true, second: false, third: false } }), 'Mid 7th');
  assert.equal(situationLine({ period: 7, half: 'End', outs: 3 }), 'End 7th');
});

test('THE STRIP IS NULL WHEN THERE IS NOTHING TO DRAW', () => {
  const live = { period: 7, half: 'Top', outs: 1, balls: 0, strikes: 0 };
  assert.equal(baseballStrip({ status: 'scheduled', liveState: live }), null);
  assert.equal(baseballStrip({ status: 'final', liveState: live }), null);
  assert.equal(baseballStrip({ status: 'live', liveState: null }), null);
  const s = baseballStrip({ status: 'live', liveState: live });
  assert.equal(s.line, 'Top 7th · 1 out · 0-0');
  assert.equal(s.bases, null, 'null, so the card omits the diamond entirely');
  assert.equal(s.between, false);
  const withBases = baseballStrip({ status: 'live',
    liveState: { ...live, bases: { first: false, second: false, third: false } } });
  assert.deepEqual(withBases.bases, { first: false, second: false, third: false },
    'known and empty - the card draws an EMPTY diamond, which is a different thing');
});

test('THE NEWEST SCORING PLAY IS THE LAST, and the order is stated not assumed', () => {
  const plays = [
    { text: 'first run of the game', inning: '1st' },
    { text: 'Alonso homered to left (400 feet).', inning: '8th' },
  ];
  assert.equal(newestScoringPlay(plays).text, 'Alonso homered to left (400 feet).');
  assert.equal(baseballStrip({ status: 'live', liveState: { period: 8, half: 'Bottom' }, scoringPlays: plays })
    .lastPlay, 'Alonso homered to left (400 feet).');
  assert.equal(newestScoringPlay([]), null);
  assert.equal(newestScoringPlay(null), null);
  assert.equal(newestScoringPlay([{ text: '' }]), null, 'a textless row is not a play');
});

test("THE MOCK'S THREE CELLS, frame by frame", () => {
  // docs/design/mocks/mlb-scores-v0_1.html, live card 1: the left cell is the
  // OUTS with the half small beside it - not the half with the outs beside it.
  // Read off the mock rather than remembered: <span class="st">2 out<small>Top
  // 7th</small></span> and <span class="cnt"><small>count</small>3-2</span>.
  assert.deepEqual(
    stripCells({ period: 7, half: 'Top', outs: 2, balls: 3, strikes: 2 }),
    { lead: '2 out', sub: 'Top 7th', count: '3-2' });

  // Mock live card 2: <span class="st">Mid 4th<small>changing sides</small>
  // </span> and an EMPTY count cell.
  assert.deepEqual(
    stripCells({ period: 4, half: 'Mid', outs: 3, balls: 1, strikes: 2 }),
    { lead: 'Mid 4th', sub: 'changing sides', count: null });

  // THE LEFT CELL IS NEVER A PLACEHOLDER. With no play row this poll there
  // are no outs, so the half moves INTO the lead - the mock's loudest text
  // must always be something true, and "— out" is not.
  assert.deepEqual(
    stripCells({ period: 7, half: 'Bottom' }),
    { lead: 'Bot 7th', sub: null, count: null });
  assert.deepEqual(
    stripCells({ period: 7, half: 'Bottom', balls: 1, strikes: 2 }),
    { lead: 'Bot 7th', sub: null, count: '1-2' },
    'a known count still rides when the outs are not known');

  assert.equal(stripCells(null), null);
  assert.equal(stripCells({}), null);
});

test('THE DIAMOND GOES WITH THE COUNT BETWEEN HALVES', () => {
  // The mock draws .dia.none in Mid - no runners at all. A diamond left
  // standing there shows whoever was on when the third out was recorded,
  // which is a picture of a moment that has ended.
  const s = baseballStrip({ status: 'live',
    liveState: { period: 4, half: 'Mid', outs: 3, bases: { first: true, second: true, third: false } } });
  assert.equal(s.bases, null, 'dropped, not drawn');
  assert.equal(s.count, null);
  assert.equal(s.between, true);
  assert.equal(s.lead, 'Mid 4th');
  // And in play it survives.
  const inPlay = baseballStrip({ status: 'live',
    liveState: { period: 4, half: 'Top', outs: 1, bases: { first: true, second: true, third: false } } });
  assert.deepEqual(inPlay.bases, { first: true, second: true, third: false });
});
