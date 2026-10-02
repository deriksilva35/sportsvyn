// lib/nba/dayPickemDb.test.mjs - THE DEV REPLAY of one NBA Pick'em day.
//
// A sentinel league (slug carries "test", so scripts/dev-orphan-sweep.mjs sees
// any leftover), four games - three on ET day 2097-10-22, one the next day -
// two sentinel users, and the whole day run through the real paths: the
// board's creation and its open gate, savePick, a tip moved EARLIER under the
// lock, a tip moved LATER past the frozen one, a pick made late by a tip that
// moved after it, a cancelled game, finals, and settleDuePickem.
//
// The board's sport is the league's slug ('nbapicktest'), not 'nba': every
// day-board path keys on meta.day_board and the sport it is handed, so the
// sentinel never touches - and can never be read as - the real NBA board.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../db.js';
import { ensureNbaDayBoard, nbaDayBoardPlan, refreshDayBoardLocks, dayKey } from './dayPickem.js';
import { savePick, pickemBoardView } from '../pickem/entry.js';
import { settleDuePickem } from '../pickem/settle.js';
import { currentPickemBoard } from '../pickem/sequence.js';
import { pickemTable } from '../games/read.js';

const LG = 'nbapicktest';
const DAY = '2097-10-22';
const EMAIL = { a: 'nba-pickem-a@sportsvyn.test', b: 'nba-pickem-b@sportsvyn.test' };
// EDT in October: 23:00Z = 7 PM ET on the 22nd, 02:30Z the 23rd = 10:30 PM ET the 22nd.
const TIP = {
  g1: '2097-10-22T23:00:00.000Z',
  g2: '2097-10-23T00:30:00.000Z',
  g3: '2097-10-23T02:30:00.000Z',
  next: '2097-10-23T23:00:00.000Z', // the 23rd ET - not on the board
};
const at = (iso) => new Date(iso);
let leagueId; const teams = {}; const m = {}; const users = {}; let contestId;

async function teardown() {
  await sql`DELETE FROM contest_entries WHERE contest_id IN (SELECT id FROM contests WHERE sport = ${LG})`;
  await sql`DELETE FROM contests WHERE sport = ${LG}`;
  const old = await sql`SELECT id FROM leagues WHERE slug = ${LG}`;
  for (const l of old) {
    await sql`DELETE FROM matches WHERE league_id = ${l.id}`;
    await sql`DELETE FROM teams WHERE league_id = ${l.id}`;
    await sql`DELETE FROM leagues WHERE id = ${l.id}`;
  }
  await sql`DELETE FROM users WHERE email = ANY(${Object.values(EMAIL)})`;
}

before(async () => {
  await teardown();
  leagueId = (await sql`INSERT INTO leagues (slug, name, sport) VALUES (${LG}, 'NBA Pickem Test', 'basketball') RETURNING id`)[0].id;
  for (const abbr of ['PHI', 'NYK', 'GSW', 'LAL', 'OKC', 'SAS', 'BOS', 'DET']) {
    teams[abbr] = (await sql`INSERT INTO teams (league_id, slug, name, short_name, abbreviation, external_ids, metadata)
      VALUES (${leagueId}, ${`${LG}-${abbr.toLowerCase()}`}, ${abbr}, ${abbr}, ${abbr}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  }
  const mk = async (slug, away, home, ko) => (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, external_ids, metadata)
    VALUES (${leagueId}, ${`${LG}-${slug}`}, ${ko}, 'scheduled', ${teams[home]}, ${teams[away]}, 2097, 'REG', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  m.g1 = await mk('phi-nyk', 'PHI', 'NYK', TIP.g1);
  m.g2 = await mk('gsw-lal', 'GSW', 'LAL', TIP.g2);
  m.g3 = await mk('okc-sas', 'OKC', 'SAS', TIP.g3);
  m.next = await mk('bos-det', 'BOS', 'DET', TIP.next);
  for (const [k, email] of Object.entries(EMAIL)) {
    users[k] = (await sql`INSERT INTO users (email) VALUES (${email}) RETURNING id`)[0].id;
  }
});

after(async () => {
  await teardown();
  const left = await sql`SELECT count(*)::int AS n FROM leagues WHERE slug = ${LG}`;
  assert.equal(left[0].n, 0, 'the sentinel league is gone');
});

const entryOf = async (uid) => (await sql`
  SELECT lineup, meta, score FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${uid}`)[0];
const move = (id, iso) => sql`UPDATE matches SET kickoff_at = ${iso} WHERE id = ${id}`;
const tipOf = async (id) => new Date((await sql`SELECT kickoff_at FROM matches WHERE id = ${id}`)[0].kickoff_at).toISOString();

test('one NBA day, start to finish, against DEV', async (t) => {
  await t.test('the plan is the ET day: three games, the next day left off, keyed YYYYMMDD', async () => {
    const { plan } = await nbaDayBoardPlan({ leagueSlug: LG, dayEt: DAY, now: at('2097-10-22T05:00:00Z') });
    assert.deepEqual(plan.board.map((g) => g.match_id), [m.g1, m.g2, m.g3]);
    assert.equal(plan.week, dayKey(DAY));
    assert.equal(plan.opensAt.toISOString(), '2097-10-22T10:00:00.000Z', '6 AM EDT');
    assert.equal(plan.locksAt.toISOString(), TIP.g3, 'the window closes on the last tip');
  });

  await t.test('the board does not open before 6 AM ET, opens after, and only once', async () => {
    const early = await ensureNbaDayBoard({ leagueSlug: LG, dayEt: DAY, now: at('2097-10-22T09:00:00Z') });
    assert.equal(early.reason, 'before-open');
    const made = await ensureNbaDayBoard({ leagueSlug: LG, dayEt: DAY, now: at('2097-10-22T11:00:00Z') });
    assert.equal(made.created, true); assert.equal(made.games, 3);
    contestId = made.id;
    const again = await ensureNbaDayBoard({ leagueSlug: LG, dayEt: DAY, now: at('2097-10-22T12:00:00Z') });
    assert.deepEqual([again.created, again.reason, again.id], [false, 'exists', contestId]);
    const [c] = await sql`SELECT sport, week, meta FROM contests WHERE id = ${contestId}`;
    assert.deepEqual([c.sport, c.week, c.meta], [LG, 20971022, { day_board: true, day_et: DAY }]);
  });

  await t.test('picks save and are stamped; a sport-less reader never sees the day board', async () => {
    const noon = at('2097-10-22T12:00:00Z');
    assert.equal((await savePick(users.a, contestId, m.g1, 'home', { now: noon })).ok, true);
    assert.equal((await savePick(users.a, contestId, m.g2, 'away', { now: noon })).ok, true);
    assert.equal((await savePick(users.a, contestId, m.g3, 'home', { now: noon })).ok, true);
    assert.equal((await savePick(users.b, contestId, m.g1, 'away', { now: noon })).ok, true);
    assert.equal((await savePick(users.b, contestId, m.g3, 'away', { now: noon })).ok, true);
    const a = await entryOf(users.a);
    assert.deepEqual(a.lineup, { [m.g1]: 'home', [m.g2]: 'away', [m.g3]: 'home' });
    assert.equal(a.meta.picked_at[m.g3], noon.toISOString());
    assert.equal((await savePick(users.a, contestId, m.next, 'home', { now: noon })).reason, 'not_on_board');
    const lead = await currentPickemBoard({ sport: null, now: at('2097-10-22T12:00:00Z') });
    assert.notEqual(lead?.id, contestId, 'a football surface asking for "the board" is not handed an NBA day');
    assert.equal((await currentPickemBoard({ sport: LG, now: noon })).id, contestId);
  });

  await t.test('A TIP MOVED EARLIER LOCKS EARLIER: the save reads the row, not the snapshot', async () => {
    await move(m.g2, '2097-10-22T22:00:00Z');
    const r = await savePick(users.a, contestId, m.g2, 'home', { now: at('2097-10-22T22:30:00Z') });
    assert.equal(r.reason, 'game_locked', 'the snapshot still says 00:30Z; the row says 22:00Z');
    assert.equal(r.kickoffAt, '2097-10-22T22:00:00.000Z');
    assert.equal((await entryOf(users.a)).lineup[m.g2], 'away', 'the refused change did not land');
  });

  await t.test('A TIP MOVED LATER STAYS OPEN past the frozen tip, and the view draws the moved tip', async () => {
    await move(m.g3, '2097-10-23T03:30:00Z');
    const r = await savePick(users.a, contestId, m.g3, 'away', { now: at('2097-10-23T03:00:00Z') });
    assert.equal(r.ok, true, '03:00Z is after the frozen 02:30Z tip and before the real 03:30Z one');
    const v = await pickemBoardView(users.a, { sport: LG, now: at('2097-10-23T03:00:00Z') });
    const g3 = v.games.find((g) => g.match_id === m.g3);
    assert.deepEqual([g3.kickoff_at, g3.kicked, g3.my_side], ['2097-10-23T03:30:00.000Z', false, 'away']);
    assert.equal(v.games.find((g) => g.match_id === m.g2).kicked, true);
    assert.equal(v.contest.dayEt, DAY);
    assert.deepEqual(await refreshDayBoardLocks({ sport: LG }).then((rs) => rs.map((x) => [x.id, new Date(x.locks_at).toISOString()])),
      [[contestId, '2097-10-23T03:30:00.000Z']], 'the window follows the last tip');
  });

  await t.test('the board does not settle while a game is unfinished', async () => {
    await sql`UPDATE matches SET status = 'final', home_score = 110, away_score = 100 WHERE id = ${m.g1}`;
    const r = await settleDuePickem({ sport: LG, now: at('2097-10-23T06:00:00Z') });
    assert.deepEqual(r.results.map((x) => [x.contestId, x.settled, x.remaining]), [[contestId, false, 2]]);
  });

  await t.test('a cancelled game cannot be picked and is void at settle; a tip moved under a pick makes it late', async () => {
    await sql`UPDATE matches SET status = 'cancelled' WHERE id = ${m.g2}`;
    assert.equal((await savePick(users.b, contestId, m.g2, 'home', { now: at('2097-10-22T12:00:00Z') })).reason, 'game_off');
    // A's 03:00Z change to g3 was legal against a 03:30Z tip. The game in fact
    // tipped at 02:45Z - before A's pick - and the feed says so after the fact.
    await move(m.g3, '2097-10-23T02:45:00Z');
    assert.equal(await tipOf(m.g3), '2097-10-23T02:45:00.000Z');
    await sql`UPDATE matches SET status = 'final', home_score = 99, away_score = 101 WHERE id = ${m.g3}`;
    const r = await settleDuePickem({ sport: LG, now: at('2097-10-23T06:00:00Z') });
    assert.deepEqual(r.results.map((x) => [x.contestId, x.settled, x.dayBoard, x.voided, x.late]), [[contestId, true, true, 1, 1]]);
  });

  await t.test('the grade: right picks count, void is nobody`s, the late pick is out of the lineup and kept aside', async () => {
    const [c] = await sql`SELECT settled, perfect FROM contests WHERE id = ${contestId}`;
    assert.equal(c.settled, true);
    assert.deepEqual(c.perfect, { results: { [m.g1]: 'home', [m.g2]: null, [m.g3]: 'away' }, max: 2, void: [m.g2] });
    const a = await entryOf(users.a);
    assert.equal(Number(a.score), 1, 'A: g1 right; g2 void; g3 picked after its real tip, so no pick');
    assert.deepEqual(a.lineup, { [m.g1]: 'home', [m.g2]: 'away' });
    assert.deepEqual(a.meta.late_picks[m.g3], { side: 'away', picked_at: '2097-10-23T03:00:00.000Z', tip: '2097-10-23T02:45:00.000Z' });
    assert.ok(a.meta.picked_at, 'the stamps survive the late_picks write (no shallow-merge loss)');
    const b = await entryOf(users.b);
    assert.equal(Number(b.score), 1, 'B: g1 wrong, g3 right on time');
    assert.equal(b.meta.late_picks, undefined);
  });

  await t.test('settle is idempotent, and the season table counts a void game for nobody', async () => {
    const again = await settleDuePickem({ sport: LG, now: at('2097-10-23T07:00:00Z') });
    assert.equal(again.due, 0);
    const table = await pickemTable(users.a, { sport: LG, limit: 10 });
    const rowA = table.top.find((r) => r.userId === users.a);
    assert.deepEqual([rowA.correct, rowA.played], [1, 1], 'g2 (void) is off the numerator and the denominator');
    const football = await pickemTable(users.a, { sport: null, limit: 50 }).catch(() => null);
    assert.ok(!(football?.top ?? []).some((r) => r.userId === users.a), 'the sport-less (football) season table leaves day boards out');
  });
});
