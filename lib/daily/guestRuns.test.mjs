// lib/daily/guestRuns.test.mjs - a signed-out play of the Daily (Option A).
//
// WHAT IS PINNED: the claim (moves a finished guest run onto the account, in
// one statement), its expiry (midnight PT after the edition's ET date),
// double-claim (one winner, even concurrent), the board exclusion (an
// unclaimed run is on no board and in no "beat N%"), one play per device, the
// per-IP cap on start, the signed token/cookie, and a walk of the tree proving
// only guestRuns.js ever names the guest table.
//
// HERMETIC: its own board on a 2097 edition date, its own sentinel users and
// device ids, all torn down. Time is injected (`now`), never waited for.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureMark } from '../testing/fixtureMark.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
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
if (!process.env.DAILY_GUEST_SECRET) process.env.DAILY_GUEST_SECRET = 'guest-test-secret-not-a-real-one-0123456789';

const { sql } = await import('../db.js');
const G = await import('./guestRuns.js');
const { solveBoard } = await import('./assignmentSolver.js');
const { todayLeaderboard } = await import('./seasonBoardLeaderboards.js');
const { openRevealFor } = await import('./openReveal.js');
const { startRun, submitRun } = await import('./seasonBoardRuns.js');
const { streakLeaderboard } = await import('./seasonBoardLeaderboards.js');
const { streakEndingAt } = await import('./shareCardData.js');
const { dailyV2Home } = await import('./seasonBoardHome.js');

const MARK = fixtureMark('guestrun');
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'];
const TEAMS = [
  { key: 'T1', abbr: 'T1', card: [{ position: 'QB', name: 'Guest QB', points: 30, meta: '' }] },
  { key: 'T2', abbr: 'T2', card: [{ position: 'RB', name: 'Guest RB1', points: 25, meta: '' }] },
  { key: 'T3', abbr: 'T3', card: [{ position: 'RB', name: 'Guest RB2', points: 20, meta: '' }] },
  { key: 'T4', abbr: 'T4', card: [{ position: 'WR', name: 'Guest WR1', points: 18, meta: '' }] },
  { key: 'T5', abbr: 'T5', card: [{ position: 'WR', name: 'Guest WR2', points: 17, meta: '' }] },
  { key: 'T6', abbr: 'T6', card: [{ position: 'TE', name: 'Guest TE', points: 15, meta: '' }] },
  { key: 'T7', abbr: 'T7', card: [{ position: 'RB', name: 'Guest RB3', points: 12, meta: '' }] },
  { key: 'T8', abbr: 'T8', card: [{ position: 'PK', name: 'Guest K', points: 10, meta: '' }] },
];
const PICKS = TEAMS.map((t, slotIndex) => ({ slotIndex, teamKey: t.key, playerName: t.card[0].name }));
// A WEAKER FULL ROSTER: the same eight players is the only legal full set on
// this board, so the second finisher in the beat-% test drops one slot instead.
const PICKS_SHORT = PICKS.map((p, i) => (i === 7 ? { slotIndex: 7, teamKey: null, playerName: null } : p));

const EDITION2 = '2097-05-04';
const OPENS2 = '2097-05-04T04:00:00Z';
const CLOSES2 = '2097-05-05T04:00:00Z';
const EDITION = '2097-05-05';
const OPENS = '2097-05-05T04:00:00Z';
const CLOSES = '2097-05-06T04:00:00Z';       // ET midnight
const MID_DAY = '2097-05-05T20:00:00Z';
const AFTER_CLOSE_BEFORE_PT = '2097-05-06T05:00:00Z'; // closed (04:00Z) but PT is still 22:00 on the 5th
const PT_MIDNIGHT = '2097-05-06T07:00:00Z';  // PDT = UTC-7
const AFTER_EXPIRY = '2097-05-06T07:00:01Z';
const at = (base, s) => new Date(new Date(base).getTime() + s * 1000).toISOString();

let boardId = null;
let board2Id = null;   // the PREVIOUS edition (2097-05-04), closed at 2097-05-05T04:00Z
const users = [];
const devices = [];
const dev = (tag) => { const d = `${MARK.run}-${tag}`; devices.push(d); return d; };
async function user(tag) {
  const id = (await sql`INSERT INTO users (email, handle) VALUES (${MARK.email(tag)}, ${MARK.handle(tag)}) RETURNING id`)[0].id;
  users.push(id); return id;
}
// A finished guest run on this device, started at OPENS and locked at +60s.
async function finishedGuest(deviceId, { picks = PICKS, ip = null, board = null, opens = OPENS } = {}) {
  const bid = board ?? boardId;
  const s = await G.startGuestRun(sql, { boardId: bid, deviceId, ip, now: opens });
  assert.equal(s.ok, true, s.reason);
  const r = await G.submitGuestRun(sql, { runId: s.run.id, boardId: bid, deviceId, picks, now: at(opens, 60) });
  assert.equal(r.ok, true, r.reason);
  return { run: r.run, startRunId: s.run.id };
}

before(async () => {
  const stale = await sql`SELECT id FROM daily_boards WHERE edition_date IN (${EDITION}, ${EDITION2})`;
  for (const b of stale) {
    await sql`DELETE FROM daily_guest_runs WHERE board_id = ${b.id}`;
    await sql`DELETE FROM daily_board_runs WHERE board_id = ${b.id}`;
    await sql`DELETE FROM daily_boards WHERE id = ${b.id}`;
  }
  const opt = solveBoard(TEAMS, SLOTS);
  boardId = (await sql`
    INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, slots, opens_at, closes_at)
    VALUES (${EDITION}, 2097, 'guest-seed', ${JSON.stringify(TEAMS)}::jsonb, ${opt.total},
            ${JSON.stringify(opt.bySlot)}::jsonb, ${JSON.stringify(SLOTS)}::jsonb,
            ${OPENS}::timestamptz, ${CLOSES}::timestamptz)
    RETURNING id`)[0].id;
  board2Id = (await sql`
    INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, slots, opens_at, closes_at)
    VALUES (${EDITION2}, 2097, 'guest-seed-2', ${JSON.stringify(TEAMS)}::jsonb, ${opt.total},
            ${JSON.stringify(opt.bySlot)}::jsonb, ${JSON.stringify(SLOTS)}::jsonb,
            ${OPENS2}::timestamptz, ${CLOSES2}::timestamptz)
    RETURNING id`)[0].id;
});

after(async () => {
  for (const id of [boardId, board2Id]) {
    if (!id) continue;
    await sql`DELETE FROM daily_guest_runs WHERE board_id = ${id}`;
    await sql`DELETE FROM daily_board_runs WHERE board_id = ${id}`;
    await sql`DELETE FROM daily_boards WHERE id = ${id}`;
  }
  for (const id of users) await sql`DELETE FROM users WHERE id = ${id}`;
  const left = await sql`SELECT count(*)::int n FROM daily_guest_runs WHERE board_id IN (${boardId}, ${board2Id})`;
  assert.equal(left[0].n, 0, 'teardown left guest rows');
});

// ---- the signed pieces ------------------------------------------------------

test('the device cookie and the start token verify, and a forged or swapped one does not', () => {
  const id = G.newDeviceId();
  assert.equal(G.verifyDevice(G.signDevice(id)), id);
  assert.equal(G.verifyDevice(`${id}.forged`), null);
  assert.equal(G.verifyDevice(`${G.newDeviceId()}.${G.signDevice(id).split('.').pop()}`), null, 'a mac does not move to another id');
  assert.equal(G.verifyDevice(undefined), null);

  const t = G.signStartToken({ runId: 7, boardId: 3, deviceId: id });
  assert.deepEqual(G.verifyStartToken(t), { runId: 7, boardId: 3, deviceId: id });
  const [body, mac] = t.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ r: 8, b: 3, d: id })).toString('base64url');
  assert.equal(G.verifyStartToken(`${forgedBody}.${mac}`), null, 'a changed body fails its mac');
  assert.equal(G.verifyStartToken(`${body}.x`), null);
  assert.equal(G.verifyStartToken(null), null);
});

// ---- start ------------------------------------------------------------------

test('start writes a guest row, and a reload resumes the SAME clock', async () => {
  const d = dev('start');
  const a = await G.startGuestRun(sql, { boardId, deviceId: d, now: OPENS });
  assert.equal(a.ok, true); assert.equal(a.resumed, false); assert.equal(a.submitted, false);
  const b = await G.startGuestRun(sql, { boardId, deviceId: d, now: at(OPENS, 3600) });
  assert.equal(b.resumed, true);
  assert.equal(new Date(b.run.started_at).toISOString(), new Date(a.run.started_at).toISOString(), 'the first start\'s instant');
  const n = await sql`SELECT count(*)::int n FROM daily_guest_runs WHERE board_id = ${boardId} AND device_id = ${d}`;
  assert.equal(n[0].n, 1, 'one play per device per board');
});

test('start is refused on a closed board', async () => {
  const r = await G.startGuestRun(sql, { boardId, deviceId: dev('closed'), now: CLOSES });
  assert.equal(r.ok, false); assert.equal(r.reason, 'board closed'); assert.equal(r.status, 409);
});

test('start is capped per IP: new plays count, a resume does not, another IP is unaffected', async () => {
  const ip = `203.0.113.${(Number(MARK.run.replace(/\D/g, '').slice(-3)) % 200) + 1}`;
  const first = dev('ip0');
  for (let i = 0; i < G.GUEST_START_PER_IP.max; i += 1) {
    const r = await G.startGuestRun(sql, { boardId, deviceId: i === 0 ? first : dev(`ip${i}`), ip, now: OPENS });
    assert.equal(r.ok, true, `start ${i + 1} of ${G.GUEST_START_PER_IP.max}`);
  }
  const over = await G.startGuestRun(sql, { boardId, deviceId: dev('ipover'), ip, now: OPENS });
  assert.equal(over.ok, false); assert.equal(over.status, 429); assert.equal(over.reason, 'rate limited');
  const resume = await G.startGuestRun(sql, { boardId, deviceId: first, ip, now: OPENS });
  assert.equal(resume.ok, true, 'a reload spends nothing');
  const other = await G.startGuestRun(sql, { boardId, deviceId: dev('ipother'), ip: '198.51.100.7', now: OPENS });
  assert.equal(other.ok, true, 'a different IP has its own budget');
  const later = await G.startGuestRun(sql, { boardId, deviceId: dev('iplater'), ip, now: at(OPENS, 3601) });
  assert.equal(later.ok, true, 'the window rolls');
});

// ---- submit -----------------------------------------------------------------

test('submit is graded server-side and refuses what submitRun refuses', async () => {
  const d = dev('submit');
  const none = await G.submitGuestRun(sql, { runId: 1, boardId, deviceId: d, picks: PICKS, now: MID_DAY });
  assert.equal(none.reason, 'never started');

  const s = await G.startGuestRun(sql, { boardId, deviceId: d, now: OPENS });
  const wrongDevice = await G.submitGuestRun(sql, { runId: s.run.id, boardId, deviceId: dev('thief'), picks: PICKS, now: at(OPENS, 30) });
  assert.equal(wrongDevice.reason, 'never started', 'another device cannot submit this run');

  const late = await G.submitGuestRun(sql, { runId: s.run.id, boardId, deviceId: d, picks: PICKS, now: at(OPENS, 186) });
  assert.equal(late.reason, 'time expired');
  const closed = await G.submitGuestRun(sql, { runId: s.run.id, boardId, deviceId: d, picks: PICKS, now: CLOSES });
  assert.equal(closed.reason, 'board closed');
  const bad = await G.submitGuestRun(sql, { runId: s.run.id, boardId, deviceId: d, picks: [{ slotIndex: 0, teamKey: 'GHOST', playerName: 'x' }], now: at(OPENS, 30) });
  assert.equal(bad.ok, false); assert.equal(bad.status, 400);
  const [still] = await sql`SELECT picks FROM daily_guest_runs WHERE id = ${s.run.id}`;
  assert.equal(still.picks, null, 'every refusal left the row a DNF');

  const ok = await G.submitGuestRun(sql, { runId: s.run.id, boardId, deviceId: d, picks: PICKS, now: at(OPENS, 60) });
  assert.equal(ok.ok, true);
  assert.equal(Number(ok.run.score), 147, 'the server graded it from the frozen board');
  const twice = await G.submitGuestRun(sql, { runId: s.run.id, boardId, deviceId: d, picks: PICKS, now: at(OPENS, 61) });
  assert.equal(twice.reason, 'already ran this board', 'settled is final');
});

// ---- the board exclusion ----------------------------------------------------

test('BOARD EXCLUSION: an unclaimed guest run is on no board and in no "beat N%"', async () => {
  const real = await user('real');
  await startRun(sql, { boardId, userId: real, now: OPENS });
  const done = await submitRun(sql, { boardId, userId: real, picks: PICKS_SHORT, slots: SLOTS, now: at(OPENS, 90) });
  assert.equal(done.ok, true, done.reason);

  const before = await todayLeaderboard(sql, boardId);
  assert.equal(before.length, 1);
  const realRun = (await sql`SELECT * FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${real}`)[0];
  const [board] = await sql`SELECT * FROM daily_boards WHERE id = ${boardId}`;
  const revealBefore = await openRevealFor(sql, { board, run: realRun, userId: real, editionDate: EDITION });

  const d = dev('excl');
  const { run } = await finishedGuest(d);          // 147 > the real runner's 137
  assert.ok(Number(run.score) > Number(realRun.score));

  const after = await todayLeaderboard(sql, boardId);
  assert.deepEqual(after.map((r) => r.userId), before.map((r) => r.userId), 'the board is unchanged');
  const revealAfter = await openRevealFor(sql, { board, run: realRun, userId: real, editionDate: EDITION });
  assert.equal(revealAfter.of, revealBefore.of, 'the field size is unchanged');
  assert.equal(revealAfter.beatPct, revealBefore.beatPct, 'the real player\'s beat-% is unchanged');
  assert.equal(revealAfter.rank, 1, 'and the real player is still first');

  // The guest sees their own beat-% against the real field, with no rank.
  const mine = await G.guestRevealFor(sql, { board, run });
  assert.equal(mine.rank, null); assert.equal(mine.board.me, null);
  assert.equal(mine.beatPct, 100);
  assert.equal(mine.of, 1);
  assert.equal(mine.total, 147);
  assert.ok(mine.guest.claimExpiresAt);
});

test('ONLY guestRuns.js names the guest table - no other reader can leak it', () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.next', '.git', 'test-tmp', 'ios'].includes(name)) continue;
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(js|mjs|jsx|ts|tsx)$/.test(name) && readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').includes('daily_guest_runs')) hits.push(path.relative(REPO, p));
    }
  };
  for (const d of ['app', 'lib', 'components', 'scripts', 'services']) walk(path.join(REPO, d));
  // scripts/crew-reader-grants.mjs names it only to WITHHOLD it from the crew's read-only role.
  assert.deepEqual(hits.sort(), ['lib/daily/guestRuns.js', 'lib/daily/guestRuns.test.mjs', 'scripts/crew-reader-grants.mjs']);
});

// ---- the claim --------------------------------------------------------------

test('CLAIM moves a finished guest run onto the account, and only then is it on the board', async () => {
  const d = dev('claim'); const u = await user('claimer');
  const { run } = await finishedGuest(d);
  assert.equal((await sql`SELECT 1 FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${u}`).length, 0);

  const c = await G.claimGuestRuns(sql, { deviceId: d, userId: u, now: MID_DAY });
  assert.equal(c.ok, true);
  assert.deepEqual(c.claimed, [{ boardId, score: Number(run.score), late: false }]);

  const [mine] = await sql`SELECT * FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${u}`;
  assert.equal(Number(mine.score), Number(run.score));
  assert.deepEqual(mine.picks, PICKS);
  assert.equal(new Date(mine.completed_at).toISOString(), new Date(run.completed_at).toISOString(), 'finish time travels, so ties order honestly');
  const [g] = await sql`SELECT claimed_by, claimed_at FROM daily_guest_runs WHERE id = ${run.id}`;
  assert.equal(g.claimed_by, u); assert.ok(g.claimed_at);
  const field = await todayLeaderboard(sql, boardId);
  assert.ok(field.some((r) => Number(r.userId) === u), 'now it is on the board');
});

test('DOUBLE-CLAIM: the same account again, and a second account, get nothing', async () => {
  const d = dev('dbl'); const a = await user('dbla'); const b = await user('dblb');
  await finishedGuest(d);
  assert.equal((await G.claimGuestRuns(sql, { deviceId: d, userId: a, now: MID_DAY })).ok, true);
  const again = await G.claimGuestRuns(sql, { deviceId: d, userId: a, now: MID_DAY });
  assert.equal(again.ok, false); assert.equal(again.reason, 'already claimed');
  const other = await G.claimGuestRuns(sql, { deviceId: d, userId: b, now: MID_DAY });
  assert.equal(other.ok, false); assert.equal(other.reason, 'already claimed');
  assert.equal((await sql`SELECT 1 FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${b}`).length, 0);
  const n = await sql`SELECT count(*)::int n FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${a}`;
  assert.equal(n[0].n, 1, 'one run for the account, not two');
});

test('DOUBLE-CLAIM, CONCURRENT: two accounts racing - exactly one wins', async () => {
  const d = dev('race'); const a = await user('racea'); const b = await user('raceb');
  await finishedGuest(d);
  const [ra, rb] = await Promise.all([
    G.claimGuestRuns(sql, { deviceId: d, userId: a, now: MID_DAY }),
    G.claimGuestRuns(sql, { deviceId: d, userId: b, now: MID_DAY }),
  ]);
  assert.equal([ra, rb].filter((r) => r.ok).length, 1, 'one winner');
  const rows = await sql`SELECT user_id FROM daily_board_runs WHERE board_id = ${boardId} AND user_id IN (${a}, ${b})`;
  assert.equal(rows.length, 1, 'and only one account got the run');
});

test('EXPIRY: a claim works until midnight PT after the ET date - past the ET close, not past PT midnight', async () => {
  const d1 = dev('exp1'); const u1 = await user('exp1');
  const { run } = await finishedGuest(d1);
  assert.equal(new Date(run.claim_expires_at).toISOString(), new Date(PT_MIDNIGHT).toISOString(), 'expiry = 00:00 PT after the edition date');

  const late = await G.claimGuestRuns(sql, { deviceId: d1, userId: u1, now: AFTER_CLOSE_BEFORE_PT });
  assert.equal(late.ok, true, 'ET midnight has passed but PT midnight has not');

  const d2 = dev('exp2'); const u2 = await user('exp2');
  await finishedGuest(d2);
  const justBefore = await G.claimGuestRuns(sql, { deviceId: d2, userId: u2, now: at(PT_MIDNIGHT, -1) });
  assert.equal(justBefore.ok, true, 'one second before expiry still claims');

  const d3 = dev('exp3'); const u3 = await user('exp3');
  await finishedGuest(d3);
  const gone = await G.claimGuestRuns(sql, { deviceId: d3, userId: u3, now: AFTER_EXPIRY });
  assert.equal(gone.ok, false); assert.equal(gone.reason, 'expired');
  assert.equal((await sql`SELECT 1 FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${u3}`).length, 0, 'an expired run never reaches the board');
  const [g] = await sql`SELECT claimed_by FROM daily_guest_runs WHERE board_id = ${boardId} AND device_id = ${d3}`;
  assert.equal(g.claimed_by, null);
  const exact = await G.claimGuestRuns(sql, { deviceId: d3, userId: u3, now: PT_MIDNIGHT });
  assert.equal(exact.ok, false, 'at the instant, it is over');
});

test('an unfinished (DNF) guest run is not claimable', async () => {
  const d = dev('dnf'); const u = await user('dnf');
  await G.startGuestRun(sql, { boardId, deviceId: d, now: OPENS });
  const c = await G.claimGuestRuns(sql, { deviceId: d, userId: u, now: MID_DAY });
  assert.equal(c.ok, false);
  assert.equal((await sql`SELECT 1 FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${u}`).length, 0);
});

test('an account that already played the board cannot claim over it, and its run is untouched', async () => {
  const d = dev('had'); const u = await user('had');
  await startRun(sql, { boardId, userId: u, now: OPENS });
  const own = await submitRun(sql, { boardId, userId: u, picks: PICKS_SHORT, slots: SLOTS, now: at(OPENS, 90) });
  assert.equal(own.ok, true, own.reason);
  await finishedGuest(d);
  const c = await G.claimGuestRuns(sql, { deviceId: d, userId: u, now: MID_DAY });
  assert.equal(c.ok, false); assert.equal(c.reason, 'account already played');
  const [mine] = await sql`SELECT score FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${u}`;
  assert.equal(Number(mine.score), 137, 'the account\'s own score stands');
  const [g] = await sql`SELECT claimed_by FROM daily_guest_runs WHERE board_id = ${boardId} AND device_id = ${d}`;
  assert.equal(g.claimed_by, null, 'the guest run stays unclaimed');
});

// ---- no second attempt by signing in ---------------------------------------

test('a device that already used its guest play cannot start a signed-in run (no second attempt)', async () => {
  const d = dev('block'); const u = await user('block');
  await G.startGuestRun(sql, { boardId, deviceId: d, now: OPENS });          // opened, never finished
  const r = await G.guestBlocksStart(sql, { boardId, deviceId: d, userId: u, now: MID_DAY });
  assert.equal(r?.blocked, true);
  assert.equal(await G.guestBlocksStart(sql, { boardId, deviceId: dev('fresh'), userId: u, now: MID_DAY }), null, 'a fresh device is not blocked');
  assert.equal(await G.guestBlocksStart(sql, { boardId, deviceId: null, userId: u }), null);
});

test('a finished guest run is claimed by the signed-in start backstop instead of blocking', async () => {
  const d = dev('blockfin'); const u = await user('blockfin');
  await finishedGuest(d);
  const r = await G.guestBlocksStart(sql, { boardId, deviceId: d, userId: u, now: MID_DAY });
  assert.equal(r?.claimed, true);
  assert.equal((await sql`SELECT 1 FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${u}`).length, 1);
});

// ---- tue-3 rulings: late claims, and one claim per day ----------------------

test('LATE CLAIM: after the ET close the run is saved to the account and its streak, and is on NO board and in NO count', async () => {
  const real = await user('latereal');
  await startRun(sql, { boardId, userId: real, now: OPENS });
  const done = await submitRun(sql, { boardId, userId: real, picks: PICKS_SHORT, slots: SLOTS, now: at(OPENS, 90) });
  assert.equal(done.ok, true, done.reason);
  const [board] = await sql`SELECT * FROM daily_boards WHERE id = ${boardId}`;
  const realRun = (await sql`SELECT * FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${real}`)[0];
  const fieldBefore = await todayLeaderboard(sql, boardId);
  const homeBefore = await dailyV2Home(null, { editionDate: EDITION });
  const revealBefore = await openRevealFor(sql, { board, run: realRun, userId: real, editionDate: EDITION });

  const d = dev('late'); const u = await user('late');
  const { run } = await finishedGuest(d);                       // 147, beats the real 137
  const c = await G.claimGuestRuns(sql, { deviceId: d, userId: u, now: AFTER_CLOSE_BEFORE_PT });
  assert.equal(c.ok, true, 'the claim is accepted');
  assert.deepEqual(c.claimed, [{ boardId, score: Number(run.score), late: true }]);

  // On the account: the entry is stored whole, flagged late.
  const [mine] = await sql`SELECT * FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${u}`;
  assert.equal(mine.late_claim, true);
  assert.equal(Number(mine.score), Number(run.score));
  assert.deepEqual(mine.picks, PICKS);
  // ...and in the streak - both streak readers.
  assert.equal(await streakEndingAt(sql, u, EDITION), 1, 'it counts toward the account\'s streak');
  const streaks = await streakLeaderboard(sql, EDITION);
  assert.ok(streaks.some((r) => Number(r.userId) === u), 'and the streak board lists the account');

  // Not on the closed board or its counts.
  const fieldAfter = await todayLeaderboard(sql, boardId);
  assert.deepEqual(fieldAfter.map((r) => r.userId), fieldBefore.map((r) => r.userId), 'the closed board\'s field is unchanged');
  assert.ok(!fieldAfter.some((r) => Number(r.userId) === u));
  const homeAfter = await dailyV2Home(null, { editionDate: EDITION });
  assert.equal(homeAfter.playingToday, homeBefore.playingToday, 'the played count is unchanged');
  const revealAfter = await openRevealFor(sql, { board, run: realRun, userId: real, editionDate: EDITION });
  assert.equal(revealAfter.of, revealBefore.of); assert.equal(revealAfter.beatPct, revealBefore.beatPct); assert.equal(revealAfter.rank, revealBefore.rank, 'the real player\'s rank does not move');
});

test('a claim BEFORE the close is an ordinary board entry (not late)', async () => {
  const d = dev('ontime'); const u = await user('ontime');
  await finishedGuest(d);
  const c = await G.claimGuestRuns(sql, { deviceId: d, userId: u, now: MID_DAY });
  assert.equal(c.ok, true); assert.equal(c.claimed[0].late, false);
  const [mine] = await sql`SELECT late_claim FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${u}`;
  assert.equal(mine.late_claim, false);
  assert.ok((await todayLeaderboard(sql, boardId)).some((r) => Number(r.userId) === u));
});

test('ONE CLAIM PER ACCOUNT PER DAY: a second claim is refused, from any device, and the run stays unclaimed', async () => {
  const dx = dev('dayx'); const dy = dev('dayy'); const u = await user('dayuser');
  await finishedGuest(dy, { board: board2Id, opens: OPENS2 });   // yesterday's edition, claim still open until 05-05T07:00Z
  await finishedGuest(dx);                                       // today's
  const first = await G.claimGuestRuns(sql, { deviceId: dy, userId: u, now: at(CLOSES2, 60) });
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.claimed[0].boardId, board2Id);

  const second = await G.claimGuestRuns(sql, { deviceId: dx, userId: u, now: at(CLOSES2, 120) });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'one claim per day');
  assert.equal((await sql`SELECT 1 FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${u}`).length, 0, 'nothing was added');
  const [g] = await sql`SELECT claimed_by FROM daily_guest_runs WHERE board_id = ${boardId} AND device_id = ${dx}`;
  assert.equal(g.claimed_by, null, 'the refused guest run is untouched');

  // The same ET day, the same device, a second attempt: still refused.
  const again = await G.claimGuestRuns(sql, { deviceId: dy, userId: u, now: at(CLOSES2, 180) });
  assert.equal(again.ok, false);

  // The next ET day it is allowed again (the run is still inside its PT expiry; it is a late claim).
  const next = await G.claimGuestRuns(sql, { deviceId: dx, userId: u, now: at(CLOSES, 60) });
  assert.equal(next.ok, true, next.reason);
  assert.equal(next.claimed[0].late, true);
});

test('ONE CLAIM PER DAY picks the newest edition when a device holds two', async () => {
  const d = dev('two'); const u = await user('two');
  await finishedGuest(d, { board: board2Id, opens: OPENS2 });
  await finishedGuest(d);
  const c = await G.claimGuestRuns(sql, { deviceId: d, userId: u, now: at(CLOSES2, 60) });
  assert.equal(c.ok, true);
  assert.deepEqual(c.claimed.map((x) => x.boardId), [boardId], 'only today\'s edition, once');
  assert.equal((await sql`SELECT 1 FROM daily_board_runs WHERE user_id = ${u}`).length, 1);
});

test('ONE CLAIM PER DAY, CONCURRENT: one account claiming from two devices at once - exactly one wins', async () => {
  const dx = dev('racex'); const dy = dev('racey'); const u = await user('racer');
  await finishedGuest(dx);
  await finishedGuest(dy, { board: board2Id, opens: OPENS2 });
  const t = at(CLOSES2, 60);
  const [rx, ry] = await Promise.all([
    G.claimGuestRuns(sql, { deviceId: dx, userId: u, now: t }),
    G.claimGuestRuns(sql, { deviceId: dy, userId: u, now: t }),
  ]);
  assert.equal([rx, ry].filter((r) => r.ok).length, 1, 'one winner');
  assert.equal([rx, ry].find((r) => !r.ok).reason, 'one claim per day');
  const n = await sql`SELECT count(*)::int n FROM daily_board_runs WHERE user_id = ${u}`;
  assert.equal(n[0].n, 1, 'and the account got one run');
});

// ---- the guard: every reader of daily_board_runs has been classified -------

// A board-scoped read (one board's field, rank, beat-%, count, top score, a
// league day, a push) must skip late_claim runs. An account-scoped read (a
// player's own run, history, streak, aggregate) must not. Both lists are
// reviewed by hand; a NEW file that names the table is neither, and fails here
// until somebody decides which it is.
const BOARD_SCOPED = [
  'lib/daily/morningPush.js', 'lib/daily/seasonBoardHome.js', 'lib/daily/seasonBoardLeaderboards.js',
  'lib/games/read.js', 'lib/leagues/results.js',
];
const ACCOUNT_SCOPED = [
  'app/api/daily/board/run/route.js', 'app/daily/board/[date]/page.js', 'app/daily/board/page.js',
  'lib/daily/guestRuns.js', 'lib/daily/guestRuns.test.mjs', 'lib/daily/seasonBoardRuns.js', 'lib/daily/shareCardData.js',
  'lib/games/lobbyV2.js', 'lib/games/lobbyV3.js', 'lib/games/rank.js', 'lib/results/daily.js', 'lib/you/reads.js',
  'scripts/daily-board-run-sentinel.mjs',
];

test('every reader of daily_board_runs is classified, and every board-scoped one skips late_claim', () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.next', '.git', 'test-tmp', 'ios'].includes(name)) continue;
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(js|mjs|jsx|ts|tsx)$/.test(name)) {
        const code = strip(readFileSync(p, 'utf8'));
        if (code.includes('daily_board_runs')) hits.push({ file: path.relative(REPO, p), code });
      }
    }
  };
  for (const d of ['app', 'lib', 'components', 'scripts', 'services']) walk(path.join(REPO, d));
  // Other tests that merely seed the table are out of scope.
  const live = hits.filter((h) => !/\.test\.mjs$/.test(h.file) || h.file === 'lib/daily/guestRuns.test.mjs');
  const known = new Set([...BOARD_SCOPED, ...ACCOUNT_SCOPED]);
  assert.deepEqual(live.filter((h) => !known.has(h.file)).map((h) => h.file), [], 'unclassified reader of daily_board_runs: decide board- or account-scoped (see this test)');
  for (const f of BOARD_SCOPED) {
    const h = live.find((x) => x.file === f);
    assert.ok(h, `${f} no longer names daily_board_runs - drop it from BOARD_SCOPED`);
    assert.ok(h.code.includes('late_claim'), `${f} is board-scoped and must filter NOT late_claim`);
  }
});

// ---- tue-4 hard rule: nothing is gradeable that finished after the close ----

test('HARD RULE: a guest cannot START or FINISH after the close, and a run that straddles it is not graded', async () => {
  // Start: refused at and after the close.
  const dLate = dev('afterstart');
  const atClose = await G.startGuestRun(sql, { boardId, deviceId: dLate, now: CLOSES });
  assert.equal(atClose.ok, false); assert.equal(atClose.status, 409);
  const afterReveal = await G.startGuestRun(sql, { boardId, deviceId: dLate, now: at(CLOSES, 3600) });
  assert.equal(afterReveal.ok, false);
  assert.equal((await sql`SELECT 1 FROM daily_guest_runs WHERE board_id = ${boardId} AND device_id = ${dLate}`).length, 0, 'no row was created');

  // Finish: started a minute before the close, submits after it - refused, stays ungraded, unclaimable.
  const dx = dev('straddle'); const u = await user('straddle');
  const s = await G.startGuestRun(sql, { boardId, deviceId: dx, now: at(CLOSES, -60) });
  assert.equal(s.ok, true, s.reason);
  const sub = await G.submitGuestRun(sql, { runId: s.run.id, boardId, deviceId: dx, picks: PICKS, now: at(CLOSES, 5) });
  assert.equal(sub.ok, false); assert.equal(sub.reason, 'board closed');
  const [row] = await sql`SELECT picks, score FROM daily_guest_runs WHERE id = ${s.run.id}`;
  assert.equal(row.picks, null); assert.equal(row.score, null, 'never graded');
  const c = await G.claimGuestRuns(sql, { deviceId: dx, userId: u, now: at(CLOSES, 60) });
  assert.equal(c.ok, false);
  assert.equal((await sql`SELECT 1 FROM daily_board_runs WHERE user_id = ${u}`).length, 0);
});

test('HARD RULE at the write: the UPDATE itself refuses a finish at or after the close, and a claim refuses a run stamped after it', async () => {
  // The submit's early check is bypassed by passing a clock before the close for
  // the check but we cannot split one call's clock, so prove the UPDATE guard
  // directly: a forged post-close completed_at is never claimable.
  const d = dev('forged'); const u = await user('forged');
  const s = await G.startGuestRun(sql, { boardId, deviceId: d, now: OPENS });
  assert.equal(s.ok, true);
  await sql`UPDATE daily_guest_runs SET picks = ${JSON.stringify(PICKS)}::jsonb, score = 147, pct = 1, matched = 8, elapsed_s = 60,
                   completed_at = ${CLOSES}::timestamptz WHERE id = ${s.run.id}`;
  const c = await G.claimGuestRuns(sql, { deviceId: d, userId: u, now: at(CLOSES, 60) });
  assert.equal(c.ok, false, 'finished AT the close is not before it');
  assert.equal((await sql`SELECT 1 FROM daily_board_runs WHERE user_id = ${u}`).length, 0);
  await sql`UPDATE daily_guest_runs SET completed_at = ${at(CLOSES, -1)}::timestamptz WHERE id = ${s.run.id}`;
  const ok = await G.claimGuestRuns(sql, { deviceId: d, userId: u, now: at(CLOSES, 60) });
  assert.equal(ok.ok, true, 'one second before the close is fine (and late-flagged)');
  assert.equal(ok.claimed[0].late, true);
});

test('the guest submit UPDATE carries the close guard (source pin)', () => {
  const src = readFileSync(path.join(REPO, 'lib/daily/guestRuns.js'), 'utf8');
  assert.match(src, /AND picks IS NULL\s*(--[^\n]*\n\s*)*AND \$\{nowSql\(sql, now\)\} < \$\{board\.closes_at\}::timestamptz/);
});

test('RULING tue-4: a late claim counts in the season boards (played, perfect, best) and the streak; only the closed day\'s own field excludes it', async () => {
  const L = await import('./seasonBoardLeaderboards.js');
  const d = dev('season'); const u = await user('season');
  await finishedGuest(d);                                   // all eight picks = the ceiling, pct 1
  const c = await G.claimGuestRuns(sql, { deviceId: d, userId: u, now: AFTER_CLOSE_BEFORE_PT });
  assert.equal(c.ok, true); assert.equal(c.claimed[0].late, true);
  const has = (rows) => rows.some((r) => Number(r.userId) === u);
  assert.ok(has(await L.playedLeaderboard(sql)), 'played');
  assert.ok(has(await L.perfectLeaderboard(sql)), 'perfect');
  assert.ok(has(await L.bestLeaderboard(sql)), 'best');
  assert.ok(has(await L.streakLeaderboard(sql, EDITION)), 'streak');
  assert.ok(!has(await todayLeaderboard(sql, boardId)), 'but not the closed day\'s own board');
});
