// lib/daily/morningPush.test.mjs - the morning-after push (relay mon-12):
// 9:00 AM in the player's zone, never before the board closes, skipped when
// late, and once per player per board.
//
// The first half is PURE (the clock and the waves). The second runs on DEV
// against a sentinel board and sentinel players, with a spy in place of the
// real sender that writes the same ledger row the real one writes - so the
// second tick sees the first one's claim exactly as production would.
// DEV's daily_board_runs has no tz column until migration 129 is applied;
// the reader falls back to ET for every run, which is what this half proves.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureMark } from '../testing/fixtureMark.mjs';

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
})(path.join(REPO, '.env.local'));

const {
  morningDueAt, isMorningDue, planMorningWaves, morningEventId, zoneOf, localToUtc,
  morningPush, stampRunTz, MORNING_WINDOW_HOURS, FALLBACK_TZ,
} = await import('./morningPush.js');
const { copyFor, renderCopy, PUSH_COPY } = await import('../push/copy.js');

// Edition 2026-10-05 closes at midnight ET = 2026-10-06T04:00Z (EDT).
const CLOSE = '2026-10-06T04:00:00Z';
const iso = (d) => new Date(d).toISOString();

// ---------------------------------------------------------------------------
// the clock
// ---------------------------------------------------------------------------

test('9:00 AM in the player\'s own zone, the morning after the close', () => {
  assert.equal(iso(morningDueAt(CLOSE, 'America/New_York')), '2026-10-06T13:00:00.000Z', 'ET: 9:00 EDT');
  assert.equal(iso(morningDueAt(CLOSE, 'America/Los_Angeles')), '2026-10-06T16:00:00.000Z', 'LA: 9:00 PDT');
  assert.equal(iso(morningDueAt(CLOSE, 'Europe/London')), '2026-10-06T08:00:00.000Z', 'London: 9:00 BST');
});

test('never before the answer: east of ET the close is already morning, so the push waits a day', () => {
  // Tokyo: the close is 13:00 JST on the 6th - past 9:00 - so 9:00 JST on the 7th.
  assert.equal(iso(morningDueAt(CLOSE, 'Asia/Tokyo')), '2026-10-07T00:00:00.000Z');
  for (const tz of ['Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Honolulu']) {
    assert.ok(morningDueAt(CLOSE, tz).getTime() >= new Date(CLOSE).getTime(), tz);
  }
});

test('DST: the board that closes on the night the clocks go back is pushed at 9:00 EST', () => {
  // Edition 2026-10-31 closes at midnight EDT (04:00Z on Nov 1); the clocks
  // fall back at 2:00, so 9:00 that morning is EST, 14:00Z.
  assert.equal(iso(morningDueAt('2026-11-01T04:00:00Z', 'America/New_York')), '2026-11-01T14:00:00.000Z');
  // And spring forward: 9:00 EDT on 2027-03-14 is 13:00Z.
  assert.equal(iso(localToUtc('2027-03-14', 9, 'America/New_York')), '2027-03-14T13:00:00.000Z');
});

test('no zone, or a forged one, is the Daily\'s own zone (ET)', () => {
  assert.equal(zoneOf(null), FALLBACK_TZ);
  assert.equal(zoneOf('Not/AZone'), FALLBACK_TZ);
  assert.equal(zoneOf('"; DROP TABLE users; --'), FALLBACK_TZ);
  assert.equal(zoneOf('America/Chicago'), 'America/Chicago');
  assert.equal(iso(morningDueAt(CLOSE, null)), '2026-10-06T13:00:00.000Z');
});

test(`due from 9:00 for ${MORNING_WINDOW_HOURS} hours - not before, and a late tick skips rather than sends`, () => {
  const tz = 'America/New_York';
  assert.equal(isMorningDue('2026-10-06T12:59:59Z', CLOSE, tz), false, 'one second early');
  assert.equal(isMorningDue('2026-10-06T13:00:00Z', CLOSE, tz), true, 'on the dot');
  assert.equal(isMorningDue('2026-10-06T15:59:59Z', CLOSE, tz), true, 'inside the window');
  assert.equal(isMorningDue('2026-10-06T16:00:00Z', CLOSE, tz), false, 'noon: missed, not sent');
  assert.equal(isMorningDue('2026-10-06T04:30:00Z', CLOSE, tz), false, 'just after the close is not the morning');
});

// ---------------------------------------------------------------------------
// the waves - once per player per board
// ---------------------------------------------------------------------------

const ROWS = [
  { edition: '2026-10-05', closesAt: CLOSE, userId: 1, tz: null },
  { edition: '2026-10-05', closesAt: CLOSE, userId: 2, tz: 'America/New_York' },
  { edition: '2026-10-05', closesAt: CLOSE, userId: 3, tz: 'garbage' },
  { edition: '2026-10-05', closesAt: CLOSE, userId: 4, tz: 'America/Los_Angeles' },
  { edition: '2026-10-05', closesAt: CLOSE, userId: 5, tz: 'Asia/Tokyo' },
];

test('one wave per (board, zone); the unknown zones ride the ET wave', () => {
  const at9et = planMorningWaves(ROWS, '2026-10-06T13:05:00Z');
  assert.deepEqual(at9et.map((w) => w.eventId), [morningEventId('2026-10-05', 'America/New_York')]);
  assert.deepEqual(at9et[0].userIds, [1, 2, 3]);
  assert.equal(at9et[0].eventId, 'daily-morning:2026-10-05:America/New_York');

  const at9la = planMorningWaves(ROWS, '2026-10-06T16:00:00Z');
  assert.deepEqual(at9la.map((w) => w.userIds), [[4]], 'ET is past its window by LA\'s 9:00');
});

test('EVERY PLAYER IS DUE IN EXACTLY ONE WAVE: walk the whole two days in five-minute ticks', () => {
  const seen = new Map(); // userId -> Set of eventIds
  const start = new Date(CLOSE).getTime();
  for (let t = start; t < start + 48 * 3600_000; t += 5 * 60_000) {
    for (const w of planMorningWaves(ROWS, new Date(t).toISOString())) {
      for (const u of w.userIds) {
        if (!seen.has(u)) seen.set(u, new Set());
        seen.get(u).add(w.eventId);
      }
    }
  }
  assert.deepEqual([...seen.keys()].sort(), [1, 2, 3, 4, 5], 'everyone gets a morning');
  for (const [u, ids] of seen) assert.equal(ids.size, 1, `user ${u} sits in ${[...ids].join(', ')}`);
});

test('a player listed twice (the same run read twice) is one recipient', () => {
  const w = planMorningWaves([ROWS[0], ROWS[0]], '2026-10-06T13:00:00Z');
  assert.deepEqual(w[0].userIds, [1]);
});

test('the copy: the spec\'s line, the lock-screen cut, hyphens only, and the tap lands on that edition\'s results', () => {
  const c = copyFor('daily-morning:2026-10-05:America/New_York');
  assert.equal(c.body, "Yesterday's picks are out - see how you did.");
  assert.equal(c.url, '/daily/board/2026-10-05');
  assert.equal(c.urlFor, undefined);
  assert.ok(PUSH_COPY['daily-morning'].title.length <= 30);
  assert.ok(PUSH_COPY['daily-morning'].body.length <= 110);
  assert.doesNotThrow(() => renderCopy('daily-morning:2026-10-05:Asia/Tokyo', {}), 'no placeholders to miss');
});

test('the tick runs it last, fenced, with an injectable sender; the start stamps the zone', () => {
  const tick = readFileSync(path.join(REPO, 'lib/daily/seasonBoardTick.js'), 'utf8');
  assert.match(tick, /try \{\s*out\.morning = await morningPush\(sql, now, \{ notify: notifyPersonal \}\);\s*\} catch/);
  assert.ok(tick.indexOf('morningPush(sql') > tick.indexOf("`daily-revealed:${r.edition_date}`"), 'after the two board pushes');
  const start = readFileSync(path.join(REPO, 'app/api/daily/board/start/route.js'), 'utf8');
  assert.match(start, /await stampRunTz\(sql, \{ boardId: board\.id, userId: Number\(userId\), tz: await readViewerTz\(\) \}\)/);
});

// ---------------------------------------------------------------------------
// on DEV: the once-guard through the ledger
// ---------------------------------------------------------------------------

const { sql } = await import('../db.js');
const { ensureBoardForDate } = await import('./seasonBoardEditions.js');
const { startRun, submitRun } = await import('./seasonBoardRuns.js');

const MARK = fixtureMark('morningpush');
const EDITION = `2094-${String(1 + (process.pid % 12)).padStart(2, '0')}-${String(1 + (process.pid % 28)).padStart(2, '0')}`;
const ids = { board: null, users: [] };
let board = null;
const myEvent = () => morningEventId(EDITION, FALLBACK_TZ);

async function spyNotify(calls, eventId, recipients) {
  calls.push({ eventId, userIds: recipients.map((r) => r.userId) });
  await sql`
    INSERT INTO sync_runs (source, kind, started_at, ok, summary)
    SELECT 'push', 'event', now(), true, ${JSON.stringify({ eventId, outcome: 'sent', mock: true })}::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM sync_runs WHERE source = 'push' AND summary->>'eventId' = ${eventId})`;
  return { mocked: true };
}

before(async () => {
  for (const b of await sql`SELECT id FROM daily_boards WHERE edition_date = ${EDITION}`) {
    await sql`DELETE FROM daily_board_runs WHERE board_id = ${b.id}`;
    await sql`DELETE FROM daily_boards WHERE id = ${b.id}`;
  }
  await sql`DELETE FROM sync_runs WHERE source = 'push' AND summary->>'eventId' LIKE ${`daily-morning:${EDITION}:%`}`;
  board = await ensureBoardForDate(sql, EDITION);
  ids.board = board.id;
  for (const k of ['a', 'b', 'dnf']) {
    await sql`DELETE FROM users WHERE email = ${MARK.email(k)}`;
    ids.users.push((await sql`INSERT INTO users (email, handle) VALUES (${MARK.email(k)}, ${MARK.handle(k)}) RETURNING id`)[0].id);
  }
  const best = board.best_roster.map((b, slotIndex) => ({ slotIndex, teamKey: b.teamKey, playerName: b.name }));
  for (const uid of ids.users.slice(0, 2)) {
    assert.equal((await startRun(sql, { boardId: board.id, userId: uid })).ok, true);
    const r = await submitRun(sql, { boardId: board.id, userId: uid, picks: best, elapsedS: 60 });
    assert.equal(r.ok, true, r.reason ?? '');
  }
  // started, never submitted: not a player of the board, no push
  assert.equal((await startRun(sql, { boardId: board.id, userId: ids.users[2] })).ok, true);
});

after(async () => {
  await sql`DELETE FROM sync_runs WHERE source = 'push' AND summary->>'eventId' LIKE ${`daily-morning:${EDITION}:%`}`;
  await sql`DELETE FROM daily_board_runs WHERE board_id = ${ids.board}`;
  await sql`DELETE FROM daily_boards WHERE id = ${ids.board}`;
  await sql`DELETE FROM users WHERE id = ANY(${ids.users})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM daily_boards WHERE id = ${ids.board})
         + (SELECT count(*)::int FROM users WHERE id = ANY(${ids.users}))
         + (SELECT count(*)::int FROM sync_runs WHERE source = 'push' AND summary->>'eventId' LIKE ${`daily-morning:${EDITION}:%`}) AS n`;
  assert.equal(left.n, 0, 'the sentinels and their ledger rows are gone');
});

test('DEV: nothing before 9:00 ET; one call at 9:00 for the two finishers; no second call on the next ticks', async () => {
  const close = new Date(board.closes_at).getTime();
  const nineEt = morningDueAt(board.closes_at, FALLBACK_TZ).getTime();
  assert.ok(nineEt > close);
  const calls = [];
  const notify = (eventId, recipients) => spyNotify(calls, eventId, recipients);
  const mine = () => calls.filter((c) => c.eventId === myEvent());

  await morningPush(sql, new Date(close + 60_000), { notify });
  await morningPush(sql, new Date(nineEt - 60_000), { notify });
  assert.equal(mine().length, 0, 'the close and the small hours send nothing');

  const r = await morningPush(sql, new Date(nineEt), { notify });
  assert.equal(mine().length, 1, 'one wave at 9:00');
  assert.deepEqual([...mine()[0].userIds].sort((a, b) => a - b), ids.users.slice(0, 2).sort((a, b) => a - b),
    'the two finishers - never the run that never submitted');
  assert.ok(r.some((x) => x.eventId === myEvent() && x.recipients === 2));

  for (const dt of [5, 10, 60, 170].map((m) => m * 60_000)) await morningPush(sql, new Date(nineEt + dt), { notify });
  assert.equal(mine().length, 1, 'the ledger row stops every later tick from calling again');
});

test('DEV: stampRunTz is best-effort - a forged zone is refused, and a missing column never throws', async () => {
  assert.equal(await stampRunTz(sql, { boardId: ids.board, userId: ids.users[0], tz: 'not a zone' }), false);
  const r = await stampRunTz(sql, { boardId: ids.board, userId: ids.users[0], tz: 'America/Chicago' });
  const [{ has }] = await sql`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'daily_board_runs' AND column_name = 'tz') AS has`;
  assert.equal(r, has === true, has ? 'stamped once 129 is applied' : 'pre-129: false, no throw');
});
