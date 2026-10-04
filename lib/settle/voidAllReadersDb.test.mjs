// lib/settle/voidAllReadersDb.test.mjs - ruling sun-11 item 1, against DEV.
//
// PLANTED void_all BOARDS, one per closer game - Weekly, Draft, Pick'em, a Run
// preview round and an October day - each exactly as closeVoidAll leaves one:
// settled, meta.void_all = true, perfect null, entries with no score. Every
// reader that queries is run over them and must SKIP them or say VOID: never
// a DNF, a 0, a rank, a "you did not play", a board counted as played.
//
// THE CONTROL is one real settled Weekly week with a scored entry, so the
// count test can see a board that DOES count next to the five that do not.
//
// SENTINELS: users through fixtureMark('voidallreaders') (per run; stale
// family rows swept in before), contests in seasons 1997/1998 with week
// 50-89 / puzzle_date in 1997 keyed off the pid - outside any real schedule.
// Every contest is deleted by id in after(), which asserts its own teardown.
//
// THE "LATEST SETTLED" PICKERS are the reason the void Pick'em and Draft rows
// carry settled_at = now() + 1h: they must be the newest settled rows on DEV
// for the skip to be proven, and they are gone when after() runs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureMark, sweepStale } from '../testing/fixtureMark.mjs';

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
const { VOID_ALL_LABEL } = await import('./voidRule.js');
const { weeklyResults } = await import('../results/weekly.js');
const { draftResults } = await import('../results/draft.js');
const { pickemResults } = await import('../results/pickem.js');
const { receiptFor } = await import('../pickem/entry.js');
const { boardsPlayedCount, pickemTable } = await import('../games/read.js');
const { pickemBoardV3, draftBoardV3 } = await import('../games/lobbyV3.js');
const { runView } = await import('../run/entry.js');
const { octoberView } = await import('../october/entry.js');

const MARK = fixtureMark('voidallreaders');
const W = 50 + (process.pid % 40);                       // a week no schedule has
const DAY = new Date(Date.UTC(1997, 0, 1) + (process.pid % 300) * 86400e3).toISOString().slice(0, 10);
const VOID_META = { void_all: true, void: [1, 2, 3] };
const ids = { users: {}, contests: {} };

// settled_at is one of two SQL literals chosen here, never caller text.
const SETTLED_AT = { now: 'now()', later: "now() + interval '1 hour'" };
async function mkContest(gameType, sport, season, { week = W, day = null, settledAt = 'now', meta = VOID_META, board = [] } = {}) {
  const res = await sql.query(
    `INSERT INTO contests (game_type, sport, season_year, week, puzzle_date, board, opens_at, locks_at, settles_at, settled, settled_at, perfect, meta)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now() - interval '7 days', now() - interval '3 days', now() - interval '2 days',
             true, ${SETTLED_AT[settledAt]}, NULL, $7::jsonb)
     RETURNING id`,
    [gameType, sport, season, week, day, JSON.stringify(board), JSON.stringify(meta)],
  );
  return (res.rows ?? res)[0].id;
}

before(async () => {
  await sweepStale(sql, MARK);
  for (const k of ['a', 'b']) {
    ids.users[k] = (await sql`INSERT INTO users (email) VALUES (${MARK.email(k)}) RETURNING id`)[0].id;
  }
  const { a: U1, b: U2 } = ids.users;
  ids.contests.weekly = await mkContest('weekly', 'nfl', 1998);
  ids.contests.draft = await mkContest('draft', 'nfl', 1998, { settledAt: 'later' });
  ids.contests.pickem = await mkContest('pickem', 'nfl', 1998, {
    settledAt: 'later',
    board: [{ match_id: 1, home: 'Home', away: 'Away' }, { match_id: 2, home: 'H2', away: 'A2' }],
  });
  ids.contests.run = await mkContest('run', 'mlb', 1997, {
    week: null, day: DAY, meta: { ...VOID_META, preview: true, round: 'world_series', label: 'World Series' }, board: [],
  });
  ids.contests.october = await mkContest('october', 'mlb', 1997, { week: null, day: DAY, meta: { ...VOID_META, games: 0 } });
  // THE CONTROL: a real settled Weekly week, U2 scored.
  ids.contests.control = await mkContest('weekly', 'nfl', 1997, { meta: {} });

  for (const k of ['weekly', 'draft', 'pickem', 'run', 'october']) {
    for (const u of [U1, U2]) {
      await sql`INSERT INTO contest_entries (contest_id, user_id, lineup, meta)
                VALUES (${ids.contests[k]}, ${u}, ${JSON.stringify(k === 'pickem' ? { 1: 'home', 2: 'away' } : {})}::jsonb, '{}'::jsonb)`;
    }
  }
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup, meta, score, base_score)
            VALUES (${ids.contests.control}, ${U2}, '{}'::jsonb, ${JSON.stringify({ pct: 50 })}::jsonb, 10, 10)`;
});

after(async () => {
  const cids = Object.values(ids.contests).filter(Boolean);
  await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${cids})`;
  await sql`DELETE FROM contests WHERE id = ANY(${cids})`;
  await sql`DELETE FROM users WHERE email LIKE ${MARK.like}`;
  const [{ c }] = await sql`SELECT count(*)::int AS c FROM contests WHERE id = ANY(${cids})`;
  const [{ e }] = await sql`SELECT count(*)::int AS e FROM contest_entries WHERE contest_id = ANY(${cids})`;
  const [{ u }] = await sql`SELECT count(*)::int AS u FROM users WHERE email LIKE ${MARK.like}`;
  assert.deepEqual({ c, e, u }, { c: 0, e: 0, u: 0 }, 'teardown: nothing of this run is left');
});

test('RESULTS (/results/weekly|draft|pickem): VOID - the label, no DNF field, no "you did not play"', async () => {
  for (const [game, read] of [['weekly', weeklyResults], ['draft', draftResults], ['pickem', pickemResults]]) {
    const r = await read(ids.contests[game], ids.users.a);
    assert.equal(r.voidAll, true, game);
    assert.equal(r.voidLabel, VOID_ALL_LABEL, game);
    assert.equal(r.field, undefined, `${game}: no field, so no all-DNF distribution`);
    assert.equal(r.noEntryLine, undefined, `${game}: an entrant is not told they did not play`);
    assert.equal(r.header, undefined, `${game}: no score header`);
  }
});

test('PICK\'EM receipt: null on a void board, never "0, rank 1 of N"', async () => {
  const r = await receiptFor(ids.contests.pickem, ids.users.a, { results: null, board: [] });
  assert.equal(r, null);
});

test('BOARDS PLAYED (lobby "boards" stat): a void board is not a board played', async () => {
  assert.equal(await boardsPlayedCount(ids.users.a), 0, 'U1 sat in five void boards and nothing else');
  assert.equal(await boardsPlayedCount(ids.users.b), 1, 'U2: the control week counts, the five void ones do not');
});

test('PICK\'EM season table: a void board is not one of "N boards settled"', async () => {
  const t = await pickemTable(null, { sport: 'nfl' });
  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM contests
     WHERE game_type = 'pickem' AND settled AND sport = 'nfl'
       AND NOT COALESCE((meta->>'void_all')::boolean, false)`;
  // DEV may hold no real settled NFL board at all: then the table is null -
  // the void board alone must not conjure one ("1 board settled", empty).
  if (n === 0) { assert.equal(t, null, 'a void board alone is not a season table'); return; }
  assert.equal(t.through, `${n} board${n === 1 ? '' : 's'} settled`);
  assert.equal([...t.top, t.self].some((r) => r?.userId === ids.users.a), false, 'U1 has no pick\'em record from a void board');
});

test('LOBBY "last settled" panes: the newest settled board is void and is skipped', async () => {
  const pk = await pickemBoardV3(ids.users.a);
  assert.ok(!String(pk.note ?? '').includes(`week ${W}`), 'the pick\'em pane does not show the void week');
  assert.ok(!String(pk.empty ?? '').includes(`Week ${W}`), 'no "Week N settled with no entries" for it');
  const dr = await draftBoardV3(ids.users.a);
  assert.ok(!String(dr.empty ?? '').includes(`Week ${W}`), 'no "You did not play Week N" for a void week');
});

test('THE RUN round view: VOID, never a DNF, no total', async () => {
  const [c] = await sql`SELECT * FROM contests WHERE id = ${ids.contests.run}`;
  const v = await runView(ids.users.a, c, { withPool: false });
  assert.equal(v.phase, 'settled');
  assert.equal(v.contest.voidAll, true);
  assert.equal(v.contest.voidLabel, VOID_ALL_LABEL);
  assert.equal(v.isDnf, false, 'an empty roster on a void round is not a DNF');
  assert.deepEqual(v.dnfSlots, []);
  assert.equal(v.total, null);
});

test('OCTOBER day view: VOID, never a DNF, no total', async () => {
  const [c] = await sql`SELECT * FROM contests WHERE id = ${ids.contests.october}`;
  const v = await octoberView(ids.users.a, c, { withPool: false });
  assert.equal(v.phase, 'settled');
  assert.equal(v.contest.voidAll, true);
  assert.equal(v.contest.voidLabel, VOID_ALL_LABEL);
  assert.equal(v.isDnf, false);
  assert.equal(v.total, null);
});
