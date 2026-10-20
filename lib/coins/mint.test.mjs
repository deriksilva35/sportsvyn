// lib/coins/mint.test.mjs - the coin meter (Rules v0.1 s3) and the hourly mint.
//
// Fixture: SENTINEL users (<ns>-...@example.invalid), contests and one Daily
// board settled inside a 1998 drawing week - nothing real settles in 1998, and
// the mint is run AT a 1998 instant, so its look-back sees only this fixture.
// The sentinel filter is switched off for the run (sentinelLike matches
// nothing) so the fixture's own users are the players. after() deletes every
// row and asserts it did.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const rules = await import('./rules.js');
const wk = await import('./week.js');
const mint = await import('./mint.js');
const { sql } = await import('../db.js');

const NS = `cmint-${process.pid}-${Date.now()}`;
const NOW = new Date('1998-03-12T20:00:00Z');        // Thu; the week opened Tue 10 Mar 09:00 PST
const LATER = new Date('1998-03-19T20:00:00Z');      // the next week
const NOMATCH = '%@never-a-sentinel.invalid';
const U = [];
let house; let contestIds = []; let boardId;
const run = (now = NOW) => mint.runMint({ now, force: true, sentinelLike: NOMATCH });

async function mkUser(tag, { isHouse = false } = {}) {
  const [u] = await sql`INSERT INTO users (email, is_house) VALUES (${`${NS}-${tag}@example.invalid`}, ${isHouse}) RETURNING id`;
  return u.id;
}
async function mkContest({ gameType = 'weekly', sport = 'nfl', settledAt = '1998-03-11T06:00:00Z', meta = {}, scores = [] }) {
  const [c] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, opens_at, locks_at, settled, settled_at, meta)
    VALUES (${gameType}, ${sport}, 1998, ${(process.pid % 90000) * 10 + contestIds.length + 1000}, '1998-03-01T00:00:00Z', '1998-03-02T00:00:00Z', true, ${settledAt}, ${JSON.stringify(meta)}::jsonb)
    RETURNING id`;
  contestIds.push(c.id);
  for (const [uid, score] of scores) {
    await sql`INSERT INTO contest_entries (contest_id, user_id, score, created_at) VALUES (${c.id}, ${uid}, ${score}, '1998-03-10T20:00:00Z')`;
  }
  return c.id;
}

before(async () => {
  for (let i = 0; i < 12; i += 1) U.push(await mkUser(`p${i}`));
  house = await mkUser('house', { isHouse: true });
  // A weekly with 12 players + 1 house: scores 120, 110, ... 10. One clear winner.
  await mkContest({ scores: [...U.map((u, i) => [u, 120 - 10 * i]), [house, 999]] });
  // Nine players: under the floor, nothing.
  await mkContest({ scores: U.slice(0, 9).map((u, i) => [u, 50 - i]) });
  // Void-all: nothing.
  await mkContest({ meta: { void_all: true }, scores: U.map((u) => [u, 1]) });
  // NBA day Pick'em: not announced as eligible yet.
  await mkContest({ gameType: 'pickem', sport: 'nba', scores: U.map((u, i) => [u, i]) });
  // The Daily: a board closed this week, 10 players, two tied at the top.
  const [b] = await sql`
    INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, slots, opens_at, closes_at)
    VALUES (${`1997-0${1 + (process.pid % 9)}-${String(1 + (process.pid % 27)).padStart(2, '0')}`}, 1998, ${NS}, '[]'::jsonb, 100, '[]'::jsonb, '[]'::jsonb,
            '1998-03-10T08:00:00Z', '1998-03-11T08:00:00Z') RETURNING id`;
  boardId = b.id;
  for (let i = 0; i < 10; i += 1) {
    await sql`INSERT INTO daily_board_runs (board_id, user_id, picks, score, pct, matched, elapsed_s, completed_at)
              VALUES (${boardId}, ${U[i]}, '[]'::jsonb, ${i < 2 ? 900 : 800 - i}, 50, 1, 60, '1998-03-10T20:00:00Z')`;
  }
});

after(async () => {
  const weeks = (await sql`SELECT id FROM coin_weeks WHERE opens_at < '2000-01-01'`).map((w) => w.id);
  await sql`DELETE FROM arcade_points WHERE week_id = ANY(${weeks})`;
  await sql`DELETE FROM coin_mint WHERE week_id = ANY(${weeks})`;
  await sql`DELETE FROM drum_prizes WHERE week_id = ANY(${weeks})`;
  await sql`DELETE FROM coin_weeks WHERE id = ANY(${weeks})`;
  await sql`DELETE FROM daily_board_runs WHERE board_id = ${boardId}`;
  await sql`DELETE FROM daily_boards WHERE id = ${boardId}`;
  await sql`DELETE FROM contests WHERE id = ANY(${contestIds})`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM coin_weeks WHERE opens_at < '2000-01-01')
         + (SELECT count(*) FROM contests WHERE id = ANY(${contestIds})) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

test('THE WEEK (s2): opens Tue 09:00 PT, across DST', () => {
  // Tue 20 Oct 2026 is PDT: 16:00Z. Tue 3 Nov 2026 is PST: 17:00Z.
  assert.equal(wk.weekOf(new Date('2026-10-22T12:00:00Z')).opensAt.toISOString(), '2026-10-20T16:00:00.000Z');
  assert.equal(wk.weekOf(new Date('2026-10-22T12:00:00Z')).closesAt.toISOString(), '2026-10-27T16:00:00.000Z');
  assert.equal(wk.weekOf(new Date('2026-11-04T12:00:00Z')).opensAt.toISOString(), '2026-11-03T17:00:00.000Z');
  // The week that spans the change closes at the PST instant.
  assert.equal(wk.weekOf(new Date('2026-10-30T12:00:00Z')).closesAt.toISOString(), '2026-11-03T17:00:00.000Z');
  // Tuesday 08:59 PT is still last week; 09:00 is the new one.
  assert.equal(wk.weekOf(new Date('2026-10-27T15:59:59Z')).opensAt.toISOString(), '2026-10-20T16:00:00.000Z');
  assert.equal(wk.weekOf(new Date('2026-10-27T16:00:00Z')).opensAt.toISOString(), '2026-10-27T16:00:00.000Z');
});

test('THE POINT TABLE (s3), PURE: one finish tier, the best; nothing under 10', () => {
  const t = rules.finishTier;
  assert.deepEqual(t({ rank: 1, n: 10 }), { event: 'win', points: 250 });
  assert.deepEqual(t({ rank: 1, n: 10, atRank: 2 }), { event: 'top3', points: 150 }, 'a shared 1st is not an outright win');
  assert.equal(t({ rank: 4, n: 40 }).event, 'top10');
  assert.equal(t({ rank: 5, n: 40 }).event, 'top25', 'top 10% of 40 is places 1-4');
  assert.equal(t({ rank: 10, n: 40 }).event, 'top25');
  assert.equal(t({ rank: 6, n: 40 }).event, 'top25');
  assert.equal(t({ rank: 11, n: 40 }), null);
  assert.equal(t({ rank: 1, n: 9 }), null, 'under the entrant floor');
});

test('THE METER (s3), PURE: 100 points a coin, progress carries, 10 coins a week', () => {
  assert.equal(rules.mintQty({ totalPoints: 250 }), 2);
  assert.equal(rules.mintQty({ totalPoints: 250, mintedEver: 2 }), 0, 'the 50 left is progress, not a coin');
  assert.equal(rules.mintQty({ totalPoints: 1500, mintedThisWeek: 0 }), 10, 'the cap');
  assert.equal(rules.mintQty({ totalPoints: 1500, mintedEver: 10, mintedThisWeek: 0 }), 5, 'next week the carried points mint');
  assert.deepEqual(rules.meter({ totalPoints: 275, mintedEver: 2 }), { into: 75, toNext: 25, banked: 0 });
  assert.equal(rules.lowestDrum(rules.DEFAULT_PRIZES).prize_key, 'gc10');
});

test('THE MINT: the weekly pays 25 a finisher + a tier; floor, void and NBA pay nothing; house is not a player', async () => {
  const r = await run();
  assert.equal(r.decision, 'ran');
  const pts = await sql`SELECT user_id, contest_key, event, points FROM arcade_points WHERE user_id = ANY(${[...U, house]})`;
  assert.ok(!pts.some((p) => p.user_id === house), 'house earns nothing');
  const weekly = pts.filter((p) => p.contest_key === `contest:${contestIds[0]}`);
  assert.equal(weekly.filter((p) => p.event === 'settled').length, 12, '12 finishers, house out of the field');
  const top = weekly.filter((p) => p.user_id === U[0]).map((p) => p.event).sort();
  assert.deepEqual(top, ['settled', 'win'], 'the outright winner: 25 + 250, not every tier');
  assert.deepEqual(weekly.filter((p) => p.user_id === U[2]).map((p) => p.event).sort(), ['settled', 'top3']);
  assert.deepEqual(weekly.filter((p) => p.user_id === U[3]).map((p) => p.event), ['settled'], '4th of 12: the top 25% of 12 is places 1-3');
  for (const id of contestIds.slice(1)) assert.equal(pts.filter((p) => p.contest_key === `contest:${id}`).length, 0, `contest ${id} earns nothing`);
  // The Daily: two tied at 900 share 1st - top 3, not a win.
  const daily = pts.filter((p) => p.contest_key === `daily:${boardId}`);
  assert.equal(daily.filter((p) => p.event === 'settled').length, 10);
  assert.deepEqual(daily.filter((p) => p.user_id === U[0]).map((p) => p.event).sort(), ['settled', 'top3']);
  assert.ok(!daily.some((p) => p.event === 'win'));
  // First play this week: every one of the 12.
  assert.equal(pts.filter((p) => p.event === 'first-play').length, 12);
  // The winner: 100 + 25 + 250 + 25 + 150 = 550 -> 5 coins.
  const [{ q }] = await sql`SELECT COALESCE(sum(qty), 0)::int AS q FROM coin_mint WHERE user_id = ${U[0]}`;
  assert.equal(q, 5);
});

test('IDEMPOTENT: a rerun inserts nothing and mints nothing', async () => {
  const before = await sql`SELECT count(*)::int AS n, (SELECT COALESCE(sum(qty),0)::int FROM coin_mint WHERE user_id = ANY(${U})) AS q FROM arcade_points WHERE user_id = ANY(${U})`;
  const r = await run();
  assert.equal(r.inserted, 0);
  assert.equal(r.coins, 0);
  const after2 = await sql`SELECT count(*)::int AS n, (SELECT COALESCE(sum(qty),0)::int FROM coin_mint WHERE user_id = ANY(${U})) AS q FROM arcade_points WHERE user_id = ANY(${U})`;
  assert.deepEqual(after2, before);
});

test('A DRAWN WEEK TAKES NOTHING MORE: a late settlement pays into the open week', async () => {
  const [w] = await sql`SELECT id FROM coin_weeks WHERE opens_at = '1998-03-10T17:00:00Z'`;
  await sql`UPDATE coin_weeks SET drawn_at = '1998-03-17T17:00:00Z' WHERE id = ${w.id}`;
  const late = await mkContest({ settledAt: '1998-03-12T06:00:00Z', scores: U.map((u, i) => [u, i]) });
  await run(LATER);
  const [{ week_id: wid }] = await sql`SELECT DISTINCT week_id FROM arcade_points WHERE contest_key = ${`contest:${late}`}`;
  const [open] = await sql`SELECT id, opens_at FROM coin_weeks WHERE id = ${wid}`;
  assert.notEqual(wid, w.id, 'not into the drawn week');
  assert.equal(new Date(open.opens_at).toISOString(), '1998-03-17T17:00:00.000Z');
});

test('A RACE MINTS ONCE: two runs at the same instant, one set of coins (148 seq)', async () => {
  const sum = async () => (await sql`SELECT COALESCE(sum(qty), 0)::int AS q FROM coin_mint WHERE user_id = ANY(${U})`)[0].q;
  const had = await sum();
  const wk = (await sql`SELECT id FROM coin_weeks WHERE opens_at < '2000-01-01' AND drawn_at IS NULL`).map((w) => w.id);
  await sql`DELETE FROM coin_mint WHERE user_id = ANY(${U}) AND week_id = ANY(${wk})`;
  const less = await sum();
  await Promise.all([run(LATER), run(LATER)]);
  assert.equal(await sum(), had, `re-minted ${had - less} once, not twice`);
});
