// lib/mlb/tbdLocks.test.mjs - TBD LOCKS. A TBD game on ANY board never locks
// at the provider's midnight-ET placeholder; it locks only once a real time
// posts (and then at that time), or once its status leaves 'scheduled'. Every
// fixture is built relative to now - a typed date is a cheque that bounces.
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

const { isGameLocked, isPlaceholderKickoff } = await import('./kickoffTbd.js');
const { hasKicked, nextUnlockedKickoff, nextKickoff, gameRows } = await import('../pickem/view.js');
const { onTimePicks, dayGameLocked, withCurrentTips } = await import('../nba/dayPickem.js');
const { roundLock } = await import('./seriesPickem.js');
const { clubStarted, nextClubLock, allClubsStarted } = await import('../run/rules.js');
const { phaseOf, cardSummary, locksSoon } = await import('../games/playLobby.js');

const H = 3600_000;
const NOW = new Date();
const hoursFromNow = (h) => new Date(NOW.getTime() + h * H).toISOString();
/** The most recent midnight-ET instant before `now` - what BDL files a TBD game at. */
function placeholderBefore(now = NOW) {
  let t = Math.floor((now.getTime() - 3 * H) / H) * H;
  for (let i = 0; i < 60; i += 1, t -= H) if (isPlaceholderKickoff(new Date(t).toISOString())) return new Date(t).toISOString();
  throw new Error('no midnight ET in 60h?');
}
const PH = placeholderBefore();
assert.ok(new Date(PH) < NOW, 'fixture: the placeholder is in the past');

// ---------------------------------------------------------------- the predicate

test('isGameLocked: status first, then (not TBD and kickoff <= now)', () => {
  const g = (o) => ({ status: 'scheduled', kickoff_at: hoursFromNow(2), ...o });
  assert.equal(isGameLocked(g()), false, 'a real future time is open');
  assert.equal(isGameLocked(g({ kickoff_at: hoursFromNow(-1) })), true, 'a real past time is locked');
  assert.equal(isGameLocked(g({ kickoff_at: NOW.toISOString() }), NOW), true, '<= at the boundary instant');
  // TBD: the placeholder is past, and the game is still open.
  assert.equal(isGameLocked(g({ kickoff_at: PH, kickoff_tbd: true })), false, 'stored flag: open');
  assert.equal(isGameLocked(g({ kickoff_at: PH, metadata: { kickoff_tbd: true } })), false, 'metadata flag: open');
  assert.equal(isGameLocked(g({ kickoff_at: PH, league_slug: 'mlb' })), false, 'MLB placeholder with no flag: open');
  assert.equal(isGameLocked(g({ kickoff_at: PH }), NOW), true, 'a non-MLB row is never judged by its clock for TBD');
  // Status leaves 'scheduled': locked whatever TBD says.
  for (const status of ['live', 'final', 'postponed', 'cancelled']) {
    assert.equal(isGameLocked(g({ kickoff_at: PH, kickoff_tbd: true, status })), true, status);
  }
  // The real time posts: flag clears, kickoff moves. Future -> open; then past -> locked at it.
  assert.equal(isGameLocked(g({ kickoff_at: hoursFromNow(3), kickoff_tbd: false })), false);
  assert.equal(isGameLocked(g({ kickoff_at: hoursFromNow(3), kickoff_tbd: false }), new Date(NOW.getTime() + 4 * H)), true);
  assert.equal(isGameLocked(null), true);
  assert.equal(dayGameLocked({ status: 'scheduled', kickoff_at: PH, kickoff_tbd: true }, NOW), false, 'dayGameLocked delegates');
});

// ---------------------------------------------------------------- pickem view

test('hasKicked / gameRows: a TBD game is not kicked at the placeholder; locks at the real time', () => {
  assert.equal(hasKicked({ kickoff_at: PH }, { now: NOW }), true, 'no flag: the plain rule');
  assert.equal(hasKicked({ kickoff_at: PH, kickoff_tbd: true }, { now: NOW }), false);
  assert.equal(hasKicked({ kickoff_at: PH }, { now: NOW, tbd: true }), false);
  assert.equal(hasKicked({ kickoff_at: PH, kickoff_tbd: true }, { now: NOW, status: 'live' }), true);

  const board = [
    { match_id: 1, slug: 'a', kickoff_at: PH, home: 'H', away: 'A' },
    { match_id: 2, slug: 'b', kickoff_at: hoursFromNow(5), home: 'H', away: 'A' },
  ];
  const tbd = gameRows({ board, now: NOW, liveById: new Map([[1, { status: 'scheduled', kickoff_tbd: true }]]) });
  assert.deepEqual(tbd.map((r) => r.kicked), [false, false]);
  // The real time posts and passes: the same row is now kicked, at the real time.
  const posted = hoursFromNow(-1);
  const after = gameRows({
    board: [{ ...board[0], kickoff_at: posted }, board[1]], now: NOW,
    liveById: new Map([[1, { status: 'scheduled', kickoff_tbd: false }]]),
  });
  assert.deepEqual(after.map((r) => r.kicked), [true, false]);
});

test('a TBD game is never the next lock / countdown target', () => {
  const soon = hoursFromNow(6);
  const board = [
    { match_id: 1, kickoff_at: PH, kickoff_tbd: true },
    { match_id: 2, kickoff_at: soon },
  ];
  assert.equal(nextUnlockedKickoff(board, { now: NOW }), soon);
  assert.equal(nextUnlockedKickoff([board[0]], { now: NOW }), null, 'only TBD left: open, but no clock');
  assert.equal(nextKickoff([{ kicked: false, kickoff_tbd: true, kickoff_at: PH }, { kicked: false, kickoff_at: soon }]), soon);
  assert.equal(nextKickoff([{ kicked: false, kickoff_tbd: true, kickoff_at: PH }]), null);
});

test('withCurrentTips carries the TBD flag onto the board row', () => {
  const out = withCurrentTips([{ match_id: 7, kickoff_at: hoursFromNow(1) }],
    new Map([[7, { kickoff_at: new Date(PH), kickoff_tbd: true }]]));
  assert.equal(out[0].kickoff_tbd, true);
  assert.equal(hasKicked(out[0], { now: NOW }), false);
});

test('the client agrees: kicked is not derived from a TBD placeholder', () => {
  for (const f of ['components/pickem/PickemBoard.js', 'components/pickem/ConfidenceBoard.js']) {
    assert.match(readFileSync(path.join(REPO, f), 'utf8'),
      /kicked: g\.kicked \|\| \(g\.kickoff_tbd !== true && new Date\(g\.kickoff_at\)\.getTime\(\) <= now\)/, f);
  }
});

// ---------------------------------------------------------------- settle

test('settle: a pick saved after the placeholder scores; a pick after a REAL tip is still late', () => {
  const pickedAt = { 1: hoursFromNow(-1) };           // after the placeholder (which is > 1h old)
  const tbdRow = new Map([[1, { kickoff_at: new Date(PH), kickoff_tbd: true }]]);
  assert.deepEqual(onTimePicks({ 1: 'home' }, pickedAt, tbdRow).lineup, { 1: 'home' });
  // The real time posts LATER than the pick: still on time.
  const realLater = new Map([[1, { kickoff_at: new Date(hoursFromNow(2)), kickoff_tbd: false }]]);
  assert.deepEqual(onTimePicks({ 1: 'home' }, pickedAt, realLater).lineup, { 1: 'home' });
  // A real tip BEFORE the pick: late, as ever.
  const realEarlier = new Map([[1, { kickoff_at: new Date(hoursFromNow(-3)), kickoff_tbd: false }]]);
  const r = onTimePicks({ 1: 'home' }, pickedAt, realEarlier);
  assert.deepEqual(r.lineup, {});
  assert.ok(r.late[1]);
});

// ---------------------------------------------------------------- series board

test('series board: the round does not lock on a placeholder first pitch', () => {
  const contest = { locks_at: PH };
  const tbdSeries = [{ games: [{ kickoffAt: PH, kickoffTbd: true, status: 'scheduled' }] }];
  assert.deepEqual(roundLock(contest, tbdSeries, NOW), { locked: false, locksAt: null, tbd: true });
  // A real first pitch posts for a different series, in the future: open, counts to it.
  const realFuture = [...tbdSeries, { games: [{ kickoffAt: hoursFromNow(4), kickoffTbd: false, status: 'scheduled' }] }];
  assert.deepEqual(roundLock(contest, realFuture, NOW), { locked: false, locksAt: hoursFromNow(4), tbd: false });
  // ... and once that real pitch has passed, the round locks.
  const realPast = [...tbdSeries, { games: [{ kickoffAt: hoursFromNow(-1), kickoffTbd: false, status: 'scheduled' }] }];
  assert.equal(roundLock(contest, realPast, NOW).locked, true);
  // A game thrown early locks it whatever the clock says.
  assert.equal(roundLock(contest, [{ games: [{ kickoffAt: PH, kickoffTbd: true, status: 'live' }] }], NOW).locked, true);
  // A REAL snapshot keeps the old law: locks at locks_at, `<=`.
  const real = { locks_at: hoursFromNow(-2) };
  assert.equal(roundLock(real, tbdSeries, NOW).locked, true);
  assert.equal(roundLock({ locks_at: hoursFromNow(2) }, [], NOW).locked, false);
  assert.equal(roundLock({ locks_at: NOW.toISOString() }, [], NOW).locked, true, '<= at the boundary');
});

// ---------------------------------------------------------------- The Run

test('The Run: a TBD game locks no club and is never the next lock', () => {
  const games = [
    { matchId: '1', kickoffAt: PH, status: 'scheduled', homeTeamId: 10, awayTeamId: 11 },
    { matchId: '2', kickoffAt: hoursFromNow(5), status: 'scheduled', homeTeamId: 12, awayTeamId: 13 },
    { matchId: '3', kickoffAt: PH, kickoffTbd: true, status: 'scheduled', homeTeamId: 14, awayTeamId: 15 },
  ];
  assert.equal(clubStarted(10, NOW, { games }), false);
  assert.equal(clubStarted(14, NOW, { games }), false, 'the stored flag too');
  assert.equal(clubStarted(10, NOW, { games: [{ ...games[0], status: 'live' }] }), true, 'live still locks');
  const board = { clubs: [10, 11, 12, 13].map((id) => ({ teamId: id, abbr: `T${id}` })) };
  assert.equal(nextClubLock(board, NOW, { games })?.matchId, '2', 'the real game is the next lock');
  assert.equal(nextClubLock(board, NOW, { games: [games[0]] }), null, 'only TBD left: no clock');
  assert.equal(allClubsStarted(board, NOW, { games }), false);
  // The real time posts and passes: locks at it.
  const posted = [{ ...games[0], kickoffAt: hoursFromNow(-1) }];
  assert.equal(clubStarted(10, NOW, { games: posted }), true);
});

// ---------------------------------------------------------------- the lobby

test('lobby: an open row whose only games are TBD stays open with no countdown', () => {
  const row = { key: 'k', name: 'N', game: 'pickem', sport: 'mlb', locksAt: null, lockTbd: true };
  assert.equal(phaseOf(row, NOW), 'open');
  assert.equal(phaseOf({ ...row, lockTbd: false }, NOW), 'locked');
  assert.equal(locksSoon({ ...row }, NOW), false);
  const real = { ...row, key: 'j', locksAt: hoursFromNow(2), lockTbd: false };
  const sum = cardSummary([{ ...row, phase: 'open' }, { ...real, phase: 'open' }]);
  assert.equal(sum.nextLock, real.locksAt, 'a TBD row is skipped for the next lock');
  const placeholder = cardSummary([{ ...row, locksAt: PH, phase: 'open' }]);
  assert.equal(placeholder.nextLock, null);
});

// ---------------------------------------------------------------- the save, against the database

const { sql } = await import('../db.js');
const { savePick } = await import('../pickem/entry.js');
const { settleDayBoard } = await import('../nba/dayPickem.js');

const LG = `tbdlocks-${process.pid}`;
const EMAIL = `sentinel-tbdlocks-${process.pid}@example.invalid`;
let leagueId; let userId; const contests = []; const matchIds = [];

before(async () => {
  leagueId = (await sql`INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${LG}, 'TBD locks test', 'mlb', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const t = [];
  for (const n of ['a', 'b']) {
    t.push((await sql`INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
      VALUES (${leagueId}, ${`tl-${process.pid}-${n}`}, ${n}, ${n}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id);
  }
  globalThis.__tl = { t };
  const [found] = await sql`SELECT id FROM users WHERE email = ${EMAIL} LIMIT 1`;
  userId = found?.id ?? (await sql`INSERT INTO users (email, created_at) VALUES (${EMAIL}, now()) RETURNING id`)[0].id;
});

after(async () => {
  for (const c of contests) await sql`DELETE FROM contest_entries WHERE contest_id = ${c}`;
  await sql`DELETE FROM contests WHERE sport = ${LG}`;
  if (matchIds.length) await sql`DELETE FROM matches WHERE id = ANY(${matchIds})`;
  await sql`DELETE FROM teams WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
  await sql`DELETE FROM contest_entries WHERE user_id = ${userId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
});

async function mkGame(slug, ko, { tbd = false, status = 'scheduled', scores = [null, null] } = {}) {
  const { t } = globalThis.__tl;
  const meta = tbd ? { kickoff_tbd: true } : {};
  const id = (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, home_score, away_score,
                         season_year, season_phase, week, external_ids, metadata)
    VALUES (${leagueId}, ${`${LG}-${slug}`}, ${ko}, ${status}, ${t[0]}, ${t[1]}, ${scores[0]}, ${scores[1]},
            2031, 'REG', 99, '{}'::jsonb, ${JSON.stringify(meta)}::jsonb) RETURNING id`)[0].id;
  matchIds.push(id);
  return id;
}
async function mkContest(week, id, ko, meta = {}) {
  const board = [{ match_id: id, slug: `${LG}-${id}`, kickoff_at: ko, home: 'a', away: 'b' }];
  const c = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('pickem', ${LG}, 2031, ${week}, ${JSON.stringify(board)}::jsonb,
            ${hoursFromNow(-72)}, ${hoursFromNow(48)}, ${hoursFromNow(60)}, ${JSON.stringify(meta)}::jsonb)
    RETURNING id, board`)[0];
  contests.push(c.id);
  return c;
}

for (const [label, meta, week] of [['football-shaped board', {}, 51], ['day board', { day_board: true, day_et: '2031-01-01' }, 52]]) {
  test(`SAVE (${label}): a TBD game is pickable after its placeholder; locks at the real time; status locks it`, async () => {
    const mid = await mkGame(`${label.slice(0, 3)}`, PH, { tbd: true });
    const c = await mkContest(week, mid, PH, meta);
    const ok = await savePick(userId, c.id, mid, 'home', { now: NOW });
    assert.equal(ok.ok, true, 'saved after the placeholder instant');
    // The real time posts, 3h ahead and the flag clears: still pickable.
    const real = hoursFromNow(3);
    await sql`UPDATE matches SET kickoff_at = ${real}, metadata = '{}'::jsonb WHERE id = ${mid}`;
    assert.equal((await savePick(userId, c.id, mid, 'away', { now: NOW })).ok, true);
    // ... and locks AT that real time.
    const late = await savePick(userId, c.id, mid, 'home', { now: new Date(real) });
    assert.deepEqual([late.ok, late.reason], [false, 'game_locked']);
    // A TBD game whose status left 'scheduled' is locked too.
    await sql`UPDATE matches SET kickoff_at = ${PH}, metadata = '{"kickoff_tbd": true}'::jsonb, status = 'live' WHERE id = ${mid}`;
    const live = await savePick(userId, c.id, mid, 'home', { now: NOW });
    assert.equal(live.ok, false);
  });
}

test('SETTLE (day board): a pick saved after the placeholder, before the real time, SCORES', async () => {
  const mid = await mkGame('settle', PH, { tbd: true });
  const c = await mkContest(53, mid, PH, { day_board: true, day_et: '2031-01-02' });
  assert.equal((await savePick(userId, c.id, mid, 'home', { now: NOW })).ok, true);
  // The game is played later: real time posts (after the pick), flag clears, final, home won.
  await sql`UPDATE matches SET kickoff_at = ${hoursFromNow(2)}, metadata = '{}'::jsonb,
                   status = 'final', home_score = 5, away_score = 2 WHERE id = ${mid}`;
  const [row] = await sql`SELECT id, board FROM contests WHERE id = ${c.id}`;
  const r = await settleDayBoard({ id: row.id, board: row.board, meta: { day_board: true } });
  assert.equal(r.settled, true);
  const [e] = await sql`SELECT score, lineup, meta FROM contest_entries WHERE contest_id = ${c.id} AND user_id = ${userId}`;
  assert.equal(Number(e.score), 1, 'scored, not voided as late');
  assert.deepEqual(e.lineup, { [mid]: 'home' });
  assert.equal(e.meta?.late_picks, undefined);
});
