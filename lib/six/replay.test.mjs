// lib/six/replay.test.mjs - TONIGHT'S SIX, PROVED ON A RECORDED NIGHT (DEV).
//
// 5 Mar 2026, three recorded games on one clock through the REAL poller
// (lib/six/replayNight.js): DAL @ ORL 114-115, GSW @ HOU 115-113 in OVERTIME,
// LAL @ DEN 113-120. Shifted five years forward and id-offset so it never
// meets lib/nba/replay.test.mjs's rows of the same games.
//
// THREE SENTINEL READERS through the real save door (lib/six/entry.js):
//   A  a full six with STEPHEN CURRY at G - picked before the tip, then DNP in
//      the box: the LATE SCRATCH. He must score 0 and A must NOT be a DNF.
//   B  a full six.
//   C  five, UTIL left empty: a DNF once LAL @ DEN tips.
// What it asserts: every refusal the door has, a pre-tip swap, the lock on the
// CURRENT tip, settle REFUSING until every game is final AND boxed (including
// a final whose box is missing), the scores against the recorded boxes, the
// perfect six against an independent exhaustive search, and the ranks.
//
// DEV WRITES: 3 sentinel matches (sentinel-six-<id>), their box rows (cascade),
// one contest (game_type 'six', sport 'nba', puzzle_date 2031-03-05), 3 users
// on @example.invalid, their entries. All deleted in after(), and the teardown
// is asserted.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';
import {
  SIX_NIGHT, SIX_PREFIX, nightFixtures, seedNight, driveNight, spans, teardownNight, poolFetch,
} from './replayNight.js';
import { ensureSixNight, sixNightFor, liveRows } from './night.js';
import { buildSixPool, refreshSixInjuries } from './pool.js';
import { saveSixPick, clearSixPick, sixView, sixEntryTouchingMatch } from './entry.js';
import { settleSixNight } from './settle.js';
import { eligible } from './rules.js';
import { linePoints } from '../nba/fantasyPoints.js';
import { syncNbaGameStats } from '../nba/statsSync.js';
import { replayFetch } from '../nba/replay.js';
import { fetchNbaTeams, upsertNbaLeague, upsertNbaTeams } from '../nba/sync.js';
import { syncNbaColors } from '../nba/teamColors.js';

const sql = neon(process.env.DATABASE_URL);
if (process.env.PROD_DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) {
  throw new Error('six replay.test refuses to run against PROD');
}

const SHIFT = Date.parse('2031-03-05T00:00:00Z') - Date.parse('2026-03-05T00:00:00Z');
const DAY = '2031-03-05';
const ID_OFFSET = 900_000_000;
const at = (iso) => new Date(Date.parse(iso) + SHIFT);
const NS = `six-replay-${process.pid}-${Date.now()}`;

let seeded = []; let contest = null; const users = {}; let sp = null; let state = null;
const ORL = SIX_NIGHT.ids[0]; const OT = SIX_NIGHT.ot; const DEN = SIX_NIGHT.ids[2];

// The players, by provider id (from the recorded boxes).
const CURRY = '115'; const BUTLER = '79';
const CARD_A = { g1: CURRY, g2: '17896073', f1: '38017683', f2: '140', c: '246', util: '1028028519' };
const CARD_B = { g1: '335', g2: '132', f1: '1057262088', f2: '237', c: '17896062', util: '1028028519' };
const CARD_C = { g1: '443', g2: '56677858', f1: '666577', f2: '185', c: '666626' };

const gameOf = (pid) => seeded.find((s) => s.fx.stats.some((r) => String(r.player.id) === String(pid)));
const pickOf = (pid) => ({ playerId: pid, matchId: gameOf(pid).matchId });
const save = (u, slot, pid, now) => saveSixPick(users[u], contest.id, slot, pickOf(pid), { now });

/** The recorded box line's points, straight from the fixture. */
function recordedPoints(pid) {
  const s = gameOf(pid).fx.stats.find((r) => String(r.player.id) === String(pid));
  if (!s.min || /^0+(:00)?$/.test(String(s.min))) return 0;
  return linePoints({ ...s, turnovers: s.turnover });
}

before(async () => {
  const [l] = await sql`SELECT id FROM leagues WHERE slug = 'nba'`;
  const n = l ? (await sql`SELECT count(*)::int AS n FROM teams WHERE league_id = ${l.id}`)[0].n : 0;
  if (n !== 30) {
    // Fixture repair, costed: one BDL call and 30 idempotent team upserts.
    const id = await upsertNbaLeague(sql);
    await upsertNbaTeams(sql, id, await fetchNbaTeams());
    await syncNbaColors(sql, id);
  }
  seeded = await seedNight(sql, nightFixtures({ ms: SHIFT, idOffset: ID_OFFSET }));
  sp = spans(seeded);
  for (const u of ['A', 'B', 'C']) {
    users[u] = (await sql`INSERT INTO users (name, email, handle) VALUES (${`Six ${u}`}, ${`${NS}-${u.toLowerCase()}@example.invalid`}, ${`sx${u}${process.pid}${Date.now() % 1e6}`}) RETURNING id`)[0].id;
  }
});

after(async () => {
  const ids = Object.values(users);
  if (contest?.id) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ${contest.id}`;
    await sql`DELETE FROM contests WHERE id = ${contest.id}`;
  }
  if (ids.length) await sql`DELETE FROM users WHERE id = ANY(${ids})`;
  await teardownNight(sql, seeded);
  const [m] = await sql`SELECT count(*)::int AS n FROM matches WHERE slug LIKE ${`${SIX_PREFIX}%`}`;
  const [c] = await sql`SELECT count(*)::int AS n FROM contests WHERE game_type = 'six' AND puzzle_date = ${DAY}::date`;
  const [u] = await sql`SELECT count(*)::int AS n FROM users WHERE email LIKE ${`${NS}%`}`;
  assert.deepEqual([m.n, c.n, u.n], [0, 0, 0], 'six replay teardown');
});

test('the night opens through the real slate read, and its pool comes from the night\'s boxes', async () => {
  const now = at('2026-03-05T20:00:00Z');
  const r = await ensureSixNight({ dayEt: DAY, now });
  assert.equal(r.created, true, JSON.stringify(r));
  assert.equal(r.games, 3);
  contest = await sixNightFor(DAY);
  assert.deepEqual(contest.board.map((g) => g.match_id), seeded.map((s) => s.matchId), 'tip order: ORL 00:00, HOU 00:30, DEN 03:00');
  const fetchImpl = poolFetch(seeded.map((s) => s.fx), { injuries: { [BUTLER]: 'Out', 56677858: 'Questionable' } });
  const pool = await buildSixPool(contest, { fetchImpl, key: 'replay' });
  assert.equal(pool.incomplete, false);
  assert.equal(Object.keys(pool.byGame).length, 3);
  await refreshSixInjuries(contest, { fetchImpl, key: 'replay', now });
  contest = await sixNightFor(DAY);
  assert.equal(contest.meta.injuries.byPlayer[BUTLER], 'Out');
  assert.ok(contest.meta.pool.byGame, 'cached onto the night');
  // Again: idempotent.
  assert.equal((await ensureSixNight({ dayEt: DAY, now })).reason, 'exists');
});

test('PICKS BEFORE THE TIPS: three cards, and every refusal the door has', async () => {
  const now = at('2026-03-05T20:00:00Z');
  for (const [slot, pid] of Object.entries(CARD_A)) assert.deepEqual(await save('A', slot, pid, now), { ok: true, slot, playerId: pid }, `A ${slot}`);
  for (const [slot, pid] of Object.entries(CARD_B)) assert.equal((await save('B', slot, pid, now)).ok, true, `B ${slot}`);
  for (const [slot, pid] of Object.entries(CARD_C)) assert.equal((await save('C', slot, pid, now)).ok, true, `C ${slot}`);

  assert.equal((await save('C', 'util', BUTLER, now)).reason, 'player_out', 'Butler is listed Out');
  assert.equal((await save('C', 'util', '219', now)).reason, 'max_from_team', 'Horford would be a third Warrior (cap 2 on a six-team night)');
  assert.equal((await save('C', 'f1', '246', now)).reason, 'wrong_position', 'Jokic is a C');
  assert.equal((await save('C', 'util', '443', now)).reason, 'already_on_card');
  assert.equal((await saveSixPick(users.C, contest.id, 'util', { playerId: '999999', matchId: seeded[0].matchId }, { now })).reason, 'not_in_pool');
});

test('THE LOCK IS EACH GAME\'S CURRENT TIP: after ORL tips, ORL slots seal; a pre-tip swap elsewhere is fine', async () => {
  // 7:05 PM ET: DAL @ ORL tipped at 00:00Z, GSW @ HOU tips at 00:30Z.
  const mid = at('2026-03-06T00:05:00Z');
  assert.equal((await clearSixPick(users.A, contest.id, 'g2', { now: mid })).reason, 'slot_locked', 'Suggs (ORL) is sealed');
  assert.equal((await save('A', 'g2', '17896073', mid)).reason, 'game_started', 'nor re-entered from a tipped game');
  assert.equal((await save('C', 'util', '3547287', mid)).reason, 'game_started', 'Bane (ORL) cannot enter an open slot');
  // A swaps UTIL before GSW @ HOU tips: Sheppard out, Amen Thompson in.
  assert.equal((await save('A', 'util', '56677825', mid)).ok, true, 'pre-tip swap');
  // THE CURRENT TIP, NOT THE SNAPSHOT: move HOU's tip earlier on the row and
  // the same save is refused, with the board's frozen 00:30Z untouched.
  const hou = seeded[1].matchId;
  await sql`UPDATE matches SET kickoff_at = ${at('2026-03-06T00:04:00Z').toISOString()} WHERE id = ${hou}`;
  assert.equal((await save('A', 'util', '335', mid)).reason, 'slot_locked', 'Amen Thompson\'s slot sealed at the moved tip, even for a DEN player');
  await sql`UPDATE matches SET kickoff_at = ${at('2026-03-06T00:30:00Z').toISOString()} WHERE id = ${hou}`;
  const [{ lineup }] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${contest.id} AND user_id = ${users.A}`;
  assert.equal(lineup.util.playerId, '56677825');
});

test('THE REPLAY: settle refuses before the tips and while ANY game is open', async () => {
  let r = await settleSixNight(contest, { now: at('2026-03-05T23:00:00Z') });
  assert.equal(r.settled, false);
  assert.equal(r.waitingOn.length, 3);
  // Drive to just after DAL @ ORL ends: ORL final, HOU live (in the 4th), DEN not tipped.
  state = await driveNight(sql, seeded, { from: Date.parse(at('2026-03-05T23:40:00Z')), to: sp[ORL].endAt + 3 * 60_000, stepSec: 90 });
  const byId = await liveRows(contest.board);
  assert.deepEqual(contest.board.map((g) => byId.get(String(g.match_id)).status), ['final', 'live', 'scheduled']);
  r = await settleSixNight(contest, { now: new Date(state.t) });
  assert.deepEqual(r.waitingOn.map((w) => [w.matchId, w.why]), [[seeded[1].matchId, 'not_final'], [seeded[2].matchId, 'not_final']]);

  // The live card at that instant: one final, one live, one waiting.
  const v = await sixView(users.A, contest, { now: new Date(state.t) });
  assert.equal(v.phase, 'live');
  const s = Object.fromEntries(v.slots.map((x) => [x.slot, x]));
  assert.equal(s.g2.state, 'final'); assert.equal(s.g2.points, recordedPoints('17896073'));
  assert.equal(s.g1.state, 'live', 'Curry\'s game is live');
  assert.equal(s.c.state, 'pending', 'Jokic waits on the DEN tip');
  assert.ok(s.f1.chips.find((c) => c.key === 'pts' && c.count > 0), 'stat chips on a final slot');
  assert.equal(v.nextLock.label, 'LAL @ DEN');
  // C's UTIL is still fillable from DEN - not yet a DNF.
  assert.equal((await sixView(users.C, contest, { now: new Date(state.t) })).nightState, 'open');
});

test('THE OT GAME goes final at the recorded score with five periods; settle still waits on DEN', async () => {
  state = await driveNight(sql, seeded, { from: state.t, to: sp[OT].endAt + 3 * 60_000, stepSec: 90, state });
  const [m] = await sql`SELECT status, home_score, away_score, metadata->'detail'->'line_score' AS line FROM matches WHERE id = ${seeded[1].matchId}`;
  assert.deepEqual([m.status, m.away_score, m.home_score], ['final', 115, 113]);
  assert.equal(m.line.length, 5, 'four quarters and an overtime');
  const r = await settleSixNight(contest, { now: new Date(state.t) });
  assert.deepEqual(r.waitingOn.map((w) => w.why), ['not_final']);
  // DEN tipped at 03:00Z, before the OT ended: C's empty UTIL has no game left
  // to come from, so the night is a DNF from here.
  const vc = await sixView(users.C, contest, { now: new Date(state.t) });
  assert.equal(vc.nightState, 'dnf');
  assert.equal(vc.isDnf, true);
});

test('A FINAL WITHOUT ITS BOX IS REFUSED; with the box in, the night settles', async () => {
  state = await driveNight(sql, seeded, { from: state.t, to: sp[DEN].endAt + 3 * 60_000, stepSec: 90, state });
  const den = seeded[2].matchId;
  const saved = await sql`SELECT count(*)::int AS n FROM nba_player_game_stats WHERE match_id = ${den}`;
  assert.ok(saved[0].n > 0, 'the poller boxed DEN at its final');
  await sql`DELETE FROM nba_player_game_stats WHERE match_id = ${den}`;
  let r = await settleSixNight(contest, { now: new Date(state.t) });
  assert.equal(r.settled, false);
  assert.deepEqual(r.waitingOn.map((w) => [w.matchId, w.why]), [[den, 'no_box']]);
  // The box lands (the stats sync the poller runs, at the final instant).
  const t = state.t;
  await syncNbaGameStats(den, { sql, fetchImpl: replayFetch(seeded.map((s) => s.fx), () => t), key: 'replay' });
  r = await settleSixNight(contest, { now: new Date(state.t) });
  assert.equal(r.settled, true, JSON.stringify(r));
  assert.equal(r.entries, 3);
  assert.equal(r.dnf, 1);
  // Idempotent: a second pass finds it settled.
  assert.equal((await settleSixNight({ ...contest }, { now: new Date(state.t) })).settled, false);
});

test('THE SCORES are the recorded boxes through the table; the late scratch is 0, not a DNF', async () => {
  const rows = await sql`SELECT user_id, score, meta->'six' AS six FROM contest_entries WHERE contest_id = ${contest.id}`;
  const by = Object.fromEntries(rows.map((r) => [Object.keys(users).find((k) => users[k] === r.user_id), r]));
  const sum = (card) => Math.round(Object.values(card).reduce((a, pid) => a + recordedPoints(pid), 0) * 10) / 10;
  const finalA = { ...CARD_A, util: '56677825' };
  assert.equal(recordedPoints(CURRY), 0, 'Curry did not play');
  assert.equal(Number(by.A.score), sum(finalA));
  assert.equal(by.A.six.state, 'complete', 'a DNP is not a DNF');
  assert.equal(by.A.six.dnp, 1);
  assert.equal(Number(by.B.score), sum(CARD_B));
  assert.equal(Number(by.C.score), 0);
  assert.equal(by.C.six.state, 'dnf');
  assert.equal(by.C.six.raw, sum(CARD_C), 'the raw total is kept beside the DNF');
  // RANKS: B 270.5 over A 239, C last.
  assert.deepEqual([by.B.six.rank, by.A.six.rank, by.C.six.rank], [1, 2, 3]);
  assert.ok(Number(by.B.score) > Number(by.A.score));
  for (const r of rows) assert.equal(r.six.of, 3);

  const v = await sixView(users.A, (await sixNightFor(DAY)), { now: new Date(state.t) });
  assert.equal(v.phase, 'final');
  assert.equal(v.rank, 2);
  const curry = v.slots.find((s) => s.slot === 'g1');
  assert.deepEqual([curry.state, curry.points, curry.dnp, curry.line], ['final', 0, true, 'DNP']);
  assert.equal(v.boardRows.head.length, 3);
});

test('THE PERFECT SIX equals an independent exhaustive search, and is legal', async () => {
  const c = await sixNightFor(DAY);
  const p = c.perfect;
  // Exhaustive over the night's top 22 who played (C(22,6) = 74,613 cards):
  // seated by position, at most 2 from a team.
  const played = seeded.flatMap((s) => s.fx.stats
    .filter((r) => r.min && !/^0+(:00)?$/.test(String(r.min)))
    .map((r) => ({ id: String(r.player.id), pos: r.player.position, team: r.team.id, pts: linePoints({ ...r, turnovers: r.turnover }) })))
    .sort((a, b) => b.pts - a.pts).slice(0, 22);
  const SL = ['g1', 'g2', 'f1', 'f2', 'c', 'util'];
  const seat = (six) => { const perm = (i, used) => { if (i === 6) return true; for (let k = 0; k < 6; k += 1) { if (used & (1 << k) || !eligible(SL[k], six[i].pos)) continue; if (perm(i + 1, used | (1 << k))) return true; } return false; }; return perm(0, 0); };
  let best = -1;
  const combo = (start, chosen) => {
    if (chosen.length === 6) {
      const per = {}; for (const x of chosen) per[x.team] = (per[x.team] ?? 0) + 1;
      if (Object.values(per).some((n) => n > 2)) return;
      const t = chosen.reduce((a, x) => a + x.pts, 0);
      if (t > best && seat(chosen)) best = t;
      return;
    }
    for (let i = start; i < played.length; i += 1) combo(i + 1, [...chosen, played[i]]);
  };
  combo(0, []);
  assert.equal(p.score, Math.round(best * 10) / 10);
  assert.equal(p.players.length, 6);
  assert.equal(p.cap, 2);
  const teams = {}; for (const x of p.players) teams[x.teamId] = (teams[x.teamId] ?? 0) + 1;
  assert.ok(Object.values(teams).every((n) => n <= 2));
  for (const x of p.players) assert.ok(eligible(x.slot, x.position), `${x.name} in ${x.slot}`);
  assert.ok(p.players.some((x) => x.name === 'Nikola Jokic' && x.slot === 'c'));
  assert.ok(p.score >= 270.5, 'no card beats the perfect six');
});

test('THE READER for the game page: this user\'s entry touching match X', async () => {
  const hou = seeded[1].matchId;
  const a = await sixEntryTouchingMatch(users.A, hou);
  assert.equal(a.contestId, contest.id);
  assert.deepEqual(a.slots.map((s) => [s.slot, s.playerId, s.dnp]).sort(), [['f2', '140', false], ['g1', CURRY, true], ['util', '56677825', false]]);
  assert.equal(a.total, Number((await sql`SELECT score FROM contest_entries WHERE contest_id = ${contest.id} AND user_id = ${users.A}`)[0].score));
  assert.equal(await sixEntryTouchingMatch(users.C, seeded[2].matchId).then((x) => x.slots.length), 1, 'C has only Hayes in DEN');
  assert.equal(await sixEntryTouchingMatch(users.C, 2_000_000_000), null);
  assert.equal(await sixEntryTouchingMatch(null, hou), null);
});
