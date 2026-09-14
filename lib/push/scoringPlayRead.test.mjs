// lib/push/scoringPlayRead.test.mjs - finding the play that moved the score.
//
// The numbers these tests are built on are measured, not assumed: across the
// final NFL games of the 13 Sep 2026 slate there were 124 scoring plays, the
// MEDIAN gap between one and the next was 13 plays and the MAXIMUM was 79.
// The lookback was six. It worked only because the score poller and the plays
// cron happen to keep pace, and it would have failed silently the first time
// they did not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoringPlayFor, LOOKBACK } from './scoringPlayRead.js';

// A tagged-template stand-in for the poller's client. Records the values it
// was interpolated with so the LIMIT can be asserted, and returns a fixture.
function fakeSql(rows, spy = {}) {
  return (strings, ...values) => {
    spy.values = values;
    spy.calls = (spy.calls ?? 0) + 1;
    return Promise.resolve(rows);
  };
}

const filler = (n, home, away, fromId = 1000) => Array.from({ length: n }, (_, i) => ({
  id: fromId - i,
  play_type: 'rush',
  text: '(Shotgun) A.Back rush right for 4 yards gain to the KC33',
  home_score: home, away_score: away, period: 2, clock: '7:14',
}));

const TD = {
  id: 500, play_type: 'rushing-touchdown',
  text: 'D.Henry right tackle for 4 yards, TOUCHDOWN. T.Loop extra point is GOOD, Center-N.Moore, Holder-R.Eckley.',
  home_score: 21, away_score: 14, period: 2, clock: '7:14',
};
const OLDER_TD = {
  id: 100, play_type: 'passing-touchdown',
  text: 'P.Mahomes pass short right to T.Kelce for 9 yards, TOUCHDOWN. H.Butker extra point is GOOD.',
  home_score: 14, away_score: 14, period: 1, clock: '2:02',
};

test('the lookback is 40, and it is what the query asks for', async () => {
  assert.equal(LOOKBACK, 40);
  const spy = {};
  await scoringPlayFor(fakeSql([TD], spy), 7, { homeScore: 20, awayScore: 14 });
  assert.ok(spy.values.includes(40), `the LIMIT must be 40, got ${JSON.stringify(spy.values)}`);
  assert.ok(spy.values.includes(7), 'and the match id is bound, not interpolated');
});

test('THE WORST OBSERVED GAP STILL RESOLVES: a scoring play 39 rows deep', async () => {
  // 79 was the slate's maximum gap between two scoring plays. The poller
  // cannot be 79 plays late in one tick, but it can be tens - and at six it
  // was already losing. Thirty-nine rows of filler then the touchdown.
  const rows = [...filler(39, 21, 14, 1000), TD];
  const got = await scoringPlayFor(fakeSql(rows), 7, { homeScore: 20, awayScore: 14 });
  assert.ok(got, 'must not return null at the bottom of the window');
  assert.equal(got.kind, 'touchdown');
  assert.equal(got.scorer, 'D.Henry');
  assert.equal(got.tryKind, 'kick-good');
});

test('A BATCH LANDING BETWEEN THE SCORE AND THE LOOKUP still resolves', async () => {
  // The plays cron writes a catch-up run: twenty rows land on top of the
  // touchdown before the poller looks. Under the old lookback of six the
  // touchdown was out of the window and this returned null.
  const rows = [...filler(20, 21, 14, 1000), TD, ...filler(5, 14, 14, 400)];
  const got = await scoringPlayFor(fakeSql(rows), 7, { homeScore: 20, awayScore: 14 });
  assert.equal(got.scorer, 'D.Henry');
  assert.equal(got.homeScore, 21, "and it hands back the play's own post-try score");
  assert.equal(got.awayScore, 14);
});

test('THE FLOOR STOPS THE SCAN at a play we have already reported', async () => {
  // Nothing newer than the observed scoreline is in the window at all - the
  // only scoring play present is an OLDER one, from a board of 28. Reporting
  // it would announce a touchdown from ten minutes ago.
  const rows = [...filler(3, 14, 14, 300), OLDER_TD, ...filler(3, 7, 7, 50)];
  const got = await scoringPlayFor(fakeSql(rows), 7, { homeScore: 20, awayScore: 14 });
  assert.equal(got, null, 'a board behind where we already are is behind us');
});

test('the floor stops BEFORE the parser, so an old scoring play is never read', async () => {
  // The first row already sits below the observed scoreline; the scan must end
  // there rather than walk on and find OLDER_TD underneath it.
  const rows = [{ ...filler(1, 14, 14, 300)[0] }, OLDER_TD];
  assert.equal(await scoringPlayFor(fakeSql(rows), 7, { homeScore: 20, awayScore: 14 }), null);
});

test('a row with no scoreline is not a floor, and is still offered to the parser', async () => {
  const noScore = { id: 900, play_type: 'rush', text: 'A.Back rush', home_score: null, away_score: null };
  const rows = [noScore, TD];
  const got = await scoringPlayFor(fakeSql(rows), 7, { homeScore: 20, awayScore: 14 });
  assert.equal(got.scorer, 'D.Henry', 'a null score must not end the scan');
});

test('the scoring play at the very top of the window resolves', async () => {
  const got = await scoringPlayFor(fakeSql([TD, ...filler(10, 14, 14, 400)]), 7, { homeScore: 20, awayScore: 14 });
  assert.equal(got.scorer, 'D.Henry');
});

// ---------------------------------------------------------------------------
// THE NULL PATH - the join is the enrichment, never the dependency
// ---------------------------------------------------------------------------
test('NO ROWS degrades to null, which is the delta-derived wording', async () => {
  assert.equal(await scoringPlayFor(fakeSql([]), 7, { homeScore: 20, awayScore: 14 }), null);
});

test('a window of nothing but non-scoring plays degrades to null', async () => {
  const rows = filler(40, 21, 14, 1000);
  assert.equal(await scoringPlayFor(fakeSql(rows), 7, { homeScore: 20, awayScore: 14 }), null);
});

test('A THROWN QUERY COSTS THE ENRICHMENT AND NOTHING ELSE', async () => {
  const boom = () => { throw new Error('connection reset'); };
  assert.equal(await scoringPlayFor(boom, 7, { homeScore: 20, awayScore: 14 }), null,
    'it must never propagate - a notification is a courtesy on top of a scoreboard');
});

test('a rejected query is also just a null', async () => {
  const rejects = () => Promise.reject(new Error('timeout'));
  assert.equal(await scoringPlayFor(rejects, 7, { homeScore: 20, awayScore: 14 }), null);
});

test('no match id is null without asking the database anything', async () => {
  const spy = {};
  assert.equal(await scoringPlayFor(fakeSql([TD], spy), null, { homeScore: 1, awayScore: 0 }), null);
  assert.equal(spy.calls ?? 0, 0, 'and it did not spend a query to find that out');
});

test('a missing observed scoreline reads as zero, so the floor never fires early', async () => {
  const got = await scoringPlayFor(fakeSql([TD]), 7, {});
  assert.equal(got.scorer, 'D.Henry', 'with no floor to apply, the newest scoring play wins');
});
