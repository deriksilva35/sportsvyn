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
  const withPlay = fromMlb(LIVE, u, PLAY);
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
  const st = fromMlb(LIVE, {}, PLAY).liveState;
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
  const live = scopeToStatus(fromMlb(LIVE, {}, PLAY));
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
  assert.match(mlbBlock, /enrich: async \(row\) => mlbNewestPlay/);
  // MLB ASKS FOR TWO DAYS. A 01:45Z first pitch is the previous calendar day
  // in every American sense and today in UTC; one day misses west-coast games.
  assert.match(mlbBlock, /day\(0\)/);
  assert.match(mlbBlock, /day\(-1\)/);
});
