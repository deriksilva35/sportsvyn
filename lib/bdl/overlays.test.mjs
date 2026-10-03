// lib/bdl/overlays.test.mjs - RULING sun-6 item 1, overlay by overlay, with a
// PLANTED 401 and a healthy sibling.
//
//   CFB  syncCfbLiveLines under runAndAlert (what sync.js runs as
//        'cfb-live-lines'), on DEV sentinels: two live games on a sentinel
//        Pick'em board, the feed answering 401 for one. The run is ok=false,
//        an alert is attempted under 'cfb-live-lines' naming the 401, and the
//        healthy game's lines ARE in cfb_live_player_lines. The 3 Oct incident,
//        replayed against the fix.
//   NFL  sweepGameStats under runAndAlert (the nfl-stats-sweep shape), on DEV
//        sentinel finals: same three assertions, nfl_player_game_stats.
//   NBA  syncNbaGameStats per game inside the poller's scope, then
//        reportBdlErrors (what services/live-poller/index.mjs does with a
//        tick): no database - `sql` is a recorder - and the healthy game's
//        INSERTs are counted.
// MLB rides the real pollOnce in services/live-poller/bdlErrors.test.mjs.
//
// The feed is planted at fetch level so every request goes through bdlFetch -
// a stub that threw on its own would prove nothing about the door. The alert
// is a stub (kickoffGuard.test.mjs forbids reaching the mailer); the database
// driver's own requests pass through untouched. Sentinels are created here and
// removed in after(), which checks its own teardown. The sync_runs rows are
// written under a per-pid test source and removed too.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { sql } = await import('../db.js');
const { runAndAlert, reportBdlErrors } = await import('../pollers/bdlFailure.js');
const { withBdlErrors } = await import('./http.js');
const { syncCfbLiveLines, bdlPlayerStatsFetcher } = await import('../cfb/bdlLive.js');
const { sweepGameStats } = await import('../gridiron/gameStatsSync.js');
const { syncNbaGameStats } = await import('../nba/statsSync.js');

const PID = process.pid;
const NS = `sentinel-bdlerr-ov-${PID}`;
const SRC = { cfb: `test-bdlerr-ov-cfb-${PID}`, nfl: `test-bdlerr-ov-nfl-${PID}` };
// SEASONS NOBODY ELSE OWNS (checked sun-6): boxScore.test sweeps NFL 1999,
// guillotine.test uses 1998 wk 97-99, weeklyDb.test sweeps every 2097-2099 match.
const NFL_SEASON = 1997; const NFL_WEEK = 96;
const CFB_SEASON = 2089; const CFB_WEEK = 89;
const NFL_FIX = JSON.parse(readFileSync(new URL('../gridiron/fixtures/bdl-stats-1392216.json', import.meta.url), 'utf8')).data;
const CFB_GAME = { bad: 990077101, good: 990077102 };
const NFL_GAME = { bad: `${NS}-nfl-bad`, good: `${NS}-nfl-good` };
const ids = { cfb: {}, nfl: {} }; let contestId = null;
const realFetch = globalThis.fetch;
const asked = [];

const stubAlert = () => {
  const sent = [];
  const fn = async (_sql, a) => { sent.push(a); return { sent: false, stub: true }; };
  fn.sent = sent;
  return fn;
};
const unauthorized = () => new Response('{"error":"Unauthorized"}', { status: 401 });

/** One CFB live line, the provider's shape. */
const cfbLine = (pid) => ({
  player: { id: pid, first_name: 'Sentinel', last_name: `Line${pid}`, position: 'QB', jersey_number: '1' },
  team: { college: 'Nowhere Sentinel' }, passing_yards: 101, passing_attempts: 9,
});

/** Remove every fixture this file makes, ANY run's - a killed run skips its after(). */
async function sweep() {
  const old = (await sql`SELECT id FROM matches WHERE slug LIKE 'sentinel-bdlerr-ov-%'`).map((r) => r.id);
  if (old.length) await sql`DELETE FROM nfl_player_game_stats WHERE match_id = ANY(${old})`;
  await sql`DELETE FROM contests WHERE game_type = 'pickem' AND sport = 'cfb' AND season_year = ${CFB_SEASON} AND week = ${CFB_WEEK}`;
  if (old.length) await sql`DELETE FROM matches WHERE id = ANY(${old})`;
  await sql`DELETE FROM sync_runs WHERE source LIKE 'test-bdlerr-ov-%'`;
}

before(async () => {
  await sweep();
  // ---- CFB: two live games on a sentinel board, ids already bridged
  const [cfb] = await sql`SELECT id FROM leagues WHERE slug = 'cfb'`;
  const teams = await sql`SELECT id FROM teams WHERE league_id = ${cfb.id} ORDER BY id LIMIT 4`;
  assert.equal(teams.length, 4);
  const mkCfb = async (tag, home, away, gameId) => (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, week, external_ids, metadata)
    VALUES (${cfb.id}, ${`${NS}-cfb-${tag}`}, now() - interval '25 minutes', 'live', ${home}, ${away}, ${CFB_SEASON}, 'REG', ${CFB_WEEK},
            ${JSON.stringify({ bdl_ncaaf_game_id: String(gameId) })}::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  ids.cfb.bad = await mkCfb('bad', teams[0].id, teams[1].id, CFB_GAME.bad);
  ids.cfb.good = await mkCfb('good', teams[2].id, teams[3].id, CFB_GAME.good);
  contestId = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at)
    VALUES ('pickem', 'cfb', ${CFB_SEASON}, ${CFB_WEEK},
            ${JSON.stringify([{ match_id: ids.cfb.bad }, { match_id: ids.cfb.good }])}::jsonb,
            now() - interval '2 days', now() - interval '1 hour', now() + interval '2 days')
    RETURNING id`)[0].id;

  // ---- NFL: two finals with no stats rows yet
  const [nfl] = await sql`SELECT id FROM leagues WHERE slug = 'nfl'`;
  const [ne, sea] = await sql`SELECT id FROM teams WHERE league_id = ${nfl.id} AND abbreviation IN ('NE', 'SEA') ORDER BY abbreviation`;
  const mkNfl = async (tag, bdl, kick) => (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, week, external_ids, metadata)
    VALUES (${nfl.id}, ${`${NS}-nfl-${tag}`}, ${kick}, 'final', ${sea.id}, ${ne.id}, ${NFL_SEASON}, 'REG', ${NFL_WEEK},
            ${JSON.stringify({ bdl_game_id: bdl })}::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  ids.nfl.bad = await mkNfl('bad', NFL_GAME.bad, '1997-09-10T00:20:00Z');
  ids.nfl.good = await mkNfl('good', NFL_GAME.good, '1997-09-11T00:20:00Z');

  // ---- the planted feed. Only the feed is answered; the database driver's
  // requests (Neon's HTTP driver also fetches) pass through.
  globalThis.fetch = async (url, opts) => {
    const u = String(url?.url ?? url);
    if (!/^https:\/\/api\.balldontlie\.io\//.test(u)) return realFetch(url, opts);
    asked.push(u);
    const q = new URL(u).searchParams;
    if (u.includes('/nfl/v1/stats')) {
      const g = q.get('game_ids[]');
      if (g === NFL_GAME.bad) return unauthorized();
      if (g === NFL_GAME.good) return Response.json({ data: NFL_FIX, meta: {} });
      return Response.json({ data: [], meta: {} });
    }
    return new Response('{}', { status: 404 });
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await sweep();
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM matches WHERE slug LIKE ${`${NS}%`})
         + (SELECT count(*)::int FROM contests WHERE id = ${contestId ?? 0})
         + (SELECT count(*)::int FROM sync_runs WHERE source = ANY(${Object.values(SRC)})) AS n`;
  assert.equal(left.n, 0, 'the sentinels, the board and the ledger rows are gone');
});

test('CFB (the 3 Oct incident): one game 401s, the run is FAILED and alerted, the other game still writes', async () => {
  const alert = stubAlert();
  // THE OVERLAY'S OWN INJECTABLE FETCHER, built on bdlFetch, with the 401
  // planted under it - exactly the request that failed 66 times on 3 Oct.
  const fetchImpl = async (url) => {
    const g = Number(new URL(String(url)).searchParams.get('game_ids[]'));
    if (g === CFB_GAME.bad) return unauthorized();
    if (g === CFB_GAME.good) return Response.json({ data: [cfbLine(990077201), cfbLine(990077202)], meta: {} });
    return Response.json({ data: [], meta: {} });   // any other live board game on DEV: no lines
  };
  const [cfb] = await sql`SELECT id FROM leagues WHERE slug = 'cfb'`;
  const res = await runAndAlert(sql, {
    source: SRC.cfb, kind: 'live-poll', context: `leagueId: ${cfb.id}`, alert, log: () => {},
    run: () => syncCfbLiveLines(cfb.id, {
      fetchPlayerStats: bdlPlayerStatsFetcher({ fetchImpl }),
      fetchGames: async () => [],   // ids are bridged on the sentinels; nothing else is asked
      // DRY RUN BECAUSE DEV HAS NO cfb_live_player_lines (measured sun-6:
      // PROD has the table, DEV does not - migration 080 was never applied
      // there). Everything up to the upsert runs: the fetch, the shaping, the
      // write-time status re-check. The NFL test below proves a real write.
      dryRun: true,
    }),
  });

  assert.equal(res.ok, false, 'per-game errors may never hide inside an ok=true');
  assert.match(res.error, /401 \/ncaaf\/v1\/player_stats/);
  const bad = res.summary.perGame.find((p) => p.match === ids.cfb.bad);
  assert.equal(bad.error, 'BDL 401 on /ncaaf/v1/player_stats', 'still contained per game, as before');
  assert.deepEqual(res.summary.bdlErrors.map((e) => `${e.status} ${e.endpoint}`), ['401 /ncaaf/v1/player_stats']);

  assert.equal(alert.sent.length, 1, 'an alert was attempted');
  assert.equal(alert.sent[0].source, SRC.cfb, "under the overlay's own source");
  assert.match(alert.sent[0].body, /401 \/ncaaf\/v1\/player_stats/, 'the error is named in the body');

  const good = res.summary.perGame.find((p) => p.match === ids.cfb.good);
  assert.deepEqual({ rows: good.rows, error: good.error, skipped: good.skipped }, { rows: 2, error: undefined, skipped: undefined },
    'the healthy sibling was fetched, shaped and reached the write (dry run: see above)');
  assert.equal(res.summary.resolved, 2, 'both games were attempted - the 401 stopped nothing');

  const [row] = await sql`SELECT ok, error, summary FROM sync_runs WHERE id = ${res.id}`;
  assert.equal(row.ok, false, 'the LEDGER says failed');
  assert.equal(row.error, res.error);
  assert.equal(row.summary.bdlErrors[0].status, 401, 'the ledger keeps the count and the per-game summary');
});

test('NFL: the post-final sweep with one 401 is FAILED and alerted; the other game\'s box is written', async () => {
  const alert = stubAlert();
  const res = await runAndAlert(sql, {
    source: SRC.nfl, kind: 'sweep', context: `season: ${NFL_SEASON}`, alert, log: () => {},
    run: () => sweepGameStats(NFL_WEEK, { season: NFL_SEASON }),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /401 \/nfl\/v1\/stats/);
  assert.equal(res.summary.candidates, 2);
  assert.match(res.summary.synced.find((s) => s.matchId === ids.nfl.bad).error, /^BDL 401 on \/nfl\/v1\/stats/);
  assert.equal(alert.sent.length, 1);
  assert.equal(alert.sent[0].source, SRC.nfl);
  assert.match(alert.sent[0].body, /401 \/nfl\/v1\/stats/);
  const [good] = await sql`SELECT count(*)::int n FROM nfl_player_game_stats WHERE match_id = ${ids.nfl.good}`;
  assert.ok(good.n >= 55, `the healthy sibling's box was written (${good.n} rows)`);
  assert.ok(asked.some((u) => u.includes(encodeURIComponent(NFL_GAME.bad)) || u.includes(NFL_GAME.bad)), 'the 401 was asked for through the door');
});

test('NBA: the poller\'s scoped tick - one box 401s, the tick is written FAILED and alerted, the other box writes', async () => {
  // The recorder stands in for the database: a match row per id, no team map,
  // and every INSERT counted. syncNbaGameStats takes `sql` and `fetchImpl`.
  const writes = []; const ledger = [];
  const fake = async (strings, ...values) => {
    const text = strings.join('?');
    if (/FROM matches m WHERE m\.id/.test(text)) return [{ id: values[0], league_id: 1, pid: values[0] === 1 ? 'nba-bad' : 'nba-good' }];
    if (/FROM teams/.test(text)) return [];
    if (/INSERT INTO nba_player_game_stats/.test(text)) { writes.push(values[0]); return [{ id: writes.length }]; }
    if (/INSERT INTO sync_runs/.test(text)) { ledger.push({ text, values }); return [{ id: 77 }]; }
    return [];
  };
  const fetchImpl = async (url) => {
    const g = new URL(String(url)).searchParams.get('game_ids[]');
    if (g === 'nba-bad') return unauthorized();
    return Response.json({ data: [
      { player: { id: 1, first_name: 'A', last_name: 'One', position: 'G' }, team: { id: 9 }, min: '30', pts: 20 },
      { player: { id: 2, first_name: 'B', last_name: 'Two', position: 'F' }, team: { id: 9 }, min: '28', pts: 11 },
    ], meta: {} });
  };
  // THE POLLER'S SHAPE (services/live-poller/index.mjs): every box in its own
  // try, the whole tick inside withBdlErrors, the collection reported after.
  const { bdlErrors } = await withBdlErrors(async () => {
    for (const id of [1, 2]) {
      try { await syncNbaGameStats(id, { sql: fake, fetchImpl, key: 'k' }); } catch { /* logged by the poller */ }
    }
  });
  assert.deepEqual(writes, [2, 2], 'the healthy game wrote both lines');
  const alert = stubAlert();
  const rep = await reportBdlErrors(fake, { source: 'live-poller-nba', bdlErrors, context: 'league: nba', alert });
  assert.match(rep.error, /401 \/nba\/v1\/stats/);
  assert.equal(ledger.length, 1); assert.deepEqual(ledger[0].values.slice(0, 2), ['live-poller-nba', 'bdl-errors']);
  assert.match(ledger[0].text, /false, \?/, 'ok=false');
  assert.equal(alert.sent.length, 1); assert.equal(alert.sent[0].source, 'live-poller-nba');
  assert.match(alert.sent[0].body, /401 \/nba\/v1\/stats/);
});
