// lib/boards/mlb.test.mjs - October and The Run, live (Phase 2).
//
// THE PATH UNDER TEST: box-score rows land -> the poller's snapshotMlbBoards()
// (the exact call services/live-poller/index.mjs makes after an MLB box score)
// -> the pages' reads, octoberLive()/runLive() + withMlbMovement(). Real modules
// against DEV; only the clock is given.
//
// SENTINELS IN SEASON 1999. Every read here takes a season, so a 1999 October
// day and a 1999 Run round are invisible to the poller's own pass (the current
// season) and to every other suite. Everything is deleted by id at the end and
// the teardown verifies itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));

const { sql } = await import('../db.js');
const { withLive, roundView, octoberLive, runLive, withMlbMovement, snapshotMlbBoards } = await import('./mlb.js');
const { batPoints } = await import('../mlb/fantasyPoints.js');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// the pure core
// ---------------------------------------------------------------------------

test('LIVE IS ADDED TO SETTLED, and the standing re-ranks with ties shared', () => {
  const rows = withLive(
    [{ userId: 1, handle: 'a', total: 10 }, { userId: 2, handle: 'b', total: 4 }, { userId: 3, handle: 'c', total: 0 }],
    new Map([[2, { points: 6 }], [3, { points: 12.04 }]]),
  );
  assert.deepEqual(rows.map((r) => [r.userId, r.points, r.rank]), [[3, 12, 1], [1, 10, 2], [2, 10, 2]]);
  assert.equal(rows.find((r) => r.userId === 1).live, null, 'no card in play is not a zero in play');
});

test('ONE ROUND AS ITS OWN BOARD: scored and live cells rank, "set", DNF and dashes do not', () => {
  const rows = [
    { userId: 1, rounds: { wild_card: { kind: 'points', points: 30 } } },
    { userId: 2, rounds: { wild_card: { kind: 'live', points: 41.5 } } },
    { userId: 3, rounds: { wild_card: { kind: 'set' } } },
    { userId: 4, rounds: { wild_card: { kind: 'dnf' } } },
    { userId: 5, rounds: { wild_card: null } },
  ];
  assert.deepEqual(roundView(rows, 'wild_card').map((r) => [r.userId, r.points, r.rank]), [[2, 41.5, 1], [1, 30, 2]]);
});

// ---------------------------------------------------------------------------
// the composition on DEV
// ---------------------------------------------------------------------------

const NS = `sentinel-mlbb-${process.pid}-${Date.now()}`;
const ids = { users: [], match: null, contests: [] };
const P1 = 900000000 + (process.pid % 100000) * 10; const P2 = P1 + 1;
let T1 = null;

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'mlb'`;
  const t = await sql`SELECT id FROM teams WHERE league_id = ${lg.id} ORDER BY id LIMIT 2`;
  T1 = t[0].id;
  [{ id: ids.match }] = await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, season_year, season_phase, external_ids, metadata)
    VALUES (${lg.id}, ${NS}, 'live', ${t[0].id}, ${t[1].id}, ${new Date(Date.now() - 3600e3).toISOString()}, 1999, 'POST', '{}'::jsonb, '{}'::jsonb) RETURNING id`;
  const past = new Date(Date.now() - 86400e3).toISOString(); const later = new Date(Date.now() + 86400e3).toISOString();
  const mk = async (fields) => (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, puzzle_date, board, opens_at, locks_at, settled, meta)
    VALUES (${fields.type}, 'mlb', 1999, ${fields.week ?? null}, ${fields.date ?? null}, ${JSON.stringify(fields.board)}::jsonb,
            ${past}, ${later}, ${fields.settled ?? false}, ${JSON.stringify(fields.meta ?? {})}::jsonb) RETURNING id`)[0].id;
  const octDone = await mk({ type: 'october', date: '1999-10-04', board: [], settled: true });
  const octToday = await mk({ type: 'october', date: '1999-10-05', board: [{ match_id: ids.match, slug: NS }] });
  const run = await mk({ type: 'run', week: 1, board: { round: 'wild_card', clubs: [] }, meta: { matchIds: [ids.match] } });
  ids.contests.push(octDone, octToday, run);
  for (const k of ['a', 'b', 'c']) {
    ids.users.push((await sql`INSERT INTO users (email) VALUES (${`${NS}-${k}@example.invalid`}) RETURNING id`)[0].id);
  }
  const [A, B, C] = ids.users;
  // the settled day: A banked 10.0, B 0.0 - the settle's numbers, never recomputed
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup, score, meta) VALUES
    (${octDone}, ${A}, '{}'::jsonb, 10, '{"october":{"state":"complete"}}'::jsonb),
    (${octDone}, ${B}, '{}'::jsonb, 0, '{"october":{"state":"complete"}}'::jsonb)`;
  for (const [u, p] of [[A, P1], [B, P2]]) {
    await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES (${octToday}, ${u}, ${JSON.stringify({ bat1: { playerId: p, matchId: ids.match } })}::jsonb)`;
    await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES (${run}, ${u}, ${JSON.stringify({ bat1: { playerId: p, teamId: T1 } })}::jsonb)`;
  }
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES (${run}, ${C}, '{}'::jsonb)`;
});

after(async () => {
  await sql`DELETE FROM contests WHERE id = ANY(${ids.contests})`;
  await sql`DELETE FROM matches WHERE id = ${ids.match}`;
  await sql`DELETE FROM users WHERE id = ANY(${ids.users})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM contests WHERE id = ANY(${ids.contests}))
         + (SELECT count(*)::int FROM matches WHERE slug = ${NS})
         + (SELECT count(*)::int FROM users WHERE email LIKE ${`${NS}%`})
         + (SELECT count(*)::int FROM live_board_snapshots WHERE contest_id = ANY(${ids.contests})) AS n`;
  assert.equal(left.n, 0, 'the sentinels are gone');
});

const box = (pid, cols) => sql`
  INSERT INTO mlb_player_game_stats (match_id, bdl_player_id, player_name, team_id, at_bats, hits, home_runs, rbi, runs)
  VALUES (${ids.match}, ${pid}, ${`Sentinel ${pid}`}, ${T1}, ${cols.at_bats ?? 1}, ${cols.hits ?? 0}, ${cols.home_runs ?? 0}, ${cols.rbi ?? 0}, ${cols.runs ?? 0})
  ON CONFLICT (match_id, bdl_player_id) DO UPDATE
     SET at_bats = EXCLUDED.at_bats, hits = EXCLUDED.hits, home_runs = EXCLUDED.home_runs, rbi = EXCLUDED.rbi, runs = EXCLUDED.runs, updated_at = now()`;

test('THROUGH THE POLLER TO THE PAGE: a live box score moves October and The Run, and ten minutes later both say by how much', async () => {
  const [A, B, C] = ids.users;
  const t0 = new Date(Date.now() - 11 * 60_000);
  const t1 = new Date();
  const b0 = { hits: 1 };                                      // A: a single
  const b1 = { hits: 1, home_runs: 1, rbi: 1, runs: 1 };        // B: a solo homer
  await box(P1, b0); await box(P2, b1);
  const s0 = await snapshotMlbBoards({ season: 1999, now: t0 });
  assert.equal(s0.boards, 2, 'October and The Run each have a contest in play');
  assert.ok(s0.written >= 5, 'every entrant of both boards gets a first standing');

  // t1: A goes deep twice more
  const a1 = { at_bats: 3, hits: 3, home_runs: 2, rbi: 3, runs: 2 };
  await box(P1, a1);

  const oct = await octoberLive(1999, { now: t1 });
  const o = new Map((await withMlbMovement(oct, t1)).map((r) => [r.userId, r]));
  assert.equal(o.get(A).points, Math.round((10 + batPoints(a1)) * 10) / 10, 'A: the settled 10.0 plus today\'s live card');
  assert.equal(o.get(B).points, Math.round(batPoints(b1) * 10) / 10);
  assert.equal(o.get(A).rank, 1);
  assert.equal(o.get(A).dPoints, Math.round((batPoints(a1) - batPoints(b0)) * 10) / 10, 'A gained exactly the two homers since t0');
  assert.equal(o.get(A).today.points, Math.round(batPoints(a1) * 10) / 10, 'today\'s column is the live card');

  const run = await runLive(1999, { now: t1 });
  assert.equal(run.liveRound, 'wild_card');
  const r = new Map((await withMlbMovement(run, t1)).map((x) => [x.userId, x]));
  assert.deepEqual(r.get(A).rounds.wild_card, { kind: 'live', points: Math.round(batPoints(a1) * 10) / 10 });
  assert.equal(r.get(C).points, 0, 'an entry with nobody set is on the board at zero');
  assert.equal(r.get(A).rank, 1); assert.equal(r.get(B).rank, 2);
  assert.equal(r.get(B).dRank, 1 - 2, 'B was first at t0 and is second now');
  const wc = roundView([...r.values()], 'wild_card');
  assert.deepEqual(wc.map((x) => x.userId), [A, B], 'the round view ranks the two who have points');
});

// ---------------------------------------------------------------------------
// the wiring
// ---------------------------------------------------------------------------

test('the poller snapshots October and The Run after an MLB box score, contained like the NFL one', () => {
  const t = stripComments(src('services/live-poller/index.mjs'));
  assert.match(t, /import \{ snapshotMlbBoards \} from '\.\.\/\.\.\/lib\/boards\/mlb\.js'/);
  const guard = t.indexOf("if (boardsDue && lg.slug === 'mlb')");
  const call = t.indexOf('snapshotMlbBoards({', guard);
  assert.ok(guard > t.indexOf('const g = await syncBox(d.id)') && call > guard, 'after the box scores, gated on the flag and the league');
  assert.ok(t.slice(guard, call).includes('try {') && t.slice(call, call + 400).includes('catch (e)'));
});

test('OCTOBER SETTLES: the cron that was missing exists, is registered, and calls settleDueOctober', () => {
  const v = JSON.parse(src('vercel.json'));
  const c = v.crons.find((x) => x.path === '/api/cron/october-settle');
  assert.ok(c, 'registered in vercel.json');
  assert.equal(c.schedule, '30 6-20 * * *', 'hourly at half past, off run-settle\'s minute');
  const r = stripComments(src('app/api/cron/october-settle/route.js'));
  assert.match(r, /cronAuthorized\(request\)/);
  assert.match(r, /withAdvisoryLock\(SOURCE/);
  assert.match(r, /settleDueOctober\(\{ now: new Date\(\) \}\)/);
});

test('both boards find the reader in the WHOLE standing, never in a 50-row slice', () => {
  for (const p of ['app/october/board/page.js', 'app/run/board/page.js']) {
    const t = stripComments(src(p));
    assert.doesNotMatch(t, /octoberBoard\(season|runBoard\(season/, `${p} reads the live standing`);
    assert.match(t, /const me = (rows|board)\.find\(/, `${p} finds the reader in the full rows`);
  }
  const m = stripComments(src('lib/boards/mlb.js'));
  assert.match(m, /octoberBoard\(season, \{ now, limit: ALL/);
  assert.match(m, /runBoard\(season, \{ memberIds, preview, now, limit: ALL \}\)/);
});
