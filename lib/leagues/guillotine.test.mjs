// lib/leagues/guillotine.test.mjs - the chop on DEV: decided only when a
// bucket is finished, persisted once, never re-decided, ruling (c) on a double
// tie (pure, in standings.test.mjs), a late joiner spared the bucket they joined in, and the cron's wiring.
//
// Fixture (torn down + asserted in after()): SENTINEL users (@example.invalid),
// one guillotine league "Test guillotine ...", Weekly NFL contests in season
// 1998, weeks 97-99 (no real schedule has them).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const core = await import('./core.js');
const g = await import('./guillotine.js');
const { leagueTable } = await import('./table.js');
const { sql } = await import('../db.js');

const NS = `lgguill-test-${process.pid}-${Date.now()}`;
const U = {};
let league; const contestIds = [];
const ANCHORS = { nfl: { season: 1998, week: 97, at: '1998-01-01T00:00:00Z' }, day: null };

before(async () => {
  for (const k of ['a', 'b', 'c', 'd', 'late']) {
    const [u] = await sql`INSERT INTO users (email, handle) VALUES (${`${NS}-${k}@example.invalid`}, ${`g${k}${process.pid}`.slice(0, 20)}) RETURNING id`;
    U[k] = u.id;
  }
  league = await core.createLeague(U.a, 'Test guillotine', {
    games: ['weekly'], span: 'season', scoring: 'total', format: 'guillotine', maxMembers: 12, lateJoins: true,
  }, { anchors: ANCHORS, survivor: false });
  assert.equal(league.ok, true, league.reason);
  for (const k of ['b', 'c', 'd']) assert.equal((await core.joinLeague(U[k], league.joinCode)).ok, true);
  await sql`UPDATE league_members SET joined_at = '1997-12-31T00:00:00Z' WHERE league_id = ${league.leagueId}`;
  // 'late' joins during week 98 (Tuesday 1998-03-10 week) - spared until week 99.
  assert.equal((await core.joinLeague(U.late, league.joinCode)).ok, true);
  await sql`UPDATE league_members SET joined_at = '1998-03-12T00:00:00Z' WHERE league_id = ${league.leagueId} AND user_id = ${U.late}`;

  const mk = async (week, locks, settled, scores) => {
    const [c] = await sql`INSERT INTO contests (game_type, sport, season_year, week, opens_at, locks_at, settled)
                          VALUES ('weekly', 'nfl', 1998, ${week}, ${locks}, ${locks}, ${settled}) RETURNING id`;
    contestIds.push(c.id);
    for (const [k, s] of Object.entries(scores)) await sql`INSERT INTO contest_entries (contest_id, user_id, score) VALUES (${c.id}, ${U[k]}, ${s})`;
  };
  // wk97 (Tue 1998-03-03): d lowest -> chopped.
  await mk(97, '1998-03-06T01:00:00Z', true, { a: 50, b: 40, c: 45, d: 10 });
  // wk98 (Tue 1998-03-10): b 20 is the lowest of the standing; 'late' scored 0 but joined that week.
  await mk(98, '1998-03-13T01:00:00Z', true, { a: 30, b: 20, c: 25 });
  // wk99 (Tue 1998-03-17): a 10 is lowest (the double-tie ruling is pinned in standings.test.mjs).
  await mk(99, '1998-03-20T01:00:00Z', true, { a: 10, c: 20, late: 50 });
});

after(async () => {
  if (contestIds.length) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${contestIds})`;
    await sql`DELETE FROM contests WHERE id = ANY(${contestIds})`;
  }
  if (league?.leagueId) await sql`DELETE FROM player_leagues WHERE id = ${league.leagueId}`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM contests WHERE id = ANY(${contestIds}))
         + (SELECT count(*) FROM player_league_eliminations WHERE league_id = ${league?.leagueId ?? -1})
         + (SELECT count(*) FROM player_leagues WHERE id = ${league?.leagueId ?? -1}) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

const lg = async () => (await sql`SELECT id, span, scoring, format, starts_at FROM player_leagues WHERE id = ${league.leagueId}`)[0];
const chopped = async () => (await sql`SELECT user_id, period_key FROM player_league_eliminations WHERE league_id = ${league.leagueId} ORDER BY period_key`)
  .map((r) => [Number(r.user_id), r.period_key]);

test('a bucket is decided only when its week is over AND every result is final', async () => {
  // Monday 1998-03-09 ET: week 97 is not over yet.
  assert.deepEqual(await g.settleGuillotine(await lg(), { now: new Date('1998-03-09T20:00:00Z') }), []);
  // Wednesday: week 97 is decided; week 98 has not ended.
  const first = await g.settleGuillotine(await lg(), { now: new Date('1998-03-11T20:00:00Z') });
  assert.deepEqual(first.map((c) => c.userId), [U.d]);
  assert.deepEqual(await chopped(), [[U.d, '1998-03-03']]);
});

test('later buckets: the lowest standing member goes; the late joiner is spared the week they joined in', async () => {
  const fresh = await g.settleGuillotine(await lg(), { now: new Date('1998-03-25T20:00:00Z') });
  // wk98: standing a 30, b 20, c 25, late 0 but spared (joined that week) -> b.
  // wk99: a 10, c 20, late 50 -> a is lowest on the week -> a goes.
  assert.deepEqual(fresh.map((c) => [c.userId, c.bucket]), [[U.b, '1998-03-10'], [U.a, '1998-03-17']]);
  const again = await g.settleGuillotine(await lg(), { now: new Date('1998-03-25T20:00:00Z') });
  assert.deepEqual(again, [], 'idempotent: decided buckets are never re-decided');
  assert.equal((await chopped()).length, 3);
});

test('a stat correction after the chop changes nothing that was decided', async () => {
  await sql`UPDATE contest_entries SET score = 999 WHERE contest_id = ${contestIds[0]} AND user_id = ${U.d}`;
  assert.deepEqual(await g.settleGuillotine(await lg(), { now: new Date('1998-03-25T20:00:00Z') }), []);
  assert.ok((await chopped()).some(([u]) => u === U.d), 'd stays chopped');
});

test('the page reads the persisted chops: standing vs chopped', async () => {
  const detail = await core.leagueDetail(league.leagueId, U.c);
  const t = await leagueTable(detail, { now: new Date('1998-03-25T20:00:00Z') });
  assert.deepEqual(t.guillotine.standing.map((r) => r.userId).sort(), [U.c, U.late].sort());
  assert.deepEqual(t.guillotine.chopped.map((c) => c.userId), [U.a, U.b, U.d], 'newest chop first');
  assert.equal(t.guillotine.chopped[0].label, 'Week 99');
});

test('the cron is wired: Bearer-gated, scheduled, and calls the one settle', () => {
  const route = readFileSync(path.join(REPO, 'app/api/cron/leagues-tick/route.js'), 'utf8');
  assert.match(route, /cronAuthorized\(request\)/);
  assert.match(route, /settleAllGuillotines\(/);
  const vercel = JSON.parse(readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));
  assert.ok(vercel.crons.some((c) => c.path === '/api/cron/leagues-tick'));
});
