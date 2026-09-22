// services/live-poller/mlbPoll.test.mjs - the third league in the registry.
//
// WHAT COULD BREAK WITHOUT BEING SEEN: `enrich` is a new argument on the loop
// every live football game also goes through. So the football half is pinned
// first - a league with no enrich must call nothing and behave identically.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromMlb, fromBdl, scopeToStatus } from './poll.mjs';

const LIVE = {
  id: 5060114, season: 2026, postseason: false, season_type: 'regular',
  date: '2026-09-22T01:45:00.000Z',
  home_team_data: { hits: 9, runs: 5, errors: 0, inning_scores: [2, 2, 0, 0, 1, 0] },
  away_team_data: { hits: 3, runs: 1, errors: 0, inning_scores: [0, 0, 0, 1, 0, 0, 0] },
  status: 'STATUS_IN_PROGRESS', status_state: 'in_progress', period: 7,
  clock: 0, display_clock: '0:00', scoring_summary: [],
};
const PLAY = { order: 1, inning: 7, inning_type: 'Top', outs: 2, balls: 3, strikes: 2 };

test('fromMlb READS THE FIELDS THIS FEED HAS, and the play is optional', () => {
  const u = {};
  const without = fromMlb(LIVE, u);
  assert.equal(without.status, 'live');
  assert.deepEqual([without.homeScore, without.awayScore], [5, 1]);
  // NO PLAY: the inning and the half, honestly partial.
  assert.deepEqual(without.liveState, { period: 7, half: 'Top' });
  // WITH A PLAY: the outs and the count arrive, and the half is the play's.
  const withPlay = fromMlb(LIVE, u, { play: PLAY });
  assert.deepEqual(withPlay.liveState, { period: 7, half: 'Top', outs: 2, balls: 3, strikes: 2 });
  // THE SCORE DOES NOT DEPEND ON THE PLAY. A /plays route that 500s costs the
  // count and nothing else.
  assert.deepEqual([withPlay.homeScore, withPlay.awayScore], [5, 1]);
  assert.deepEqual(u, {});
});

test('NO CLOCK SURVIVES INTO THE LIVE STATE the poller writes', () => {
  // BDL sends clock 0 / "0:00" on every MLB row. live_state is what the
  // scoreboard chip reads, and a clock key there is a stopped clock on a live
  // game.
  const st = fromMlb(LIVE, {}, { play: PLAY }).liveState;
  assert.equal('clock' in st, false);
  assert.deepEqual(Object.keys(st).sort(), ['balls', 'half', 'outs', 'period', 'strikes']);
});

test('scopeToStatus IS UNCHANGED AND STILL THE GATE for baseball', () => {
  // A scheduled MLB row carries runs: 0 with no innings played - the same
  // zero-is-not-a-score trap CFBD has. The gate is shared, not re-implemented.
  const sched = fromMlb({ ...LIVE, status_state: 'scheduled', period: 1 }, {});
  const scoped = scopeToStatus(sched);
  assert.equal(scoped.homeScore, null);
  assert.equal(scoped.awayScore, null);
  assert.equal(scoped.liveState, null);
  // A live row keeps everything.
  const live = scopeToStatus(fromMlb(LIVE, {}, { play: PLAY }));
  assert.equal(live.homeScore, 5);
  assert.ok(live.liveState);
});

test('THE FOOTBALL NORMALISER IS UNTOUCHED by the third argument', () => {
  // fromBdl takes (row, unmapped) and is now called by a loop that may pass a
  // third. An extra argument to a two-argument function is inert - asserted
  // rather than assumed, because "inert" is exactly what nobody checks.
  const nfl = { id: 1, status_state: 'in_progress', status: '7:30 - 4th',
    home_team_score: 21, visitor_team_score: 14 };
  const a = fromBdl(nfl, {});
  const b = fromBdl(nfl, {}, { order: 1, outs: 2 });
  assert.deepEqual(a, b);
  assert.equal(a.homeScore, 21);
  assert.equal(a.awayScore, 14);
});

test('THE REGISTRY HAS THREE LEAGUES, and only MLB carries an enrich', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('./index.mjs', import.meta.url), 'utf8'));
  const body = src.slice(src.indexOf('const LEAGUES = ['), src.indexOf('async function slate'));
  for (const slug of ['cfb', 'nfl', 'mlb']) assert.ok(body.includes(`slug: '${slug}'`), slug);
  // ONE ENRICH, AND IT IS MLB'S. A football league that grew one silently
  // would add a per-game call to every poll of every Sunday.
  assert.equal((body.match(/enrich:/g) ?? []).length, 1);
  const mlbBlock = body.slice(body.indexOf("slug: 'mlb'"));
  // AND IT IS THE TWO-PROVIDER ONE. mlbEnrich asks BDL for the newest play
  // (outs, count) and statsapi for the feed (runners, batter, pitcher); an
  // entry that quietly went back to the play alone would take the diamond off
  // every card and nothing would fail.
  assert.match(mlbBlock, /enrich: mlbEnrich/);
  // AND ITS SECOND WRITER. Without `detail` the line score and the scoring
  // summary are never written and the game page has no line score, forever.
  assert.match(mlbBlock, /detail: mlbDetail/);
  // MLB ASKS FOR TWO DAYS. A 01:45Z first pitch is the previous calendar day
  // in every American sense and today in UTC; one day misses west-coast games.
  assert.match(mlbBlock, /day\(0\)/);
  assert.match(mlbBlock, /day\(-1\)/);
});

test('THE SECOND PROVIDER RIDES ON TOP, and never deletes what BDL just said', async () => {
  const { mergeStatsApi } = await import('../../lib/mlb/ingest.js');
  const bdl = { period: 7, half: 'Top', outs: 2, balls: 3, strikes: 2 };
  // statsapi reads the game feed and is the only source of runners; where the
  // two overlap it wins, because it reads the feed rather than the last play.
  const merged = mergeStatsApi(bdl, {
    half: 'Bottom', outs: 1, bases: { first: true, second: false, third: true },
    batter: 'J. Caminero', pitcher: 'L. Weaver',
  });
  assert.equal(merged.half, 'Bottom');
  assert.equal(merged.outs, 1);
  assert.equal(merged.period, 7, 'not sent, so BDL\'s survives');
  assert.equal(merged.balls, 3);
  assert.deepEqual(merged.bases, { first: true, second: false, third: true });

  // A FEED THAT CAME BACK WITHOUT BASES MUST NOT DELETE THE INNING. Every
  // field is tested for PRESENCE, not truthiness.
  assert.deepEqual(mergeStatsApi(bdl, {}), bdl);
  assert.deepEqual(mergeStatsApi(bdl, null), bdl);
  // outs: 0 AND balls: 0 ARE REAL READINGS - the sixth and seventh time this
  // build has had to say so.
  assert.equal(mergeStatsApi(bdl, { outs: 0 }).outs, 0);
  assert.equal(mergeStatsApi(bdl, { balls: 0, strikes: 0 }).balls, 0);
});

test('THE ET DAY IS THE AMERICAN CALENDAR DAY, which is the whole point', async () => {
  const { etDay } = await import('./poll.mjs');
  // A 01:45Z first pitch is the PREVIOUS evening's game in every sense a
  // reader has, and statsapi's officialDate agrees. Keying the schedule
  // lookup by the UTC day would miss every west-coast game by one.
  assert.equal(etDay('2026-09-23T01:45:00Z'), '2026-09-22');
  assert.equal(etDay('2026-09-22T17:05:00Z'), '2026-09-22');
  assert.equal(etDay(null), null);
  assert.equal(etDay('nonsense'), null);
});

test('THE gamePk IS RESOLVED ONCE AND THEN STORED ON THE ROW', async () => {
  const { resolveMlbGamePk, _resetMlbScheduleCache } = await import('./poll.mjs');
  _resetMlbScheduleCache();
  // A row that already holds it asks statsapi nothing at all - no schedule
  // fetch, no doubleheader judgement, and no chance to change its mind
  // mid-game about which half of one it is watching.
  let wrote = 0;
  const sql = () => { wrote += 1; return Promise.resolve([]); };
  const held = await resolveMlbGamePk(
    { id: 1, slug: 'x', external_ids: { statsapi_game_pk: '823543' } }, sql);
  assert.equal(held.gamePk, '823543');
  assert.equal(held.calls, 0);
  assert.equal(wrote, 0, 'and it does not rewrite what it already had');

  // A row with no abbreviations cannot build the key, so it refuses before
  // spending a call rather than fetching a day it cannot use.
  const nokey = await resolveMlbGamePk(
    { id: 2, slug: 'y', external_ids: {}, kickoff_at: '2026-09-22T17:05:00Z' }, sql);
  assert.equal(nokey.gamePk, null);
  assert.equal(nokey.calls, 0);
  assert.equal(wrote, 0);
});
