// lib/pickem/confidenceFlow.test.mjs - confidence Pick'em against the database:
// save, lock freeze, settle (void, unpicked), re-grade, the NBA day board's late
// strip, the NBA under-three skip, and a regular board that must not move.
//
// Hermetic DECEMBER 2031 (a window per file). Mon 2031-12-08 starts the football
// window. The NBA day board uses the same fixture teams under its own sport slug.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const { sql } = await import('../db.js');
const { ensurePickemBoard } = await import('./create.js');
const { savePick, saveSheet, pickemBoardView, receiptFor } = await import('./entry.js');
const { settleDuePickem, gradePickemBoard } = await import('./settle.js');
const { settleDayBoard, nbaDayBoardPlan } = await import('../nba/dayPickem.js');
const { pickemBoardLeaderboard } = await import('../games/leaderboard.js');

const LG = 'pickemtest-conf-cfb';
const NBA_LG = 'pickemtest-conf-nba';
const EMAILS = ['conf-a@example.invalid', 'conf-b@example.invalid', 'conf-c@example.invalid'];

const KO = {
  g1: '2031-12-13T17:00:00Z', g2: '2031-12-13T20:30:00Z',
  g3: '2031-12-14T00:00:00Z', g4: '2031-12-14T17:00:00Z',
};
const OPEN = new Date('2031-12-10T15:00:00Z');            // Wed, nothing kicked
const AFTER_G1 = new Date('2031-12-13T18:00:00Z');        // g1 has kicked, the rest are open
const SETTLE = new Date('2031-12-17T12:00:00Z');          // past the void cutoff, inside the 7-day re-grade window

let leagueId; let nbaLeagueId; let uA; let uB; let uC; let contestId; let regularId; let dayId;
const m = {}; const nm = {};
const side = (g) => (g === 'home' ? 'home' : 'away');

const mkTeam = async (lg, slug) => (await sql`INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
  VALUES (${lg}, ${slug}, ${slug}, ${slug}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
const mkMatch = async (lg, slug, ko, h, a, extra = {}) => (await sql`
  INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, week, external_ids, metadata)
  VALUES (${lg}, ${slug}, ${ko}, ${extra.status ?? 'scheduled'}, ${h}, ${a}, 2031, 'REG', 99, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;

{
  leagueId = (await sql`INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${LG}, 'Confidence Test', 'cfb', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  nbaLeagueId = (await sql`INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${NBA_LG}, 'Confidence NBA Test', 'nba', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const h = await mkTeam(leagueId, 'cf-home'); const a = await mkTeam(leagueId, 'cf-away');
  for (const [k, ko] of Object.entries(KO)) m[k] = await mkMatch(leagueId, `cf-${k}`, ko, h, a);
  for (const e of EMAILS) await sql`INSERT INTO users (email) VALUES (${e}) ON CONFLICT DO NOTHING`;
  [uA, uB, uC] = (await sql`SELECT id FROM users WHERE email = ANY(${EMAILS}) ORDER BY email`).map((r) => r.id);
  contestId = (await ensurePickemBoard({ leagueSlug: LG, now: OPEN })).id;
  // THE BOARD IS STAMPED AT CREATION in production (stampsConfidence); this fixture's sport is not one of
  // the three, so the stamp is applied here and the stamping itself is pinned in confidence.test.mjs.
  await sql`UPDATE contests SET meta = meta || jsonb_build_object('scoring', 'confidence') WHERE id = ${contestId}`;
}

after(async () => {
  const ids = [contestId, regularId, dayId].filter(Boolean);
  await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${ids})`;
  await sql`DELETE FROM contests WHERE id = ANY(${ids})`;
  await sql`DELETE FROM matches WHERE league_id = ANY(${[leagueId, nbaLeagueId]})`;
  await sql`DELETE FROM teams WHERE league_id = ANY(${[leagueId, nbaLeagueId]})`;
  await sql`DELETE FROM leagues WHERE id = ANY(${[leagueId, nbaLeagueId]})`;
  await sql`DELETE FROM users WHERE email = ANY(${EMAILS})`;
});

const entry = async (cid, uid) => (await sql`SELECT lineup, ranks, score, max_score, meta FROM contest_entries WHERE contest_id = ${cid} AND user_id = ${uid}`)[0];
const sheet = (o) => ({ [m.g1]: o[0], [m.g2]: o[1], [m.g3]: o[2], [m.g4]: o[3] });

test('the whole sheet saves in one call and is stored whole', async () => {
  const r = await saveSheet(uA, contestId, {
    picks: { [m.g1]: 'home', [m.g2]: 'home', [m.g3]: 'away', [m.g4]: 'home' }, ranks: sheet([1, 2, 3, 4]),
  }, { now: OPEN });
  assert.equal(r.ok, true);
  const e = await entry(contestId, uA);
  assert.deepEqual(e.ranks, sheet([1, 2, 3, 4]));
  assert.equal(e.lineup[m.g1], 'home');
  // lineup stays a flat map of bare side strings - the rank is never inside it
  assert.ok(Object.values(e.lineup).every((v) => v === 'home' || v === 'away'));
});

test('a sheet that is not a permutation of 1..N is refused and writes nothing', async () => {
  const before = await entry(contestId, uA);
  const r = await saveSheet(uA, contestId, { picks: {}, ranks: sheet([1, 1, 3, 4]) }, { now: OPEN });
  assert.deepEqual([r.ok, r.reason], [false, 'bad_ranks']);
  assert.deepEqual((await entry(contestId, uA)).ranks, before.ranks);
});

test('LOCK FREEZE and the SWAP ACROSS A LOCKED GAME, against the server clock', async () => {
  // B ranks g1 THIRD from the top: g2=4, g1=3, g4=2, g3=1
  const first = await saveSheet(uB, contestId, {
    picks: { [m.g1]: 'home', [m.g2]: 'away', [m.g4]: 'away' }, ranks: sheet([3, 4, 1, 2]),
  }, { now: OPEN });
  assert.equal(first.ok, true);
  // g1 has kicked. Moving ITS number is refused...
  const moved = await saveSheet(uB, contestId, { picks: { [m.g1]: 'home', [m.g2]: 'away', [m.g4]: 'away' }, ranks: sheet([4, 3, 1, 2]) }, { now: AFTER_G1 });
  assert.deepEqual([moved.ok, moved.reason], [false, 'rank_locked']);
  // ...changing a locked game's pick is refused...
  const flip = await saveSheet(uB, contestId, { picks: { [m.g1]: 'away', [m.g2]: 'away', [m.g4]: 'away' }, ranks: sheet([3, 4, 1, 2]) }, { now: AFTER_G1 });
  assert.deepEqual([flip.ok, flip.reason], [false, 'game_locked']);
  // ...repeating a locked pick UNCHANGED is not a change, so it is fine...
  const same = await saveSheet(uA, contestId, { picks: { [m.g1]: 'home', [m.g2]: 'home', [m.g3]: 'away', [m.g4]: 'home' }, ranks: sheet([1, 2, 3, 4]) }, { now: AFTER_G1 });
  assert.equal(same.ok, true);
  // ...and a FIRST pick on a locked game that had none is refused (B never picked g3, which tipped by 01:00Z).
  const late = await saveSheet(uB, contestId, { picks: { [m.g1]: 'home', [m.g2]: 'away', [m.g3]: 'home', [m.g4]: 'away' }, ranks: sheet([3, 4, 1, 2]) }, { now: new Date('2031-12-14T01:00:00Z') });
  assert.deepEqual([late.ok, late.reason], [false, 'game_locked']);
  // The swap of g2 and g4 ACROSS the locked g1 (g2=4, g1=3, g4=2 -> g4=4, g1=3, g2=2) is accepted.
  const swap = await saveSheet(uB, contestId, { picks: { [m.g1]: 'home', [m.g2]: 'away', [m.g4]: 'away' }, ranks: sheet([3, 2, 1, 4]) }, { now: AFTER_G1 });
  assert.equal(swap.ok, true);
  const e = await entry(contestId, uB);
  assert.equal(e.ranks[m.g1], 3, 'the locked game kept its number');
  assert.equal(e.ranks[m.g4], 4);
  assert.equal(e.ranks[m.g2], 2);
});

test('a regular board refuses a sheet', async () => {
  const [c] = await sql`SELECT id FROM contests WHERE id = ${contestId}`;
  await sql`UPDATE contests SET meta = meta - 'scoring' WHERE id = ${c.id}`;
  const r = await saveSheet(uA, contestId, { picks: {}, ranks: sheet([1, 2, 3, 4]) }, { now: OPEN });
  await sql`UPDATE contests SET meta = meta || jsonb_build_object('scoring', 'confidence') WHERE id = ${contestId}`;
  assert.equal(r.reason, 'not_confidence');
});

test('the board view carries MY sheet (default for a stranger to it) and nobody else\'s', async () => {
  await savePick(uC, contestId, m.g1, 'home', { now: OPEN });          // C never saves a sheet
  const v = await pickemBoardView(uC, { sport: LG, now: OPEN });
  assert.equal(v.contest.scoring, 'confidence');
  const byId = Object.fromEntries(v.games.map((g) => [g.match_id, g.my_rank]));
  assert.deepEqual(byId, sheet([4, 3, 2, 1]), 'pre-filled 1..N, latest kickoff = 1');
  const va = await pickemBoardView(uA, { sport: LG, now: OPEN });
  assert.deepEqual(Object.fromEntries(va.games.map((g) => [g.match_id, g.my_rank])), sheet([1, 2, 3, 4]));
});

test('SETTLE: void off earned AND max, unpicked stays in max, percent of max ranks the field', async () => {
  // g1 home wins, g2 AWAY wins, g3 POSTPONED (void), g4 AWAY wins
  await sql`UPDATE matches SET status = 'final', home_score = 31, away_score = 17 WHERE id = ${m.g1}`;
  await sql`UPDATE matches SET status = 'final', home_score = 10, away_score = 20 WHERE id = ${m.g2}`;
  await sql`UPDATE matches SET status = 'postponed' WHERE id = ${m.g3}`;
  await sql`UPDATE matches SET status = 'final', home_score = 3, away_score = 9 WHERE id = ${m.g4}`;
  const r = await settleDuePickem({ now: SETTLE });
  const mine = r.results.find((x) => x.contestId === contestId);
  assert.equal(mine.settled, true);
  assert.equal(mine.voided, 1);

  // A: g1 home RIGHT(1), g2 home wrong, g3 void, g4 home wrong        -> 1 of (1+2+4)=7
  const a = await entry(contestId, uA);
  assert.deepEqual([Number(a.score), Number(a.max_score)], [1, 7]);
  // B (g1=3, g2=2, g3=1, g4=4): g1 home RIGHT 3, g2 away RIGHT 2, g4 away RIGHT 4 -> 9 of (3+2+4)=9
  const b = await entry(contestId, uB);
  assert.deepEqual([Number(b.score), Number(b.max_score)], [9, 9]);
  // C picked ONLY g1 and never saved a sheet: default g1=4 RIGHT, g2 and g4 unpicked stay in max
  //   max = 4 + 3 + 1 = 8 (the void g3's 2 is off)                          -> 4 of 8
  const c = await entry(contestId, uC);
  assert.deepEqual([Number(c.score), Number(c.max_score)], [4, 8]);

  const [row] = await sql`SELECT perfect, meta FROM contests WHERE id = ${contestId}`;
  assert.equal(row.perfect.max, 3, 'perfect.max stays the count of games with a winner');
  assert.deepEqual(row.perfect.void, [m.g3]);

  const lb = await pickemBoardLeaderboard(contestId, uA, { limit: 5 });
  assert.equal(lb.confidence, true);
  assert.deepEqual(lb.top.map((x) => [x.userId, x.rank, x.score, x.max]), [[uB, 1, 9, 9], [uC, 2, 4, 8], [uA, 3, 1, 7]]);
  const rc = await receiptFor(contestId, uC, { results: row.perfect.results, board: [] });
  assert.deepEqual([rc.score, rc.max, rc.rank, rc.field], [4, 8, 2, 3]);
});

test('the settled view reads points first, record second, and the void came off the max', async () => {
  const v = await pickemBoardView(uA, { sport: LG, now: SETTLE });
  assert.equal(v.phase, 'settled');
  const c = v.confidence;
  assert.deepEqual([c.points, c.max, c.correct, c.played], [1, 7, 1, 3]);
  assert.deepEqual([c.voidCount, c.voidPoints], [1, 3], 'A had ranked the postponed game 3');
  assert.equal(c.beatPct, 0);
  const rows = Object.fromEntries(v.games.map((g) => [g.match_id, [g.my_points, g.void]]));
  assert.deepEqual(rows[m.g1], [1, false]);       // +1
  assert.deepEqual(rows[m.g2], [0, false]);       // 0
  assert.deepEqual(rows[m.g3], [null, true]);     // void
  const vb = await pickemBoardView(uB, { sport: LG, now: SETTLE });
  assert.equal(vb.confidence.beatPct, 100);
});

test('RE-GRADE inside the window re-scores through the same function, max included', async () => {
  // a score correction: g2 turns out to be a HOME win
  await sql`UPDATE matches SET home_score = 24, away_score = 20 WHERE id = ${m.g2}`;
  const [c] = await sql`SELECT id, sport, board, meta, perfect, settles_at, settled_at FROM contests WHERE id = ${contestId}`;
  const r = await gradePickemBoard(c, { regrade: true, now: SETTLE });
  assert.equal(r.regraded, true);
  const a = await entry(contestId, uA);
  assert.deepEqual([Number(a.score), Number(a.max_score)], [1 + 2, 7], 'g2 (rank 2) is now right');
  const b = await entry(contestId, uB);
  assert.deepEqual([Number(b.score), Number(b.max_score)], [7, 9], 'B\'s g2 pick turned wrong: 9 - 2');
  const [after] = await sql`SELECT perfect FROM contests WHERE id = ${contestId}`;
  assert.deepEqual(after.perfect.void, [m.g3], 'the void stays void');
});

test('A REGULAR BOARD IS UNCHANGED: wins, no max, no ranks', async () => {
  // week 98 board of the same fixture games, no scoring stamp
  const board = (await sql`SELECT board FROM contests WHERE id = ${contestId}`)[0].board;
  regularId = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('pickem', ${LG}, 2031, 98, ${JSON.stringify(board)}::jsonb, '2031-12-09T14:00:00Z', '2031-12-14T17:00:00Z', '2031-12-15T05:00:00Z', '{}'::jsonb)
    RETURNING id`)[0].id;
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES (${regularId}, ${uA}, ${JSON.stringify({ [m.g1]: 'home', [m.g2]: 'home', [m.g3]: 'home', [m.g4]: 'away' })}::jsonb)`;
  const [c] = await sql`SELECT id, sport, board, meta, perfect, settles_at, settled_at FROM contests WHERE id = ${regularId}`;
  const r = await gradePickemBoard(c, { now: SETTLE });
  assert.equal(r.settled, true);
  const e = await entry(regularId, uA);
  assert.equal(Number(e.score), 3, 'g1, g2 (now home) and g4 right; the void is nobody\'s');
  assert.equal(e.max_score, null);
  assert.equal(e.ranks, null);
});

test('NBA DAY BOARD: a late pick is stripped WITH its rank, and the unpicked slot stays in max', async () => {
  const h = await mkTeam(nbaLeagueId, 'cn-home'); const a = await mkTeam(nbaLeagueId, 'cn-away');
  const T = { n1: '2031-12-16T00:00:00Z', n2: '2031-12-16T02:00:00Z', n3: '2031-12-16T04:00:00Z' };
  for (const [k, ko] of Object.entries(T)) nm[k] = await mkMatch(nbaLeagueId, `cn-${k}`, ko, h, a, { status: 'final' });
  await sql`UPDATE matches SET home_score = 100, away_score = 90 WHERE league_id = ${nbaLeagueId}`;     // home wins all three
  const board = Object.entries(T).map(([k, ko]) => ({ match_id: nm[k], slug: `cn-${k}`, kickoff_at: ko, home_team_id: h, away_team_id: a, home: 'H', away: 'A' }));
  dayId = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('pickem', ${NBA_LG}, 2031, 20311215, ${JSON.stringify(board)}::jsonb, '2031-12-15T11:00:00Z', ${T.n3}, '2031-12-16T10:00:00Z',
            '{"day_board": true, "day_et": "2031-12-15", "scoring": "confidence"}'::jsonb) RETURNING id`)[0].id;
  // ranks n1=3 n2=2 n3=1; n2's pick was STAMPED AFTER its (moved-earlier) tip -> late
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup, ranks, meta) VALUES (${dayId}, ${uA},
    ${JSON.stringify({ [nm.n1]: 'home', [nm.n2]: 'home', [nm.n3]: 'home' })}::jsonb,
    ${JSON.stringify({ [nm.n1]: 3, [nm.n2]: 2, [nm.n3]: 1 })}::jsonb,
    ${JSON.stringify({ picked_at: { [nm.n1]: '2031-12-15T20:00:00Z', [nm.n2]: '2031-12-16T02:30:00Z', [nm.n3]: '2031-12-15T20:00:00Z' } })}::jsonb)`;
  const [c] = await sql`SELECT * FROM contests WHERE id = ${dayId}`;
  const r = await settleDayBoard(c);
  assert.equal(r.settled, true);
  assert.equal(r.late, 1);
  const e = await entry(dayId, uA);
  assert.equal(e.lineup[nm.n2], undefined, 'the late pick left the lineup');
  assert.equal(e.ranks[nm.n2], undefined, 'and its rank went with it');
  assert.deepEqual(e.meta.late_picks[nm.n2].side, 'home');
  assert.deepEqual([Number(e.score), Number(e.max_score)], [3 + 1, 6], 'n2 earns 0 but keeps its slot in the max');
});

test('NBA: fewer than three games gets NO board from the confidence start; three does; before it, any night does', async () => {
  const h = (await sql`SELECT id FROM teams WHERE league_id = ${nbaLeagueId} LIMIT 1`)[0].id;
  const a = (await sql`SELECT id FROM teams WHERE league_id = ${nbaLeagueId} OFFSET 1 LIMIT 1`)?.[0]?.id ?? h;
  const mk = (slug, ko) => mkMatch(nbaLeagueId, slug, ko, h, a);
  // 2031 is after CONFIDENCE_START, so this sport slug must be an NBA slug to be stamped: plan with sport 'nba'
  await mk('cn-two-a', '2031-12-20T23:00:00Z'); await mk('cn-two-b', '2031-12-21T01:00:00Z');
  const thin = await nbaDayBoardPlan({ leagueSlug: NBA_LG, sport: 'nba', dayEt: '2031-12-20', now: new Date('2031-12-20T10:00:00Z') });
  assert.equal(thin.plan, null);
  assert.equal(thin.reason, 'thin-slate');
  await mk('cn-two-c', '2031-12-20T22:00:00Z');
  const three = await nbaDayBoardPlan({ leagueSlug: NBA_LG, sport: 'nba', dayEt: '2031-12-20', now: new Date('2031-12-20T10:00:00Z') });
  assert.equal(three.plan.board.length, 3);
  assert.equal(three.plan.confidence, true);
  // a sport that is not one of the three never stamps, so the old any-night rule stands for it
  const other = await nbaDayBoardPlan({ leagueSlug: NBA_LG, sport: NBA_LG, dayEt: '2031-12-20', now: new Date('2031-12-20T10:00:00Z') });
  assert.equal(other.plan.confidence, false);
});

test('REGULAR LEAGUES STILL SCORE WINS through the real query: a confidence board adds its correct picks', async () => {
  const { loadLeagueResults } = await import('../leagues/results.js');
  const lg = { starts_at: null, span: 'season', games: ['pickem'], gameRows: [{ game_type: 'pickem', sport: LG }] };
  const { results } = await loadLeagueResults(lg, [uA, uB]);
  const byUser = (u, week) => results.filter((r) => r.userId === u && r.period === `2031-w${week}`).map((r) => r.score);
  const [{ week }] = await sql`SELECT week FROM contests WHERE id = ${contestId}`;
  // the confidence board: A has g1 + g2 right (after the re-grade) = 2 WINS, never 3 points; B has g1 + g4 = 2
  assert.deepEqual(byUser(uA, week), [2]);
  assert.deepEqual(byUser(uB, week), [2]);
  // the regular board beside it is read exactly as before
  assert.deepEqual(byUser(uA, 98), [3]);
});
