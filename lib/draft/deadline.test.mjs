// lib/draft/deadline.test.mjs - THE CLOCK BECOMES A DEADLINE, and the board
// stops moving under a running room.
//
// ============================================================================
// THE DEFECT, DATED AND MEASURED
// ============================================================================
// Room 543 sat on pick 7.06 for hours. Nothing was broken: the countdown was a
// setInterval in the client, the player's phone slept, and so nothing ever
// counted. Eleven bots waited on one backgrounded tab, and no request the
// server received knew the turn had expired - because the only record of when
// it should have was in a tab that was not running.
//
// The pure half of this file runs on fixtures at a chosen instant, because
// "has it expired" and "how much is left" are exactly the two questions a test
// must be able to ask at a time it picks. The DB half creates its own user and
// its own draft and deletes them, because the only honest proof that a read
// resolves an expired turn is to let a read resolve one.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deadlineFrom, isExpired, remainingSeconds } from './deadline.js';
import { fixtureMark, sweepStale } from '../testing/fixtureMark.mjs';

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

const NOW = new Date('2026-09-18T12:00:00.000Z');
const at = (sec) => new Date(NOW.getTime() + sec * 1000);

// ---------------------------------------------------------------------------
// 1. THE DEADLINE ITSELF
// ---------------------------------------------------------------------------
test('a timed turn gets a deadline of now plus the room clock', () => {
  assert.equal(deadlineFrom(30, NOW).toISOString(), '2026-09-18T12:00:30.000Z');
  assert.equal(deadlineFrom(90, NOW).toISOString(), '2026-09-18T12:01:30.000Z');
});

test('AN UNTIMED ROOM GETS NO DEADLINE - null, not zero, not now', () => {
  // A practice mock with no clock must never be swept: a deadline of "now"
  // would auto-pick the reader's turn the instant they loaded the page.
  assert.equal(deadlineFrom(null, NOW), null);
  assert.equal(deadlineFrom(0, NOW), null);
  assert.equal(deadlineFrom(undefined, NOW), null);
  assert.equal(deadlineFrom(-5, NOW), null);
});

test('expiry is STRICTLY after, so a tap on the same millisecond is still yours', () => {
  assert.equal(isExpired(at(30), at(29)), false);
  assert.equal(isExpired(at(30), at(30)), false, 'the boundary belongs to the player');
  assert.equal(isExpired(at(30), at(31)), true);
});

test('NO DEADLINE IS NOT AN EXPIRED ONE', () => {
  assert.equal(isExpired(null, NOW), false);
  assert.equal(isExpired(undefined, NOW), false);
  assert.equal(isExpired('not a date', NOW), false);
});

// ---------------------------------------------------------------------------
// 2. WHAT THE CLIENT SHOWS - THE RELOAD THAT USED TO BUY A FRESH CLOCK
// ---------------------------------------------------------------------------
test('a reload mid-turn shows the REMAINDER, not the full clock', () => {
  // The whole reason the countdown seeds from the stored deadline: before
  // this, refreshing restarted it at 30, so a reload bought another half
  // minute - forever, and the number on screen was never the number the
  // server would act on.
  assert.equal(remainingSeconds(at(30), 30, at(0)), 30);
  assert.equal(remainingSeconds(at(30), 30, at(11)), 19);
  assert.equal(remainingSeconds(at(30), 30, at(29)), 1);
});

test('it rounds UP, because a fraction of a second is still time on the clock', () => {
  assert.equal(remainingSeconds(at(30), 30, new Date(NOW.getTime() + 29_600)), 1);
  assert.equal(remainingSeconds(at(30), 30, new Date(NOW.getTime() + 29_999)), 1);
});

test('it never goes below zero, and never above the room own clock', () => {
  assert.equal(remainingSeconds(at(30), 30, at(120)), 0, 'a stale deadline reads 0, and the next read resolves it');
  // A deadline further out than the timer means a changed config or a skewed
  // clock; "45" in a thirty-second room is a number nobody could explain.
  assert.equal(remainingSeconds(at(45), 30, at(0)), 30);
});

test('no deadline, nothing to render', () => {
  assert.equal(remainingSeconds(null, 30, NOW), null);
});

// ---------------------------------------------------------------------------
// 3. THE ROOM ITSELF, AGAINST THE DATABASE
// ---------------------------------------------------------------------------
const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const d = await import('../fantasy/drafts.js');
const { frozenBoard } = await import('./frozenBoard.js');

const MARK = fixtureMark('deadlinetest');   // per run (test-iso relay)
async function wipe() { await sql`DELETE FROM users WHERE email LIKE ${MARK.like}`; }
let USER; let TIMED; let UNTIMED;
before(async () => {
  await wipe();
  await sweepStale(sql, MARK);
  USER = (await sql`INSERT INTO users (name, email)
    VALUES ('DeadlineTest', ${MARK.email('user')}) RETURNING id`)[0].id;
  TIMED = (await sql`SELECT id, pick_timer_seconds FROM draft_configs
                      WHERE is_preset AND scoring_format='ppr' AND teams_count=12
                        AND pick_timer_seconds IS NOT NULL
                      ORDER BY pick_timer_seconds LIMIT 1`)[0];
  UNTIMED = (await sql`SELECT id FROM draft_configs
                        WHERE is_preset AND pick_timer_seconds IS NULL LIMIT 1`)[0];
});
after(wipe);

test('A TIMED ROOM STORES ITS DEADLINE THE MOMENT IT RESTS ON A HUMAN TURN', async () => {
  const s = await d.startDraftFor(USER, TIMED.id, 5, { auto: false });
  assert.equal(s.ok, true, JSON.stringify(s));
  const [row] = await sql`SELECT turn_deadline_at, status FROM drafts WHERE id=${s.draftId}`;
  assert.ok(row.turn_deadline_at, 'the clock is on the row, not only in a tab');
  const gap = new Date(row.turn_deadline_at).getTime() - Date.now();
  assert.ok(gap > 0 && gap <= TIMED.pick_timer_seconds * 1000 + 2000,
    `the deadline is one clock away, got ${gap}ms`);
  assert.equal(s.turnDeadlineAt?.getTime?.(), new Date(row.turn_deadline_at).getTime(),
    'and the caller is told the same instant that was stored');
});

test('AN UNTIMED ROOM STORES NO DEADLINE, so nothing can sweep it', async () => {
  if (!UNTIMED) return; // no untimed preset on this database
  const s = await d.startDraftFor(USER, UNTIMED.id, 3, { auto: false });
  assert.equal(s.ok, true, JSON.stringify(s));
  const [row] = await sql`SELECT turn_deadline_at FROM drafts WHERE id=${s.draftId}`;
  assert.equal(row.turn_deadline_at, null);

  // And a read an hour later leaves it exactly where it was.
  const before = await d.getDraftForRoom(s.draftId, USER);
  const after = await d.getDraftForRoom(s.draftId, USER, { now: new Date(Date.now() + 3600_000) });
  assert.equal(after.picks.length, before.picks.length, 'an untimed room is never auto-picked');
  assert.equal(after.currentOverall, before.currentOverall);
});

test('SLEEPING PAST THE DEADLINE: the next READ auto-picks the turn and the bots behind it', async () => {
  const s = await d.startDraftFor(USER, TIMED.id, 5, { auto: false });
  const before = await d.getDraftForRoom(s.draftId, USER);
  assert.equal(before.isMyTurn, true);
  const myOverall = before.currentOverall;

  const [row] = await sql`SELECT turn_deadline_at FROM drafts WHERE id=${s.draftId}`;
  const slept = new Date(new Date(row.turn_deadline_at).getTime() + 5 * 60_000);

  // NO ACTION IS TAKEN. This is a plain read of the room - the thing a
  // returning player's phone does - and it is what resolves the sleep.
  const after = await d.getDraftForRoom(s.draftId, USER, { now: slept });

  assert.ok(after.picks.length > before.picks.length, 'the room moved');
  const mine = after.picks.filter((p) => p.isUser);
  assert.equal(mine.length, 1, 'exactly ONE of my turns was taken - a sleep costs a turn, not a draft');
  assert.equal(mine[0].overall ?? mine[0].overallPick, myOverall, 'and it was the turn that expired');
  assert.ok(after.currentOverall > myOverall, 'the room is on a later pick');
  assert.equal(after.isMyTurn, true, 'and it is waiting on me again');

  const [row2] = await sql`SELECT turn_deadline_at FROM drafts WHERE id=${s.draftId}`;
  assert.ok(new Date(row2.turn_deadline_at).getTime() > new Date(row.turn_deadline_at).getTime(),
    'the new turn has a new clock, starting when the sweep ran');
});

test('THE AUTO-PICK IS THE BOARD BEST, not a random survivor', async () => {
  const s = await d.startDraftFor(USER, TIMED.id, 5, { auto: false });
  const before = await d.getDraftForRoom(s.draftId, USER);
  const topOfBoard = [...before.available].sort((a, b) => Number(a.adp) - Number(b.adp))[0];
  const [row] = await sql`SELECT turn_deadline_at FROM drafts WHERE id=${s.draftId}`;
  const after = await d.getDraftForRoom(s.draftId, USER,
    { now: new Date(new Date(row.turn_deadline_at).getTime() + 1000) });
  const mine = after.picks.filter((p) => p.isUser)[0];
  assert.equal(mine.ffcPlayerId, topOfBoard.ffcPlayerId,
    `expected ${topOfBoard.name}, got ${mine.name ?? mine.playerName}`);
});

test('A READ BEFORE THE DEADLINE CHANGES NOTHING', async () => {
  const s = await d.startDraftFor(USER, TIMED.id, 5, { auto: false });
  const before = await d.getDraftForRoom(s.draftId, USER);
  const [row] = await sql`SELECT turn_deadline_at FROM drafts WHERE id=${s.draftId}`;
  const after = await d.getDraftForRoom(s.draftId, USER,
    { now: new Date(new Date(row.turn_deadline_at).getTime() - 1000) });
  assert.equal(after.picks.length, before.picks.length);
  assert.equal(after.currentOverall, before.currentOverall);
});

// ---------------------------------------------------------------------------
// 4. THE FROZEN BOARD (filed with this relay, one migration)
// ---------------------------------------------------------------------------
test('A ROOM ON OUR BOARD FREEZES IT AT START, and reads the frozen rows after', async () => {
  const s = await d.startDraftFor(USER, TIMED.id, 5, { auto: false });
  const [row] = await sql`SELECT pool_source, pool_snapshot_date, pool_scoring_format, pool_teams_count
                            FROM drafts WHERE id=${s.draftId}`;
  if (row.pool_source !== 'sportsvyn') return; // an FFC room names its snapshot instead
  const fb = await frozenBoard(s.draftId);
  assert.ok(fb, 'the board is on the row');
  assert.ok(fb.rows.length >= 96, `${fb.rows.length} rows - a 12x8 room needs 96 picks`);
  assert.match(fb.label ?? '', /^Sportsvyn board · 20\d\d$/);

  // poolFor returns THOSE rows, in THAT order.
  const pool = await d.poolFor({ id: s.draftId, ...row }, { roster_slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 } });
  assert.equal(pool.length, fb.rows.length);
  assert.equal(pool[0].ffcPlayerId, fb.rows[0].ffcPlayerId);
  assert.deepEqual(pool.map((p) => p.adp).slice(0, 20), fb.rows.map((p) => p.adp).slice(0, 20));
});

test('THE BOARD DOES NOT MOVE BETWEEN TWO READS OF A RUNNING ROOM', async () => {
  // The defect this closes: ourBoard ranks on finals as they land, so a room
  // open across Thursday night would reorder under the reader between two
  // taps - and its RANK column would stop agreeing with the adp_at_pick
  // already frozen on its own picks.
  const s = await d.startDraftFor(USER, TIMED.id, 7, { auto: false });
  const a = await d.getDraftForRoom(s.draftId, USER);
  const b = await d.getDraftForRoom(s.draftId, USER);
  assert.deepEqual(b.available.map((p) => [p.ffcPlayerId, p.adp]),
    a.available.map((p) => [p.ffcPlayerId, p.adp]),
    'same room, same board, same order');
});

test('THE FREEZE IS WRITE-ONCE: a second call cannot rewrite a board', async () => {
  const { freezeBoard } = await import('./frozenBoard.js');
  const s = await d.startDraftFor(USER, TIMED.id, 2, { auto: false });
  const first = await frozenBoard(s.draftId);
  if (!first) return;
  await freezeBoard(s.draftId, { rows: [{ ffcPlayerId: 'x', name: 'Nobody', adp: 1 }], label: 'tampered' });
  const second = await frozenBoard(s.draftId);
  assert.equal(second.rows.length, first.rows.length, 'ON CONFLICT DO NOTHING - the board is what it was');
  assert.equal(second.label, first.label);
});

// ---------------------------------------------------------------------------
// 5. THE ROOMS THAT ALREADY EXIST - what migration 105 finds on the way in
// ---------------------------------------------------------------------------
// Two populations exist on PROD the moment this ships, and neither of them
// went through the new write paths. They are the whole migration risk, so
// they get their own tests rather than an argument.

test('A ROOM WITH NO FROZEN BOARD RECOMPUTES - it does not fail', async () => {
  // Every Sportsvyn-board room started before migration 105 is in exactly this
  // state: pool_source 'sportsvyn', no draft_boards row. They were recomputing
  // their board on every load before this relay, so recomputing is not a
  // regression for them - it is the behaviour they already had. Failing would
  // be: poolFor is on the path of the room page, the pick writer, the results
  // reader and the settle's auto-complete, so a throw here is a 500 on a room
  // that was working yesterday.
  const s = await d.startDraftFor(USER, TIMED.id, 4, { auto: false });
  const [row] = await sql`SELECT id, pool_source, pool_snapshot_date, pool_scoring_format, pool_teams_count
                            FROM drafts WHERE id=${s.draftId}`;
  if (row.pool_source !== 'sportsvyn') return;

  const withFrozen = await d.poolFor(row, { roster_slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 } });

  // Make it look like a pre-105 room.
  await sql`DELETE FROM draft_boards WHERE draft_id=${s.draftId}`;
  assert.equal(await frozenBoard(s.draftId), null, 'no frozen row, as a pre-105 room has none');

  const recomputed = await d.poolFor(row, { roster_slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 } });
  assert.ok(Array.isArray(recomputed), 'it returns a board rather than throwing');
  assert.ok(recomputed.length >= 96, `${recomputed.length} rows - still enough to seat the room`);
  assert.equal(recomputed[0].adp, 1, 'and it is a real ranked board');
  // Same day, same corpus, so the recompute matches - the point is only that
  // the path exists and returns rows.
  assert.equal(recomputed.length, withFrozen.length);

  // And the room still LOADS, which is the thing that would actually break.
  const room = await d.getDraftForRoom(s.draftId, USER);
  assert.ok(room, 'the room reads');
  assert.ok(room.available.length > 0);
});

test('A ROOM WITH A NULL DEADLINE IS NOT EXPIRED, and gets its first one on its next turn', async () => {
  // EVERY in-progress room on PROD is in this state when 105 lands - 270 of
  // them, room 543 among them. The column is new and nothing backfilled it,
  // deliberately: a backfilled deadline would be a deadline nobody was ever
  // shown, and it would auto-pick turns while the reader was looking at them.
  const s = await d.startDraftFor(USER, TIMED.id, 6, { auto: false });
  await sql`UPDATE drafts SET turn_deadline_at = NULL WHERE id=${s.draftId}`;

  const before = await d.getDraftForRoom(s.draftId, USER);
  assert.equal(before.turnDeadlineAt, null, 'the room reports no deadline');
  assert.equal(before.isMyTurn, true);

  // A read an hour later must NOT sweep it. isExpired(null) is false, and this
  // is the assertion that keeps 270 live rooms from being auto-picked the
  // moment the migration lands.
  const later = await d.getDraftForRoom(s.draftId, USER, { now: new Date(Date.now() + 3600_000) });
  assert.equal(later.picks.length, before.picks.length, 'nothing was auto-picked');
  assert.equal(later.currentOverall, before.currentOverall, 'and it is on the same pick');

  // The first deadline arrives when the reader takes their turn - persistTurn
  // writes it for the turn AFTER this one.
  const pick = before.available[0];
  const res = await d.makePickFor(USER, s.draftId, pick.ffcPlayerId);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.turnDeadlineAt, 'the pick result carries the new deadline');
  const [row] = await sql`SELECT turn_deadline_at FROM drafts WHERE id=${s.draftId}`;
  assert.ok(row.turn_deadline_at, 'and it is on the row');
  assert.equal(new Date(row.turn_deadline_at).getTime(), res.turnDeadlineAt.getTime());
});
