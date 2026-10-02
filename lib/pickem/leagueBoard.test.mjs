// lib/pickem/leagueBoard.test.mjs - the Pick'em board's ?league=<id> filter.
//
// Pure: which league ?league= may pick, the chip row, and the re-rank inside a
// league (ties share the higher place). DEV: a member sees the league's board,
// a non-member and a signed-out reader asking for the same id get the national
// board - never the league's members.
//
// Fixture (torn down and asserted gone in after()): SENTINEL users
// (@example.invalid, "test" in the address), one league "Test pickem league",
// one SETTLED pickem contest in season 1999 week 97 - no real schedule has it,
// and a settled board never leads currentPickemBoard while an unsettled one exists.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const { pickLeague, leagueChips } = await import('../boards/view.js');
const { leagueRanked, pickemBoardLeaderboard } = await import('../games/leaderboard.js');
const { boardScope } = await import('../leagues/boardScope.js');
const core = await import('../leagues/core.js');
const { sql } = await import('../db.js');

// ---------------------------------------------------------------------------
// pure
// ---------------------------------------------------------------------------

test('?league= picks only one of the reader\'s own leagues; anything else is national', () => {
  const mine = [{ id: 7, name: 'Seven' }, { id: 12, name: 'Twelve' }];
  assert.equal(pickLeague(mine, '12').name, 'Twelve');
  assert.equal(pickLeague(mine, 12).name, 'Twelve');
  assert.equal(pickLeague(mine, '99'), null, 'a league the reader is not in is the national board');
  assert.equal(pickLeague(mine, ''), null);
  assert.equal(pickLeague(mine, null), null);
  assert.equal(pickLeague([], '7'), null, 'signed out: no leagues, so no league');
});

test('the chip row: National first, then the reader\'s leagues on this board\'s path', () => {
  const mine = [{ id: 7, name: 'Seven' }, { id: 12, name: 'Twelve' }];
  assert.deepEqual(leagueChips('/pickem/nfl', mine, null), [
    { label: 'National', href: '/pickem/nfl', on: true },
    { label: 'Seven', href: '/pickem/nfl?league=7', on: false },
    { label: 'Twelve', href: '/pickem/nfl?league=12', on: false },
  ]);
  const on = leagueChips('/pickem/nfl', mine, mine[1]).filter((c) => c.on).map((c) => c.label);
  assert.deepEqual(on, ['Twelve']);
});

test('a league board re-ranks within the league: ties share the higher place (1-1-3)', () => {
  const r = leagueRanked([
    { userId: 5, score: 10, rank: 4 }, { userId: 2, score: 10, rank: 3 }, { userId: 9, score: 7, rank: 8 },
  ]);
  assert.deepEqual(r.map((x) => [x.userId, x.rank]), [[2, 1], [5, 1], [9, 3]]);
});

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

test('the page scopes the leaderboard by the reader\'s league and draws the shared chip row', () => {
  const p = stripComments(src('app/pickem/[sport]/page.js'));
  assert.match(p, /boardScope\(uid, league\)/);
  assert.match(p, /pickemBoardLeaderboard\(view\.contest\.id, uid, \{ limit: 5, memberIds: scope\.memberIds \}\)/);
  assert.match(p, /leagueChips\(dest, scope\.leagues, scope\.picked\)/);
  const g = stripComments(src('components/pickem/PickemGrade.js'));
  assert.match(g, /<BoardChips chips=\{chips\} embed \/>/, 'the Weekly/Draft chip row, not a second one');
  const lb = stripComments(src('components/boards/LiveBoard.js'));
  assert.match(lb, /<BoardChips chips=\{chips\} \/>/, 'LiveBoard draws the same component');
  assert.ok(!/className="lb-chips"/.test(lb), 'and no inline copy of it');
});

// ---------------------------------------------------------------------------
// DEV
// ---------------------------------------------------------------------------

const NS = `pkleague-test-${process.pid}-${Date.now()}`;
const U = {};
let league = null; let contestId = null;

before(async () => {
  for (const k of ['a', 'b', 'c', 'outsider']) {
    const [u] = await sql`INSERT INTO users (email, handle) VALUES (${`${NS}-${k}@example.invalid`}, ${`tpk${k}${process.pid}`.slice(0, 20)}) RETURNING id`;
    U[k] = u.id;
  }
  league = await core.createLeague(U.a, 'Test pickem league', {
    games: ['pickem'], span: 'season', scoring: 'rank', format: 'table', maxMembers: 12, lateJoins: true,
  }, { anchors: { nfl: { season: 1999, week: 97, at: '1999-01-01T00:00:00Z' } }, survivor: false });
  assert.equal(league.ok, true, league.reason);
  for (const k of ['b', 'c']) assert.equal((await core.joinLeague(U[k], league.joinCode)).ok, true);
  const [c] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, opens_at, locks_at, settled)
    VALUES ('pickem', 'nfl', 1999, 97, '1999-02-23T14:00:00Z', '1999-02-26T01:00:00Z', true) RETURNING id`;
  contestId = c.id;
  // The outsider TOPS the national board - a league view that leaked would show it first.
  await sql`INSERT INTO contest_entries (contest_id, user_id, score)
            VALUES (${contestId}, ${U.a}, 10), (${contestId}, ${U.b}, 10), (${contestId}, ${U.c}, 7), (${contestId}, ${U.outsider}, 12)`;
});

after(async () => {
  if (contestId) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ${contestId}`;
    await sql`DELETE FROM contests WHERE id = ${contestId}`;
  }
  if (league?.leagueId) await sql`DELETE FROM player_leagues WHERE id = ${league.leagueId}`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM contests WHERE id = ${contestId ?? -1})
         + (SELECT count(*) FROM contest_entries WHERE contest_id = ${contestId ?? -1})
         + (SELECT count(*) FROM player_leagues WHERE id = ${league?.leagueId ?? -1}) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

test('a MEMBER asking for the league sees its members only, re-ranked among themselves', async () => {
  const scope = await boardScope(U.a, String(league.leagueId));
  assert.equal(scope.picked?.id, league.leagueId);
  assert.deepEqual(scope.memberIds, [U.a, U.b, U.c].sort((x, y) => x - y));
  const chips = leagueChips('/pickem/nfl', scope.leagues, scope.picked);
  assert.deepEqual(chips.find((c) => c.on), { label: 'Test pickem league', href: `/pickem/nfl?league=${league.leagueId}`, on: true });

  const lb = await pickemBoardLeaderboard(contestId, U.c, { limit: 5, memberIds: scope.memberIds });
  assert.equal(lb.league, true);
  assert.equal(lb.played, 3, 'the outsider is not on the league board');
  assert.ok(!lb.top.some((r) => r.userId === U.outsider));
  assert.deepEqual(lb.top.map((r) => [r.userId, r.rank]),
    [[Math.min(U.a, U.b), 1], [Math.max(U.a, U.b), 1], [U.c, 3]], 'a tie shares 1st; the next is 3rd');
});

test('a NON-MEMBER asking for the same id gets the national board - never the league', async () => {
  const scope = await boardScope(U.outsider, String(league.leagueId));
  assert.equal(scope.picked, null);
  assert.equal(scope.memberIds, null);
  assert.ok(!scope.leagues.some((l) => l.id === league.leagueId), 'and no chip for it');
  const lb = await pickemBoardLeaderboard(contestId, U.outsider, { limit: 5, memberIds: scope.memberIds });
  assert.equal(lb.league, false);
  assert.equal(lb.played, 4);
  assert.equal(lb.top[0].userId, U.outsider);
  assert.deepEqual(lb.top.map((r) => r.rank), [1, 2, 3, 4], 'the national board is unchanged');
});

test('SIGNED OUT with ?league= is the national board too', async () => {
  const scope = await boardScope(null, String(league.leagueId));
  assert.deepEqual(scope, { leagues: [], picked: null, memberIds: null });
});

test('an EMPTY member list is an empty board, never the nation', async () => {
  const lb = await pickemBoardLeaderboard(contestId, U.a, { limit: 5, memberIds: [] });
  assert.equal(lb.played, 0);
  assert.deepEqual(lb.top, []);
  assert.equal(lb.self, null);
});
