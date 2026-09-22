// lib/mlb/statsapi.test.mjs - the second provider, and the flag that makes it
// optional. Fixtures are the real shapes, read off statsapi.mlb.com 22 Sep 2026.
//
// THE TEST THE RELAY ASKED FOR IS THE LAST ONE: the card renders with the flag
// off. Everything above it is there so that test means something - a seam that
// returned undefined for every reason would also "render with the flag off".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  statsApiEnabled, basesOf, liveFrom, probablesFrom, fetchLiveState, fetchProbables, matchKey,
} from './statsapi.js';
import { shortOf, BASEBALL } from '../live/vocabulary.js';

/** liveData.linescore, from game 823169, exactly as served. */
const LINESCORE = {
  currentInning: 9, inningHalf: 'Top', inningState: 'Top',
  outs: 3, balls: 2, strikes: 1,
  offense: { batter: { id: 815589, fullName: 'Bo Davidson' }, battingOrder: 1, team: { id: 142 } },
  defense: { pitcher: { id: 805673, fullName: 'Zebby Matthews' }, catcher: { id: 1 }, team: { id: 137 } },
};
const SCHED_GAME = {
  gamePk: 823543,
  teams: {
    away: { team: { name: 'Tampa Bay Rays' }, probablePitcher: { id: 641771, fullName: 'Nick Martinez' } },
    home: { team: { name: 'New York Yankees' }, probablePitcher: { id: 605400, fullName: 'Carlos Rodón' } },
  },
};

test('THE FLAG IS OFF UNLESS IT SAYS on, and nothing is fetched while it is', async () => {
  assert.equal(statsApiEnabled({}), false, 'a missing var is off');
  assert.equal(statsApiEnabled({ MLB_STATSAPI: '' }), false);
  assert.equal(statsApiEnabled({ MLB_STATSAPI: 'off' }), false);
  assert.equal(statsApiEnabled({ MLB_STATSAPI: 'true' }), false, 'only the literal "on"');
  assert.equal(statsApiEnabled({ MLB_STATSAPI: 'on' }), true);
  assert.equal(statsApiEnabled({ MLB_STATSAPI: ' ON ' }), true);
  // AND THE GUARD IS BEFORE THE FETCH, not after it: these resolve without a
  // network call at all, which is what makes the flag safe to leave off in an
  // environment with no outbound access.
  assert.equal(await fetchLiveState(823169, { env: {} }), null);
  assert.deepEqual(await fetchProbables('2026-09-22', { env: {} }), new Map());
  assert.equal(await fetchLiveState(null, { env: { MLB_STATSAPI: 'on' } }), null);
});

test('EMPTY BASES AND UNKNOWN BASES ARE DIFFERENT THINGS', () => {
  // THE SUBTLE PART OF THIS PROVIDER. linescore.offense carries `first`,
  // `second` and `third` ONLY WHEN OCCUPIED - an empty base is an ABSENT KEY,
  // not a false. So in the raw payload "nobody on" and "we have no idea" look
  // identical, and they must not: one draws an empty diamond, the other draws
  // no diamond at all.
  assert.equal(basesOf(null), null, 'no offense object at all is UNKNOWN');
  assert.equal(basesOf(undefined), null);
  assert.equal(basesOf('nope'), null);
  assert.deepEqual(basesOf({ batter: { id: 1 } }), { first: false, second: false, third: false },
    'an offense object with no bases is KNOWN, and nobody is on');
  assert.deepEqual(basesOf({ first: { id: 2 }, third: { id: 3 } }),
    { first: true, second: false, third: true });
  // A key present but empty is not a runner.
  assert.deepEqual(basesOf({ first: {} }), { first: false, second: false, third: false });
  assert.deepEqual(basesOf({ first: null }), { first: false, second: false, third: false });
});

test('THE LIVE STATE COMES BACK IN OUR OWN VOCABULARY', () => {
  const s = liveFrom({ liveData: { linescore: LINESCORE } });
  assert.equal(s.period, 9);
  assert.equal(s.half, 'Top');
  assert.deepEqual([s.outs, s.balls, s.strikes], [3, 2, 1]);
  assert.equal(s.batter, 'Bo Davidson');
  assert.equal(s.pitcher, 'Zebby Matthews');
  assert.deepEqual(s.bases, { first: false, second: false, third: false });
  // AND IT FEEDS shortOf DIRECTLY - the point of normalising here rather than
  // at each reader is that one label function serves both providers.
  assert.equal(shortOf(s, BASEBALL), 'Top 9th');
});

test('inningState WINS OVER inningHalf, because it has the two states half cannot say', () => {
  // inningHalf only ever says Top or Bottom. inningState says Middle and End
  // as well, which are exactly the moments a card should say "nobody is
  // batting" rather than naming a side.
  const at = (state, half) => liveFrom({ liveData: { linescore: { ...LINESCORE, inningState: state, inningHalf: half } } }).half;
  assert.equal(at('Middle', 'Bottom'), 'Mid');
  assert.equal(at('End', 'Top'), 'End');
  assert.equal(at('Top', 'Top'), 'Top');
  assert.equal(at('Bottom', 'Bottom'), 'Bottom');
  // Falls back to inningHalf when the state is absent, and to null when both are.
  assert.equal(liveFrom({ liveData: { linescore: { ...LINESCORE, inningState: null } } }).half, 'Top');
  assert.equal(liveFrom({ liveData: { linescore: { ...LINESCORE, inningState: null, inningHalf: null } } }).half, null);
  // An unrecognised word is null rather than a guess.
  assert.equal(at('Interlude', null), null);
});

test('NO LINESCORE, NO STATE - and never a throw', () => {
  assert.equal(liveFrom(null), null);
  assert.equal(liveFrom({}), null);
  assert.equal(liveFrom({ liveData: {} }), null);
  // A game that has not started has a linescore with no currentInning.
  assert.equal(liveFrom({ liveData: { linescore: { offense: {}, defense: {} } } }), null);
});

test('PROBABLES need both halves of a name, and hydrate is why they are there', () => {
  assert.deepEqual(probablesFrom(SCHED_GAME), {
    away: { id: '641771', name: 'Nick Martinez' },
    home: { id: '605400', name: 'Carlos Rodón' },
  });
  // One side announced is still worth showing.
  const oneSide = { teams: { away: SCHED_GAME.teams.away, home: { team: { name: 'X' } } } };
  assert.deepEqual(probablesFrom(oneSide).home, null);
  assert.equal(probablesFrom(oneSide).away.name, 'Nick Martinez');
  // Neither announced is NULL, not an object of nulls - the card shows no
  // probables line at all rather than an empty one.
  assert.equal(probablesFrom({ teams: { away: {}, home: {} } }), null);
  assert.equal(probablesFrom({}), null);
  // A pitcher with an id and no name is not a probable anybody can print.
  assert.equal(probablesFrom({ teams: { away: { probablePitcher: { id: 1 } }, home: {} } }), null);
});

test('THE gamePk JOIN IS NOT THE DATE, and this module refuses to guess it', () => {
  // statsapi returned 16 games for 2026-09-22 where BDL returned 11: the two
  // disagree about which day a 01:45Z first pitch belongs to. So the key is
  // the two abbreviations AND the official date, built by the caller that
  // holds our rows.
  assert.equal(matchKey('MIN', 'SF', '2026-09-21T00:00:00Z'), '2026-09-21:MIN@SF');
  assert.equal(matchKey('min', 'sf', '2026-09-21'), '2026-09-21:MIN@SF');
  assert.equal(matchKey('MIN', null, '2026-09-21'), null);
  assert.equal(matchKey(null, 'SF', '2026-09-21'), null);
  assert.equal(matchKey('MIN', 'SF', null), null);
});

test('THE CARD RENDERS WITH THE FLAG OFF - the one this seam exists to guarantee', async () => {
  // With MLB_STATSAPI unset, a live card is built from balldontlie alone: the
  // inning and half from /games, the outs and count from /plays. What it loses
  // is the diamond and the probables, and NOTHING ELSE.
  const bdlOnly = { period: 7, half: 'Top', outs: 2, balls: 3, strikes: 2 };
  assert.equal(shortOf(bdlOnly, BASEBALL), 'Top 7th');
  assert.deepEqual([bdlOnly.outs, bdlOnly.balls, bdlOnly.strikes], [2, 3, 2]);
  // The enrichment is absent, and absent is DISTINGUISHABLE from empty, which
  // is what lets the strip omit the diamond rather than draw an empty one.
  const enrichment = await fetchLiveState(823169, { env: {} });
  assert.equal(enrichment, null);
  assert.equal(bdlOnly.bases ?? null, null);
  assert.equal(basesOf(bdlOnly.bases), null, 'no bases key means no diamond');
  // And the probables line simply has nothing to render.
  assert.equal((await fetchProbables('2026-09-22', { env: {} })).size, 0);
});
