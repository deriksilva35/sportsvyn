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
  // AND IT IS THE ONLY LEAGUE ENRICHED BEFORE FIRST PITCH. The posted batting
  // order is the pool of bats October and The Run offer, and it goes up hours
  // BEFORE the game - an enrichment that only ran on live rows would see it for
  // the first time when it was already too late to pick against. A football
  // league that grew this flag would add a per-game call to every pre-kick poll
  // of every Sunday.
  assert.match(mlbBlock, /enrichScheduled: true/);
  assert.equal((body.match(/enrichScheduled:/g) ?? []).length, 1);
  // AND THE LOOP HANDS IT ON. Without this line the flag is a comment.
  assert.match(src, /enrichScheduled: lg\.enrichScheduled === true/);
});

test('THE PRE-KICK PASS READS THE CARD AND NOTHING ELSE', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('./poll.mjs', import.meta.url), 'utf8'));
  // THE LINEUP WRITE IS NOT HUNG OFF writeLive'S RESULT. writeLive returns null
  // when nothing about the score changed, which is EVERY pre-kick poll, so a
  // lineup write placed after `if (!after) continue` would never land on the
  // one kind of row that has a lineup and no score.
  const loop = src.slice(src.indexOf('for (const m of candidates)'));
  const writeIdx = loop.indexOf('writeMlbLineups');
  const afterIdx = loop.indexOf('const after = await writeLive');
  assert.ok(writeIdx > -1 && afterIdx > -1);
  assert.ok(writeIdx < afterIdx,
    'the batting orders are written BEFORE the scoreline and independently of it');
  // THE HELD VALUE IS SELECTED, or lineupDue() reads "never asked" every poll.
  assert.match(src, /m\.metadata->'lineups' AS before_lineups/);
});

test('mlbEnrich LIVE: one plate-appearance page carries the diamond, the outs, the count and who is at the plate - all BDL', async () => {
  const { mlbEnrich, _resetMlbProbablesCache } = await import('./poll.mjs');
  const { _resetNameCache } = await import('../../lib/mlb/bdlLive.js');
  _resetMlbProbablesCache(); _resetNameCache();
  const real = globalThis.fetch; const seen = [];
  globalThis.fetch = async (url) => {
    const u = String(url); seen.push(u);
    if (u.includes('/mlb/v1/plate_appearances')) return { ok: true, json: async () => ({ data: [
      { pa_number: 40, inning: 7, half_inning: 'top', outs: 2, runner_on_first: true, runner_on_second: false, runner_on_third: true,
        batter_id: 11, pitcher_id: 22, result: 'Single', pitches: [] },
      // THE NEWEST PA WINS, and "Batter Timeout" is not an outcome: still at bat, 1-2 after a foul.
      { pa_number: 41, inning: 7, half_inning: 'top', outs: 2, runner_on_first: true, runner_on_second: true, runner_on_third: false,
        batter_id: 33, pitcher_id: 22, result: 'Batter Timeout',
        pitches: [{ balls: 0, strikes: 0, pitch_call_code: 'ball' }, { balls: 1, strikes: 0, pitch_call_code: 'called_strike' }, { balls: 1, strikes: 1, pitch_call_code: 'foul' }] },
    ], meta: {} }) };
    if (u.includes('/mlb/v1/players')) return { ok: true, json: async () => ({ data: [{ id: 33, full_name: 'Bat Ter' }, { id: 22, full_name: 'Pitch Er' }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const r = await mlbEnrich({ id: 99, status_state: 'in_progress' }, { id: 1, slug: 'tb-nyy' }, null, { live: true });
    assert.equal(r.play, null, 'the old /plays read is gone');
    assert.deepEqual(r.live, { period: 7, half: 'Top', outs: 2, balls: 1, strikes: 2,
      bases: { first: true, second: true, third: false }, batter: 'Bat Ter', pitcher: 'Pitch Er' });
    assert.equal(seen.filter((u) => u.includes('/plate_appearances?game_id=99&per_page=100')).length, 1, 'one page per game');
    assert.equal(seen.some((u) => u.includes('statsapi') || u.includes('/mlb/v1/plays')), false, 'no second provider, no /plays');
    assert.equal(r.calls, 2, 'one PA page + one name lookup');
    // NAMES ARE CACHED: the same two players cost nothing the next poll.
    seen.length = 0;
    const again = await mlbEnrich({ id: 99, status_state: 'in_progress' }, { id: 1, slug: 'tb-nyy' }, null, { live: true });
    assert.equal(seen.filter((u) => u.includes('/players')).length, 0); assert.equal(again.calls, 1);
  } finally { globalThis.fetch = real; }
});

test('mlbEnrich: the pre-kick pass holds off the CARD when it was just read - only the starters are asked', async () => {
  const { mlbEnrich, _resetMlbProbablesCache } = await import('./poll.mjs');
  _resetMlbProbablesCache();
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => ({ data: [], meta: {} }) }; };
  try {
    const m = {
      id: 1, slug: 'tb-nyy', kickoff_at: '2026-09-22T22:35:00Z', away_abbr: 'TB', home_abbr: 'NYY',
      before_lineups: { fetchedAt: '2026-09-22T20:58:00Z', away: [{ id: '1' }], home: null },
    };
    const r = await mlbEnrich({ id: 99, status_state: 'pre' }, m, null,
      { live: false, now: new Date('2026-09-22T21:00:00Z') });
    assert.equal(r.lineups, null, 'a card read two minutes ago is not read again');
    assert.equal(calls, 1, 'one call, for the starters (their own ten-minute cadence)');
    assert.equal(r.calls, 1);
  } finally { globalThis.fetch = real; }
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



test('mlbEnrich PRE-KICK: the starters and the posted batting orders, both from BDL /lineups, no second provider', async () => {
  const { mlbEnrich, _resetMlbProbablesCache } = await import('./poll.mjs');
  _resetMlbProbablesCache();
  const real = globalThis.fetch; const seen = [];
  const rows = [
    { game_id: 99, is_probable_pitcher: true, team: { abbreviation: 'TB' }, player: { id: 208, full_name: 'Shane McClanahan' } },
    { game_id: 99, is_probable_pitcher: true, team: { abbreviation: 'NYY' }, player: { id: 19, full_name: 'Gerrit Cole' } },
    { game_id: 99, is_probable_pitcher: false, batting_order: 2, position: 'C', team: { abbreviation: 'TB' }, player: { id: 5, full_name: 'Second Up' } },
    { game_id: 99, is_probable_pitcher: false, batting_order: 1, position: 'DH', team: { abbreviation: 'TB' }, player: { id: 4, full_name: 'Lead Off' } },
  ];
  globalThis.fetch = async (url) => { seen.push(String(url)); return { ok: true, json: async () => ({ data: rows, meta: {} }) }; };
  try {
    const m = { id: 1, slug: 'tb-nyy', kickoff_at: '2026-09-22T22:35:00Z', away_abbr: 'TB', home_abbr: 'NYY' };
    const r = await mlbEnrich({ id: 99, status_state: 'pre' }, m, null, { live: false, now: new Date('2026-09-22T21:00:00Z') });
    assert.deepEqual(r.probables, { away: { id: '208', name: 'Shane McClanahan' }, home: { id: '19', name: 'Gerrit Cole' } });
    assert.deepEqual(r.lineups, { away: [
      { id: '4', name: 'Lead Off', position: 'DH', order: 1 }, { id: '5', name: 'Second Up', position: 'C', order: 2 },
    ], home: null }, 'batting_order is the order; the starters are not batters; an unposted side is null');
    assert.equal(r.live, null);
    assert.equal(seen.some((u) => u.includes('statsapi')), false);
    assert.ok(seen.every((u) => u.includes('/mlb/v1/lineups?game_ids[]=99')));
  } finally { globalThis.fetch = real; }
});
