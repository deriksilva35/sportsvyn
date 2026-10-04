// lib/settle/settleRulesDb.test.mjs - the sat-5 football settle rulings
// against the database: the VOID rule (Weekly, Draft, Pick'em), the Draft's
// six-of-eight (D2), ties out of perfect.max (P4), the 7-day RE-GRADE, and the
// series-only scope (P5).
//
// HERMETIC: season 2097 week 77 in the real 'nfl' league (weekGames reads
// that slug and nothing else) on four sentinel teams srtest-*, and a Pick'em
// board on a sentinel sport. Every settle call is made on THIS file's own
// contest ids or scoped to its own sport - settleDue / footballSweep are never
// called here, because with a 2097 `now` they would settle real DEV boards.
// before() clears a killed run's leftovers by the same signatures; after()
// deletes by id and asserts its own teardown.

import { test, before, after } from 'node:test';
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
const { settleContest } = await import('../weekly/settle.js');
const { gradePickemBoard, settleDuePickem } = await import('../pickem/settle.js');
const { regradeRecent } = await import('./regrade.js');
const { savePick } = await import('../pickem/entry.js');
const { scoreSix } = await import('../draft/bestball.js');
const { scoreLineup } = await import('../daily/play.js');

const SEASON = 2097;
const WEEK = 77;
const PK_SPORT = 'srtest-pk';
const EMAILS = ['settlerules-test-a@example.invalid', 'settlerules-test-b@example.invalid'];
const TEAM_SLUGS = ['srtest-aaa', 'srtest-bbb', 'srtest-ccc', 'srtest-ddd'];
const H = 3_600_000;
const T1 = '2097-09-10T17:00:00Z'; // SRA@SRB, final
const T2 = '2097-09-10T20:00:00Z'; // SRC@SRD, postponed
const SETTLES = '2097-09-11T05:00:00Z';
const at = (base, hours) => new Date(Date.parse(base) + hours * H);
const BEFORE_CUT = at(SETTLES, 47);
// THE FIXTURE'S SETTLE HAPPENED IN ITS OWN 2097, not today: a re-grade only
// applies to a contest first settled on or after REGRADE_SETTLED_FROM, and a
// settle stamps now(). Each settle below is re-stamped to this instant so the
// file does not depend on the calendar it runs on.
const SETTLED_AT = '2097-09-13T12:00:00Z';
const restamp = (id) => sql`UPDATE contests SET settled_at = ${SETTLED_AT} WHERE id = ${id}`;
const AFTER_CUT = at(SETTLES, 49);

let leagueId; let pkLeagueId;
const teams = {}; const m = {}; const users = []; const contests = {};
let players = []; // [{id, name, pos, team}]

async function sweepLeftovers() {
  await sql`DELETE FROM contests WHERE season_year = ${SEASON} AND week = ${WEEK} AND sport IN ('nfl', ${PK_SPORT})`;
  await sql`DELETE FROM matches WHERE slug LIKE 'srtest-%'`;
  await sql`DELETE FROM teams WHERE slug = ANY(${TEAM_SLUGS}) OR slug LIKE 'srtest-pk-%'`;
  await sql`DELETE FROM leagues WHERE slug = ${PK_SPORT}`;
  await sql`DELETE FROM users WHERE email = ANY(${EMAILS})`;
}

// A stat row that is worth `rec_yds / 10 + rec` PPR to a receiver, or
// pass_yds / 25 to a QB - simple enough to reason about in the asserts.
async function stat(playerId, matchId, { pass_yds = 0, rec = 0, rec_yds = 0 } = {}) {
  await sql`
    INSERT INTO nfl_player_game_stats (match_id, nfl_player_id, pass_yds, rec, rec_yds)
    VALUES (${matchId}, ${playerId}, ${pass_yds}, ${rec}, ${rec_yds})
    ON CONFLICT (match_id, nfl_player_id) DO UPDATE SET pass_yds = EXCLUDED.pass_yds, rec = EXCLUDED.rec, rec_yds = EXCLUDED.rec_yds`;
}

before(async () => {
  await sweepLeftovers();
  leagueId = (await sql`SELECT id FROM leagues WHERE slug = 'nfl'`)[0].id;
  const abbr = { 'srtest-aaa': 'SRA', 'srtest-bbb': 'SRB', 'srtest-ccc': 'SRC', 'srtest-ddd': 'SRD' };
  for (const slug of TEAM_SLUGS) {
    teams[abbr[slug]] = (await sql`
      INSERT INTO teams (league_id, slug, name, short_name, abbreviation, external_ids, metadata)
      VALUES (${leagueId}, ${slug}, ${'Settle Test ' + abbr[slug]}, ${abbr[slug]}, ${abbr[slug]}, '{}'::jsonb, '{}'::jsonb)
      RETURNING id`)[0].id;
  }
  m.final = (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, week, external_ids, metadata)
    VALUES (${leagueId}, 'srtest-m-final', ${T1}, 'final', ${teams.SRB}, ${teams.SRA}, ${SEASON}, 'REG', ${WEEK}, '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)[0].id;
  m.post = (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, week, external_ids, metadata)
    VALUES (${leagueId}, 'srtest-m-post', ${T2}, 'postponed', ${teams.SRD}, ${teams.SRC}, ${SEASON}, 'REG', ${WEEK}, '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)[0].id;

  // Real player ids (the stats table keys on nfl_players), our own teams.
  const pick = async (pos, n) => (await sql`
    SELECT id, full_name AS name, position AS pos FROM nfl_players WHERE position = ${pos} ORDER BY id LIMIT ${n}`);
  const [qb, rb, wr, te] = await Promise.all([pick('QB', 2), pick('RB', 3), pick('WR', 3), pick('TE', 2)]);
  // Final game (SRA/SRB): QB0, RB0, RB1, WR0, WR1, TE0. Postponed (SRC/SRD): QB1, RB2, WR2, TE1.
  const onFinal = [qb[0], rb[0], rb[1], wr[0], wr[1], te[0]].map((p, i) => ({ ...p, team: i % 2 ? 'SRB' : 'SRA' }));
  const onPost = [qb[1], rb[2], wr[2], te[1]].map((p, i) => ({ ...p, team: i % 2 ? 'SRD' : 'SRC' }));
  players = [...onFinal, ...onPost];
  const P = Object.fromEntries(players.map((p) => [p.id, p]));
  players.P = P;
  // Final-game points: QB0 10 (250 pass yds), RB0 12, RB1 4, WR0 20, WR1 8, TE0 6.
  await stat(qb[0].id, m.final, { pass_yds: 250 });
  await stat(rb[0].id, m.final, { rec: 2, rec_yds: 100 });
  await stat(rb[1].id, m.final, { rec: 1, rec_yds: 30 });
  await stat(wr[0].id, m.final, { rec: 5, rec_yds: 150 });
  await stat(wr[1].id, m.final, { rec: 2, rec_yds: 60 });
  await stat(te[0].id, m.final, { rec: 1, rec_yds: 50 });
  // THE POSTPONED GAME CARRIES A PARTIAL LINE (a suspended game): it must
  // still score 0 once the game is void.
  await stat(wr[2].id, m.post, { rec: 9, rec_yds: 200 });

  for (const email of EMAILS) {
    users.push((await sql`INSERT INTO users (email) VALUES (${email}) RETURNING id`)[0].id);
  }
  const board = players.map(({ id, name, pos, team }) => ({ id, name, pos, team }));
  const mk = async (gameType, meta = {}) => (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES (${gameType}, 'nfl', ${SEASON}, ${WEEK}, ${JSON.stringify(board)}::jsonb,
            '2097-09-01T13:00:00Z', ${T1}, ${SETTLES}, ${JSON.stringify(meta)}::jsonb)
    RETURNING id`)[0].id;
  contests.weekly = await mk('weekly');
  contests.draft = await mk('draft');

  // WEEKLY ENTRY: QB0, RB0, WR0, TE0, FLEX WR1, FLEX2 = WR2 (the void game's).
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${contests.weekly}, ${users[0]}, ${JSON.stringify({
      QB: qb[0].id, RB: rb[0].id, WR: wr[0].id, TE: te[0].id, FLEX: wr[1].id, FLEX2: wr[2].id,
    })}::jsonb)`;
  // DRAFT ENTRY: an eight-man roster, no draftId (no room) - best ball fills six.
  const roster = [qb[0], rb[0], rb[1], wr[0], wr[1], te[0], wr[2], rb[2]].map((p) => ({ id: p.id, pos: p.pos }));
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, meta)
    VALUES (${contests.draft}, ${users[0]}, '{}'::jsonb, ${JSON.stringify({ roster })}::jsonb)`;

  // PICK'EM: its own sentinel league (sport) and three games - a home win, a
  // tie and a postponement.
  pkLeagueId = (await sql`
    INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${PK_SPORT}, 'Settle Rules Test', 'nfl', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const tH = (await sql`INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
    VALUES (${pkLeagueId}, 'srtest-pk-h', 'Homers', 'Homers', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const tA = (await sql`INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
    VALUES (${pkLeagueId}, 'srtest-pk-a', 'Roaders', 'Roaders', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const g = async (slug, ko, status, hs, as) => (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, home_score, away_score,
                         season_year, season_phase, week, external_ids, metadata)
    VALUES (${pkLeagueId}, ${slug}, ${ko}, ${status}, ${tH}, ${tA}, ${hs}, ${as}, ${SEASON}, 'REG', ${WEEK}, '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)[0].id;
  m.pkWin = await g('srtest-pk-win', T1, 'final', 24, 17);
  m.pkTie = await g('srtest-pk-tie', T1, 'final', 20, 20);
  m.pkPost = await g('srtest-pk-post', T2, 'postponed', null, null);
  const pkBoard = [m.pkWin, m.pkTie, m.pkPost].map((id, i) => ({
    match_id: id, slug: `srtest-pk-${i}`, kickoff_at: i === 2 ? T2 : T1, home: 'Homers', away: 'Roaders',
    home_team_id: tH, away_team_id: tA,
  }));
  contests.pickem = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at)
    VALUES ('pickem', ${PK_SPORT}, ${SEASON}, ${WEEK}, ${JSON.stringify(pkBoard)}::jsonb,
            '2097-09-01T13:00:00Z', ${T2}, ${SETTLES})
    RETURNING id`)[0].id;
  // A picks home on all three; B picks away on the win and the tie.
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES
    (${contests.pickem}, ${users[0]}, ${JSON.stringify({ [m.pkWin]: 'home', [m.pkTie]: 'home', [m.pkPost]: 'home' })}::jsonb),
    (${contests.pickem}, ${users[1]}, ${JSON.stringify({ [m.pkWin]: 'away', [m.pkTie]: 'away' })}::jsonb)`;
});

after(async () => {
  const ids = Object.values(contests);
  await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${ids})`;
  await sql`DELETE FROM contests WHERE id = ANY(${ids})`;
  await sql`DELETE FROM matches WHERE id = ANY(${Object.values(m)})`; // cascades the stat rows
  await sql`DELETE FROM teams WHERE slug = ANY(${TEAM_SLUGS}) OR league_id = ${pkLeagueId}`;
  await sql`DELETE FROM leagues WHERE id = ${pkLeagueId}`;
  await sql`DELETE FROM users WHERE id = ANY(${users})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM contests WHERE id = ANY(${ids})) AS c,
           (SELECT count(*)::int FROM matches WHERE slug LIKE 'srtest-%') AS mt,
           (SELECT count(*)::int FROM nfl_player_game_stats WHERE match_id = ANY(${Object.values(m)})) AS s,
           (SELECT count(*)::int FROM users WHERE email = ANY(${EMAILS})) AS u`;
  assert.deepEqual(left, { c: 0, mt: 0, s: 0, u: 0 }, 'teardown left nothing behind');
});

const entryOf = async (cid, uid = users[0]) =>
  (await sql`SELECT score, lineup, meta FROM contest_entries WHERE contest_id = ${cid} AND user_id = ${uid}`)[0];
const contestOf = async (cid) => (await sql`SELECT * FROM contests WHERE id = ${cid}`)[0];

// ---- ruling 2: the void cutoff ---------------------------------------------

test('VOID: before settles_at + 48h a postponed game still holds the Weekly', async () => {
  const r = await settleContest(contests.weekly, { now: BEFORE_CUT });
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'games not final');
  assert.deepEqual(r.missing.map((x) => x.id), [m.post]);
});

test('VOID: after the cutoff the Weekly settles, the postponed game void and its players at 0', async () => {
  const r = await settleContest(contests.weekly, { now: AFTER_CUT });
  assert.equal(r.settled, true);
  await restamp(contests.weekly);
  assert.deepEqual(r.void, [m.post]);
  const c = await contestOf(contests.weekly);
  assert.deepEqual(c.meta.void, [m.post], 'the void list rides the contest');
  const wr2 = players.find((p) => p.team === 'SRC' && p.pos === 'WR');
  assert.equal(c.board.find((p) => p.id === wr2.id).points, 0, 'a void game\'s partial line scores nothing');
  // Lineup: QB0 10, RB0 12, WR0 20, TE0 6, WR1 8, WR2 0 -> the Weekly drops the 0.
  const e = await entryOf(contests.weekly);
  assert.equal(Number(e.score), 56);
  assert.equal(e.meta.droppedSlot, 'FLEX2', 'the Weekly keeps drop-worst');
});

test('D2 + VOID: the Draft counts all six of best ball\'s six - no extra drop', async () => {
  const r = await settleContest(contests.draft, { now: AFTER_CUT });
  assert.equal(r.settled, true);
  await restamp(contests.draft);
  const c = await contestOf(contests.draft);
  const e = await entryOf(contests.draft);
  // Best six of eight: QB0 10, RB0 12, WR0 20, TE0 6, FLEX WR1 8, FLEX2 RB1 4 = 60.
  assert.equal(Number(e.score), 60, 'six count: 10+12+20+6+8+4');
  assert.equal(e.meta.droppedSlot, null, 'nothing dropped');
  assert.equal(Number(e.score), scoreSix(e.lineup, c.board).baseScore);
  assert.equal(scoreLineup(e.lineup, c.board).baseScore, 56, 'the old rule would have counted five');
  assert.equal(c.perfect.score, 60, 'the Draft ceiling is the best real entry under the same rule');
});

// ---- ruling 3: the 7-day re-grade ------------------------------------------

test('RE-GRADE: a correction inside 7 days re-scores; settled_at stays; regraded_at stamps', async () => {
  const first = (await contestOf(contests.weekly)).settled_at;
  const wr0 = players.find((p) => p.team === 'SRB' && p.pos === 'WR') ?? players.filter((p) => p.pos === 'WR')[0];
  await stat(wr0.id, m.final, { rec: 5, rec_yds: 250 }); // +10
  const now = at(T1, 6 * 24);
  const r = await regradeRecent({ now });
  const mine = r.results.filter((x) => x.contestId === contests.weekly || x.contestId === contests.draft);
  assert.equal(mine.length, 2, 'both settled weeks are in the window');
  assert.ok(mine.every((x) => x.regraded === true));
  const c = await contestOf(contests.weekly);
  assert.equal(new Date(c.settled_at).getTime(), new Date(first).getTime(), 'settled_at is the first settle');
  assert.equal(c.meta.regraded_at, now.toISOString());
  assert.deepEqual(c.meta.void, [m.post], 'the void list survives the re-grade');
  assert.equal(Number((await entryOf(contests.weekly)).score), 66);
  assert.equal(Number((await entryOf(contests.draft)).score), 70);
});

test('a contest settled before the ruling is never re-graded', async () => {
  await sql`UPDATE contests SET settled_at = '2026-09-29T14:00:00Z' WHERE id = ${contests.weekly}`;
  const r = await settleContest(contests.weekly, { now: at(T1, 6 * 24), regrade: true });
  assert.equal(r.reason, 'settled before the re-grade ruling');
  const sweep = await regradeRecent({ now: at(T1, 6 * 24) });
  assert.equal(sweep.results.some((x) => x.contestId === contests.weekly), false);
  await restamp(contests.weekly);
});

test('RE-GRADE is idempotent: nothing moved, nothing written', async () => {
  const r = await settleContest(contests.weekly, { now: at(T1, 6 * 24 + 1), regrade: true });
  assert.equal(r.regraded, false);
  assert.equal(r.reason, 'unchanged');
});

test('RE-GRADE never un-voids: a postponed game played later still scores 0', async () => {
  await sql`UPDATE matches SET status = 'final' WHERE id = ${m.post}`;
  const wr2 = players.find((p) => p.team === 'SRC' && p.pos === 'WR');
  await stat(wr2.id, m.post, { rec: 10, rec_yds: 300 });
  const r = await settleContest(contests.weekly, { now: at(T1, 6 * 24 + 2), regrade: true });
  assert.equal(r.reason, 'unchanged');
  await sql`UPDATE matches SET status = 'postponed' WHERE id = ${m.post}`;
});

test('RE-GRADE window: 8 days after kickoff the game is frozen', async () => {
  const wr0 = players.filter((p) => p.pos === 'WR')[0];
  await stat(wr0.id, m.final, { rec: 5, rec_yds: 500 });
  const r = await settleContest(contests.weekly, { now: at(T1, 8 * 24), regrade: true });
  assert.equal(r.regraded, false, 'a correction past 7 days moves nothing');
  assert.equal(Number((await entryOf(contests.weekly)).score), 66);
  const sweep = await regradeRecent({ now: at(T2, 8 * 24) });
  assert.equal(sweep.results.some((x) => x.contestId === contests.weekly), false, 'out of the sweep entirely');
});

// ---- Pick'em: void, ties (P4), re-grade, series scope (P5) ------------------

test('PICKEM: before the cutoff the postponed game holds the board', async () => {
  const [c] = await sql`SELECT * FROM contests WHERE id = ${contests.pickem}`;
  const r = await gradePickemBoard(c, { now: BEFORE_CUT });
  assert.equal(r.settled, false);
  assert.equal(r.remaining, 1);
});

test('a postponed football game refuses a pick as OFF, not merely kicked', async () => {
  const r = await savePick(users[1], contests.pickem, m.pkPost, 'home', { now: new Date('2097-09-05T12:00:00Z') });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'game_off');
});

test('P5: the series-only scope never touches a football board', async () => {
  const r = await settleDuePickem({ now: AFTER_CUT, sport: PK_SPORT, only: 'series' });
  assert.deepEqual(r.results, []);
  assert.equal((await contestOf(contests.pickem)).settled, false);
});

test('PICKEM: after the cutoff - void and tie both count for nobody and leave perfect.max', async () => {
  const r = await settleDuePickem({ now: AFTER_CUT, sport: PK_SPORT, only: 'football' });
  const mine = r.results.find((x) => x.contestId === contests.pickem);
  assert.equal(mine.settled, true);
  await restamp(contests.pickem);
  const c = await contestOf(contests.pickem);
  assert.equal(c.perfect.max, 1, 'only the game with a winner counts');
  assert.deepEqual(c.perfect.void, [m.pkPost]);
  assert.equal(c.perfect.results[String(m.pkTie)], null, 'the tie has no winner');
  assert.equal(Number((await entryOf(contests.pickem, users[0])).score), 1);
  assert.equal(Number((await entryOf(contests.pickem, users[1])).score), 0);
});

test('PICKEM RE-GRADE: a score correction within 7 days flips the result; then idempotent; then frozen', async () => {
  await sql`UPDATE matches SET home_score = 17, away_score = 24 WHERE id = ${m.pkWin}`;
  const now = at(T1, 3 * 24);
  const r = await regradeRecent({ now });
  const mine = r.results.find((x) => x.contestId === contests.pickem);
  assert.equal(mine.regraded, true);
  const c = await contestOf(contests.pickem);
  assert.equal(c.perfect.results[String(m.pkWin)], 'away');
  assert.equal(c.perfect.regraded_at, now.toISOString());
  assert.equal(c.perfect.max, 1);
  assert.equal(Number((await entryOf(contests.pickem, users[0])).score), 0);
  assert.equal(Number((await entryOf(contests.pickem, users[1])).score), 1);

  const again = await gradePickemBoard(c, { now: at(T1, 3 * 24 + 1), regrade: true });
  assert.equal(again.reason, 'unchanged');

  await sql`UPDATE matches SET home_score = 30, away_score = 0 WHERE id = ${m.pkWin}`;
  const late = await gradePickemBoard(await contestOf(contests.pickem), { now: at(T1, 8 * 24), regrade: true });
  assert.equal(late.reason, 'unchanged', 'eight days on, the stored result stands');
});
