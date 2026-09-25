// lib/pollers/cfbPlaysAll.test.mjs - CFB_PLAYS_ALL, composed.
//
// THE ROUTE ITSELF RUNS, on DEV, against three live CFB games that sit on NO
// Pick'em board: FBS v FBS, FBS v FCS and FCS v FCS. With the flag off the
// route sees none of them - main's behaviour, the board is the bound. With it
// on, the two with an FBS side are polled and their plays are WRITTEN; the
// FCS v FCS game is never asked about.
//
// CFBD is a stubbed fetch that answers only for the sentinels' game ids, and
// the alert sender is lib/testing/alertsStub.mjs, so this can neither spend the
// real budget nor send mail. (It lives in lib/, not beside the route: a test in
// app/ that names the stats vendor's host trips lib/legal.test.mjs.) DEV holds no live game of its own (checked 25 Sep 2026); the
// sentinels are the whole slate, and after() removes them and every row the
// route wrote for them.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../testing/nextResolve.mjs';

install();
const ALERTS = new URL('../testing/alertsStub.mjs', import.meta.url).pathname;
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/lib/pollers/alerts') return { url: pathToFileURL(ALERTS).href, shortCircuit: true };
  return next(spec, ctx);
} });

const { sql } = await import('../db.js');
const SLUG = `test-cfb-plays-all-${process.pid}`;
const GAME = { fbs: '990000001', mixed: '990000002', fcs: '990000003' };
const ids = {};
let GET; let cfbdAsked = []; const realFetch = globalThis.fetch;
const startedAt = new Date();

// Two plays in one drive, the shape /live/plays returns.
const livePayload = (offense) => ({ status: 'In Progress', drives: [{ id: 'd1', offenseId: offense, plays: [
  { id: 'p1', period: 1, clock: '14:55', down: 1, distance: 10, yardsToGoal: 75, yardsGained: 4, teamId: offense, playType: 'Rush', playText: 'A run for 4', homeScore: 0, awayScore: 0 },
  { id: 'p2', period: 1, clock: '14:20', down: 2, distance: 6, yardsToGoal: 71, yardsGained: 6, teamId: offense, playType: 'Pass Reception', playText: 'A catch for 6', homeScore: 0, awayScore: 0 },
] }] });

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'cfb'`;
  const fbs = await sql`SELECT id, external_ids->>'cfbd_team_id' AS pid FROM teams WHERE league_id = ${lg.id} AND metadata->>'classification' = 'fbs' AND external_ids ? 'cfbd_team_id' ORDER BY id LIMIT 3`;
  const fcs = await sql`SELECT id FROM teams WHERE league_id = ${lg.id} AND metadata->>'classification' = 'fcs' ORDER BY id LIMIT 3`;
  assert.equal(fbs.length, 3); assert.equal(fcs.length, 3);
  const mk = async (tag, home, away, gameId) => (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, week, external_ids, metadata)
    VALUES (${lg.id}, ${`${SLUG}-${tag}`}, now() - interval '20 minutes', 'live', ${home}, ${away}, 2097, 'REG', 1,
            ${JSON.stringify({ cfbd_game_id: gameId })}::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  ids.fbs = await mk('fbs', fbs[0].id, fbs[1].id, GAME.fbs);
  ids.mixed = await mk('mixed', fbs[2].id, fcs[0].id, GAME.mixed);
  ids.fcs = await mk('fcs', fcs[1].id, fcs[2].id, GAME.fcs);
  const offense = fbs[0].pid;

  // THE DATABASE DRIVER FETCHES TOO (Neon's HTTP driver), so only the two
  // providers are answered here; every other request is the real one.
  globalThis.fetch = async (url, opts) => {
    const u = String(url?.url ?? url);
    if (u.includes('collegefootballdata.com/live/plays')) {
      const g = new URL(u).searchParams.get('gameId'); cfbdAsked.push(g);
      if (!Object.values(GAME).includes(g)) return new Response('{"message":"not a sentinel"}', { status: 404 });
      return Response.json(livePayload(offense), { headers: { 'x-calllimit-remaining': '74000' } });
    }
    if (u.includes('collegefootballdata.com')) return Response.json([], { headers: { 'x-calllimit-remaining': '74000' } });
    if (u.includes('balldontlie.io')) return new Response('{}', { status: 404 });
    return realFetch(url, opts);
  };
  process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-secret';
  ({ GET } = await import('../../app/api/cron/plays-live/route.js'));
});

after(async () => {
  globalThis.fetch = realFetch;
  const all = Object.values(ids).filter(Boolean);
  if (all.length) {
    await sql`DELETE FROM plays WHERE match_id = ANY(${all})`;
    await sql`DELETE FROM matches WHERE id = ANY(${all})`;
  }
  await sql`DELETE FROM sync_runs WHERE source = 'plays-live' AND started_at >= ${startedAt.toISOString()}`;
  const left = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${SLUG}-%`}`;
  assert.equal(left[0].n, 0, 'the sentinels are gone');
});

const call = () => GET(new Request('https://sportsvyn.test/api/cron/plays-live', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
const playsFor = async (id) => (await sql`SELECT count(*)::int n FROM plays WHERE match_id = ${id}`)[0].n;

test('FLAG OFF: main\'s scope - no board, no poll, no CFBD call, no plays', async () => {
  delete process.env.CFB_PLAYS_ALL; cfbdAsked = [];
  const { liveBoardGames } = await import('./playsScope.js');
  const scope = (await liveBoardGames()).map((g) => g.id);
  assert.equal(scope.some((id) => Object.values(ids).includes(id)), false);
  const res = await (await call()).json();
  assert.equal(res.inScope, 0); assert.equal(res.decision, 'noop');
  assert.deepEqual(cfbdAsked, []);
  for (const id of Object.values(ids)) assert.equal(await playsFor(id), 0);
});

test('FLAG ON: the non-board FBS games are polled and their plays WRITTEN; FCS v FCS is never asked', async () => {
  process.env.CFB_PLAYS_ALL = 'on'; cfbdAsked = [];
  try {
    const res = await (await call()).json();
    assert.equal(res.inScope, 2, 'FBS v FBS and FBS v FCS');
    assert.equal(res.polled, 2); assert.equal(res.failed, 0); assert.equal(res.ok, true);
    assert.deepEqual(cfbdAsked.sort(), [GAME.fbs, GAME.mixed].sort(), 'one CFBD call per FBS game, none for FCS v FCS');
    assert.equal(await playsFor(ids.fbs), 2, 'FBS v FBS: plays written');
    assert.equal(await playsFor(ids.mixed), 2, 'FBS v FCS: plays written');
    assert.equal(await playsFor(ids.fcs), 0, 'FCS v FCS: out');
    // THE CYCLE IS LEDGERED WITH ITS CALL COUNT, so tomorrow's burn can be summed.
    const [run] = await sql`SELECT summary FROM sync_runs WHERE id = ${res.id}`;
    assert.equal(run.summary.cfb_plays_all, true);
    assert.equal(run.summary.cfbd_calls, 2);
    assert.equal(run.summary.skipped_deadline, 0);
    // AND THE THROTTLE STILL HOLDS: the next tick inside 90 s polls nothing.
    cfbdAsked = [];
    const again = await (await call()).json();
    assert.equal(again.decision, 'throttled'); assert.deepEqual(cfbdAsked, []);
  } finally { delete process.env.CFB_PLAYS_ALL; }
});
