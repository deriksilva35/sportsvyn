// lib/draft/rulesDraft.test.mjs - relay sat-5 area B, the Draft room rulings,
// against DEV. Sentinel contest (its own sport, season 1999, week 99 - no
// games, invisible to every current-contest reader) and run-scoped users;
// after() deletes both and asserts it did.
//
//   D1  same contest + same seat + same human picks -> the same bot picks;
//       one board per contest, frozen once.
//   D5  'abandoned' ranked rooms complete at lock; no client abandon; ranked
//       refused server-side.
//   D7  the claim comes before the room; a crash between cannot yield a room
//       nobody's entry owns.

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
const d = await import('../fantasy/drafts.js');
const { openRankedRoom, getDraftEntry } = await import('./entry.js');
const { DRAFT_CONFIG, DRAFT_ROUNDS } = await import('./contest.js');
const { botSeed } = await import('./roomSeed.js');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const MARK = fixtureMark('rulesdraft');
const SPORT = `sentinel-rulesdraft-${process.pid}`.slice(0, 40);
const U = {};
let CONTEST;

async function mkUser(tag) {
  return (await sql`INSERT INTO users (name, email) VALUES (${'RulesDraft ' + tag}, ${MARK.email(tag)}) RETURNING id`)[0].id;
}
async function mkContest(week) {
  return (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled, meta)
    VALUES ('draft', ${SPORT}, 1999, ${week}, '[]'::jsonb, now() - interval '1 hour',
            now() + interval '2 days', false, '{}'::jsonb) RETURNING *`)[0];
}

before(async () => {
  await sweepStale(sql, MARK);
  await sql`DELETE FROM contests WHERE sport LIKE 'sentinel-rulesdraft-%' AND created_at < now() - interval '1 hour'`;
  for (const t of ['a', 'b', 'c', 'crash', 'race', 'ab', 'prac']) U[t] = await mkUser(t);
  CONTEST = await mkContest(99);
});

after(async () => {
  await sql`DELETE FROM users WHERE email LIKE ${MARK.like}`;
  await sql`DELETE FROM contests WHERE sport = ${SPORT}`;
  const [u] = await sql`SELECT count(*)::int n FROM users WHERE email LIKE ${MARK.like}`;
  const [c] = await sql`SELECT count(*)::int n FROM contests WHERE sport = ${SPORT}`;
  assert.equal(u.n + c.n, 0, 'the sentinels are gone');
});

const SEAT = 3;

/** Drive a room through `turns` human turns; `choose` picks from the room's available list. */
async function drive(userId, draftId, turns, choose) {
  for (let i = 0; i < turns; i++) {
    const room = await d.getDraftForRoom(draftId, userId);
    const avail = room.available;
    const order = choose(avail);
    let ok = false;
    for (const p of order) {
      const r = await d.makePickFor(userId, draftId, p.ffcPlayerId);
      if (r.ok) { ok = true; break; }
      if (r.reason !== 'illegal_pick') {
        assert.fail(`pick refused: ${JSON.stringify(r)}`);
      }
    }
    assert.ok(ok, `turn ${i + 1}: some pick was legal`);
  }
}
const botPicks = async (draftId) => sql`
  SELECT overall_pick, ffc_player_id FROM draft_picks
   WHERE draft_id = ${draftId} AND picked_by = 'ai' ORDER BY overall_pick`;
const userPicks = async (draftId) => (await sql`
  SELECT ffc_player_id FROM draft_picks WHERE draft_id = ${draftId} AND picked_by = 'user'
   ORDER BY overall_pick`).map((r) => r.ffc_player_id);

// ---------------------------------------------------------------------------
// D1 - THE SEED
// ---------------------------------------------------------------------------
test('D1 seed: a ranked room keys on (contest, seat, pick) - not the room id', () => {
  const r = { contestId: 41 };
  assert.equal(botSeed({ draftId: 1, overallPick: 5, ranked: r, seat: 3 }),
    botSeed({ draftId: 999, overallPick: 5, ranked: r, seat: 3 }), 'two rooms, same seat: same dice');
  assert.notEqual(botSeed({ draftId: 1, overallPick: 5, ranked: r, seat: 3 }),
    botSeed({ draftId: 1, overallPick: 5, ranked: r, seat: 4 }), 'another seat rolls other dice');
  assert.notEqual(botSeed({ draftId: 1, overallPick: 5, ranked: r, seat: 3 }),
    botSeed({ draftId: 1, overallPick: 5, ranked: { contestId: 42 }, seat: 3 }), 'another week too');
  assert.notEqual(botSeed({ draftId: 1, overallPick: 5, ranked: r, seat: 3 }),
    botSeed({ draftId: 1, overallPick: 6, ranked: r, seat: 3 }), 'and another pick');
  // PRACTICE ROOMS KEEP THEIR OWN SEEDING, exactly the old key.
  assert.equal(botSeed({ draftId: 1234, overallPick: 7 }), 1234 * 7919 + 7);
  assert.equal(botSeed({ draftId: 1234, overallPick: 7, ranked: null, seat: 3 }), 1234 * 7919 + 7);
});

test('D1: same contest + same seat + same human picks -> identical bot picks; one board for the week', { timeout: 240000 }, async () => {
  const a = await openRankedRoom(CONTEST, U.a, SEAT);
  const b = await openRankedRoom(CONTEST, U.b, SEAT);
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.notEqual(a.draftId, b.draftId, 'two rooms');

  // ONE BOARD PER CONTEST, and both rooms froze a copy of it.
  const [cb] = await sql`SELECT rows FROM draft_contest_boards WHERE contest_id = ${CONTEST.id}`;
  assert.ok(cb?.rows?.length > 0, 'the week froze a board');
  const boards = await sql`SELECT draft_id, rows FROM draft_boards WHERE draft_id IN (${a.draftId}, ${b.draftId}) ORDER BY draft_id`;
  assert.equal(boards.length, 2);
  assert.deepEqual(boards[0].rows, cb.rows, 'room A drafts the week\'s board');
  assert.deepEqual(boards[1].rows, cb.rows, 'room B drafts the same board');

  // Before the first human pick the rooms are already identical (picks 1, 2).
  assert.deepEqual(await botPicks(a.draftId), await botPicks(b.draftId));

  // Same human picks: best available that is legal, three turns.
  const same = (avail) => avail;
  await drive(U.a, a.draftId, 3, same);
  await drive(U.b, b.draftId, 3, same);
  assert.deepEqual(await userPicks(a.draftId), await userPicks(b.draftId), 'the fixture made the same human picks');
  const botsA = await botPicks(a.draftId);
  const botsB = await botPicks(b.draftId);
  assert.ok(botsA.length >= 2 + 2 * 11, `bots ran through the turns (${botsA.length})`);
  assert.deepEqual(botsA, botsB, 'identical bot picks, pick for pick');

  // DIFFERENT human picks: the room starts the same and the bots react.
  const c = await openRankedRoom(CONTEST, U.c, SEAT);
  assert.equal(c.ok, true);
  const before = await botPicks(c.draftId);
  assert.deepEqual(before, botsA.filter((p) => p.overall_pick < SEAT), 'same start');
  // Take the board's tenth-best instead of its best, every turn.
  await drive(U.c, c.draftId, 3, (avail) => [...avail.slice(9), ...avail.slice(0, 9)]);
  assert.notDeepEqual(await userPicks(c.draftId), await userPicks(a.draftId), 'the human picks differ');
  const botsC = await botPicks(c.draftId);
  assert.equal(botsC.length, botsA.length, 'the room still runs to the same turn');
  // MAY differ - and every bot pick before the first divergent human pick is the same.
  const firstHuman = (await sql`SELECT min(overall_pick)::int n FROM draft_picks WHERE draft_id = ${c.draftId} AND picked_by = 'user'`)[0].n;
  assert.deepEqual(botsC.filter((p) => p.overall_pick < firstHuman), botsA.filter((p) => p.overall_pick < firstHuman));
});

test('D1: the house opens its room the same way and drafts the week\'s board', () => {
  const run = strip(src('lib/house/run.js'));
  assert.match(run, /openRankedRoom\(contest, userId, seat\)/);
  assert.doesNotMatch(run, /startCustomDraftFor\(/, 'no second way to open a ranked room');
});

test('D1 copy: the seat screen says exactly the ruling\'s sentence', () => {
  const s = strip(src('components/draft/SeatSelect.js'));
  assert.match(s, /Everyone at seat \{picked\.seat\} starts from the same room; bots react to your picks\./);
  assert.doesNotMatch(s, /same seed for everyone/);
  assert.doesNotMatch(s, /faces\s+the same room/);
});

// ---------------------------------------------------------------------------
// D7 - CLAIM FIRST
// ---------------------------------------------------------------------------
test('D7: a request killed between the claim and the room leaves a claim and NO room - and the claim opens its room next time', async () => {
  const crash = async () => { throw new Error('killed between claim and room'); };
  await assert.rejects(openRankedRoom(CONTEST, U.crash, 5, { start: crash }), /killed/);

  const entry = await getDraftEntry(CONTEST.id, U.crash);
  assert.ok(entry, 'the claim was written first');
  assert.equal(entry.meta?.draftId, undefined, 'and it owns no room');
  const [{ n: rooms }] = await sql`SELECT count(*)::int n FROM drafts WHERE user_id = ${U.crash}`;
  assert.equal(rooms, 0, 'no room exists - nobody has seen a board');

  const opened = await openRankedRoom(CONTEST, U.crash, 5);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const linked = await getDraftEntry(CONTEST.id, U.crash);
  assert.equal(Number(linked.meta.draftId), opened.draftId, 'the same claim now owns the room');
  assert.equal(linked.id, entry.id, 'one entry, not a second');

  const again = await openRankedRoom(CONTEST, U.crash, 9);
  assert.deepEqual({ ok: again.ok, draftId: again.draftId, resumed: again.resumed },
    { ok: true, draftId: opened.draftId, resumed: true }, 'a reload resumes, whatever seat it asks for');
});

test('D7: a room is never born without its claim - a lost link deletes the room before it drafts', async () => {
  const opened = await openRankedRoom(CONTEST, U.race, 2);
  assert.equal(opened.ok, true);
  const entry = await getDraftEntry(CONTEST.id, U.race);
  const [{ n: cfgBefore }] = await sql`SELECT count(*)::int n FROM draft_configs WHERE user_id = ${U.race}`;
  // A second start against an entry that is already linked: the race loser.
  const lost = await d.startCustomDraftFor(U.race, DRAFT_CONFIG, 2, { ranked: true, contestId: CONTEST.id, entryId: entry.id });
  assert.equal(lost.ok, false);
  assert.equal(lost.reason, 'already entered');
  assert.equal(lost.draftId, opened.draftId, 'pointed at the winner');
  const rooms = await sql`SELECT id FROM drafts WHERE user_id = ${U.race}`;
  assert.deepEqual(rooms.map((r) => r.id), [opened.draftId], 'the loser\'s room is gone');
  const [{ n: cfgAfter }] = await sql`SELECT count(*)::int n FROM draft_configs WHERE user_id = ${U.race}`;
  assert.equal(cfgAfter, cfgBefore, 'and so is its config row');
});

test('D7: two tabs at once get ONE room', async () => {
  const uid = await mkUser('tabs');
  const [x, y] = await Promise.all([openRankedRoom(CONTEST, uid, 6), openRankedRoom(CONTEST, uid, 6)]);
  assert.equal(x.ok && y.ok, true, JSON.stringify([x, y]));
  assert.equal(x.draftId, y.draftId);
  const rooms = await sql`SELECT id FROM drafts WHERE user_id = ${uid}`;
  assert.equal(rooms.length, 1);
});

test('D7: every ranked room in the contest is owned by exactly one entry', async () => {
  const orphans = await sql`
    SELECT dr.id FROM drafts dr
      JOIN users u ON u.id = dr.user_id
     WHERE u.email LIKE ${MARK.like}
       AND NOT EXISTS (SELECT 1 FROM contest_entries e WHERE (e.meta->>'draftId')::int = dr.id)`;
  assert.deepEqual(orphans, [], 'no ranked room without a claim');
});

test('D7: the route claims first, through the one opener, and says so', () => {
  const route = src('app/api/draft/start/route.js');
  assert.match(strip(route), /openRankedRoom\(contest, Number\(userId\), seat\)/);
  assert.doesNotMatch(strip(route), /startCustomDraftFor|claimEntry|status = 'abandoned'/,
    'no room is created ahead of its claim, and none is marked abandoned');
  assert.match(route, /THE CLAIM COMES FIRST/);
});

// ---------------------------------------------------------------------------
// D5 - NO CLIENT ABANDON; 'abandoned' COMPLETES AT LOCK
// ---------------------------------------------------------------------------
test('D5: a ranked room cannot be abandoned, and a legacy abandoned one completes like any other', { timeout: 120000 }, async () => {
  const opened = await openRankedRoom(CONTEST, U.ab, 1);
  assert.equal(opened.ok, true);
  const refused = await d.abandonDraftFor(U.ab, opened.draftId);
  assert.deepEqual(refused, { ok: false, reason: 'ranked_room' });

  // A row that is ALREADY 'abandoned' (the old route's race path wrote them).
  await sql`UPDATE drafts SET status = 'abandoned' WHERE id = ${opened.draftId}`;
  const done = await d.autoCompleteDraftFor(opened.draftId);
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.completed, true, 'it completes rather than returning untouched');
  const [row] = await sql`SELECT status FROM drafts WHERE id = ${opened.draftId}`;
  assert.equal(row.status, 'completed');
  const [{ n }] = await sql`SELECT count(*)::int n FROM draft_picks WHERE draft_id = ${opened.draftId} AND picked_by = 'user'`;
  assert.equal(n, DRAFT_ROUNDS, 'every seat pick filled');
});

test('D5: a PRACTICE room marked abandoned is still left alone', { timeout: 120000 }, async () => {
  const PRESET = (await sql`SELECT id FROM draft_configs WHERE is_preset AND scoring_format='ppr' AND teams_count=12 LIMIT 1`)[0];
  const s = await d.startDraftFor(U.prac, PRESET.id, 2, { auto: false });
  assert.equal(s.ok, true);
  const ab = await d.abandonDraftFor(U.prac, s.draftId);
  assert.equal(ab.ok, true, 'practice abandon still works server-side');
  const r = await d.autoCompleteDraftFor(s.draftId);
  assert.equal(r.completed, false);
  assert.equal(r.reason, 'abandoned');
});

test('D5: no client-callable abandon', () => {
  const actions = strip(src('app/actions/sim.js'));
  assert.doesNotMatch(actions, /export async function abandonDraft\b/);
  assert.doesNotMatch(actions, /abandonDraftFor/);
});

// ---------------------------------------------------------------------------
// D3 / D4 / D6 / D10 - copy and comments
// ---------------------------------------------------------------------------
test('D3: the seat is chosen each week', () => {
  const p = src('app/games/how-it-works/page.js');
  assert.doesNotMatch(p, /yours all season/);
  assert.match(p, /t: 'Seat', d: 'Take one of twelve\. You choose again every week\.'/);
});

test('D4: drafted from the Sportsvyn board, scored on that week\'s stats', () => {
  const p = src('app/draft/page.js');
  assert.doesNotMatch(p, /Same pool as The Weekly/);
  assert.match(p, /Drafted from the Sportsvyn board against a room of\s+eleven, scored on that week&apos;s stats\./);
});

test('D6: the clock is not called advisory, and the comment no longer says there is no server deadline', () => {
  const room = src('components/sim/DraftRoom.js');
  assert.doesNotMatch(room, /advisory · auto-picks/);
  assert.doesNotMatch(room, /no server deadline/);
  assert.doesNotMatch(room, /a reload restarts it/);
  assert.match(room, /'auto-picks at 0 · runs while you are away'/);
});

test('D10: no comment claims a room drafts across a kickoff', () => {
  for (const f of ['lib/draft/pool.js', 'lib/draft/entry.js', 'lib/fantasy/drafts.js']) {
    assert.doesNotMatch(src(f), /room that straddles|straddles a kickoff|room begun in the last hour/, f);
  }
});

// ---------------------------------------------------------------------------
// sat-6 - THE WEEK'S BOARD IS BUILT ONCE, UNDER A LOCK
// ---------------------------------------------------------------------------
test('sat-6: a frozen board is never rebuilt, and a caller that loses the lock waits for the winner\'s row', { timeout: 60000 }, async () => {
  const { contestBoardFor } = await import('./frozenBoard.js');
  const wk = await mkContest(98);
  let computed = 0;
  const compute = async () => { computed += 1; return { rows: [{ ffcPlayerId: 'mine' }], label: 'mine' }; };

  // Somebody else holds the lock and writes the board a moment later.
  const held = async () => ({ locked: true });
  setTimeout(() => {
    sql`INSERT INTO draft_contest_boards (contest_id, computed_at, label, rows)
        VALUES (${wk.id}, now(), 'theirs', '[{"ffcPlayerId":"theirs"}]'::jsonb)`.catch(() => {});
  }, 700);
  const got = await contestBoardFor(wk.id, compute, { lock: held });
  assert.equal(got?.label, 'theirs', 'the winner\'s board, not a second one');
  assert.equal(computed, 0, 'the loser never built');

  // And with the board there, nobody builds again - lock or no lock.
  const again = await contestBoardFor(wk.id, compute);
  assert.equal(again.label, 'theirs');
  assert.equal(computed, 0);
});

test('sat-6: the cron freezes an open week nobody has drafted, through the same builder a room uses', { timeout: 120000 }, async () => {
  const { freezeOpenDraftBoards } = await import('./lockBridge.js');
  const wk = await mkContest(97);
  const r = await freezeOpenDraftBoards({ sport: SPORT });
  const mine = r.results.find((x) => x.contestId === wk.id);
  assert.equal(mine?.ok, true, JSON.stringify(r));
  const [b] = await sql`SELECT jsonb_array_length(rows)::int n FROM draft_contest_boards WHERE contest_id = ${wk.id}`;
  assert.equal(b.n, mine.rows, 'the frozen board is the one it reported');
  // A room opened afterwards copies THAT board.
  const uid = await mkUser('cron');
  const o = await openRankedRoom(wk, uid, 4);
  assert.equal(o.ok, true);
  const [same] = await sql`SELECT (a.rows = b.rows) AS eq FROM draft_boards a, draft_contest_boards b
                            WHERE a.draft_id = ${o.draftId} AND b.contest_id = ${wk.id}`;
  assert.equal(same.eq, true);
});
