// lib/house/october.test.mjs - the house files October through the reader's door.
//
// AGAINST DEV, AND OFFLINE. The pool is seeded into the sentinel contest's
// meta.pool, which is exactly where octoberPool() caches it, so this exercises
// the REAL saveOctoberPick and the REAL refuseReason without a single provider
// call. Sentinel contest and sentinel users, deleted in after(), teardown
// asserting itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.join(REPO, '.env.local'));

const { sql } = await import('../db.js');
const { fileOctober, fileOctoberDay } = await import('./october.js');
const { SLOTS, CARD_SIZE, maxPerGame, dayState, DNF } = await import('../october/rules.js');
const { PERSONAS, playsGame } = await import('./personas.js');

const MARK = fixtureMark('houseoct');
const DAY = '2097-10-05';
// FAR ENOUGH AHEAD THAT NOTHING IS LOCKED. Each slot locks at its own game's
// first pitch, so a card filed against a past slate would be refused, not short.
const KO = (h) => new Date(`2097-10-05T${String(h).padStart(2, '0')}:05:00Z`).toISOString();

/** Three games, so the day's cap is ceil(5/3) = 2 - a cap that BINDS. */
const BOARD = [
  { match_id: 9000001, slug: 'a-at-b', kickoff_at: KO(18), home: { abbr: 'ATL' }, away: { abbr: 'PHI' } },
  { match_id: 9000002, slug: 'c-at-d', kickoff_at: KO(20), home: { abbr: 'NYY' }, away: { abbr: 'TB' } },
  { match_id: 9000003, slug: 'e-at-f', kickoff_at: KO(22), home: { abbr: 'SEA' }, away: { abbr: 'DET' } },
];

/** A pool wide enough that a legal five EXISTS, and cheap enough to inline. */
const P = (id, kind, matchId, ppg, team) => ({
  playerId: String(id), name: `Player ${id}`, short: `P. ${id}`, kind, matchId, ppg, team,
});
const POOL = {
  byGame: {
    9000001: [P(101, 'arm', 9000001, 20, 'PHI'), P(102, 'bat', 9000001, 12, 'ATL'), P(103, 'bat', 9000001, 11, 'PHI')],
    9000002: [P(201, 'arm', 9000002, 18, 'TB'), P(202, 'bat', 9000002, 10, 'NYY'), P(203, 'bat', 9000002, 9, 'TB')],
    9000003: [P(301, 'arm', 9000003, 16, 'DET'), P(302, 'bat', 9000003, 8, 'SEA'), P(303, 'bat', 9000003, 7, 'DET')],
  },
};

const NOW = new Date('2097-10-05T12:00:00Z');
let contestId = null;
let soloUser = null;

const mkContest = async (pool) => {
  const [c] = await sql`
    INSERT INTO contests (game_type, sport, season_year, puzzle_date, board, opens_at, locks_at, settles_at, meta)
    VALUES ('october', 'mlb', 2097, ${DAY}, ${JSON.stringify(BOARD)}::jsonb,
            ${NOW.toISOString()}, ${KO(22)}, ${KO(22)},
            ${JSON.stringify({ stage: 'wild_card', games: 3, pool })}::jsonb)
    RETURNING id, board, season_year, meta, puzzle_date`;
  return c;
};

before(async () => {
  // A run that died before its teardown leaves the sentinel day behind, and
  // (game_type, sport, puzzle_date) is UNIQUE - so the next run's INSERT would
  // fail in `before`, turning one orphan into a fileful of red tests.
  const stale = await sql`SELECT id FROM contests WHERE game_type = 'october' AND sport = 'mlb' AND puzzle_date = ${DAY}`;
  for (const c of stale) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ${c.id}`;
    await sql`DELETE FROM contests WHERE id = ${c.id}`;
  }
  await sql`DELETE FROM users WHERE email LIKE ${MARK.like}`;
  const [u] = await sql`
    INSERT INTO users (email, handle) VALUES (${MARK.email('solo')}, ${MARK.handle('solo')}) RETURNING id`;
  soloUser = u.id;
});

after(async () => {
  if (contestId) await sql`DELETE FROM contest_entries WHERE contest_id = ${contestId}`;
  if (contestId) await sql`DELETE FROM contests WHERE id = ${contestId}`;
  await sql`DELETE FROM users WHERE email LIKE ${MARK.like}`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM contests WHERE id = ${contestId}) AS contests,
           (SELECT count(*)::int FROM users WHERE email LIKE ${MARK.like}) AS users,
           (SELECT count(*)::int FROM contest_entries WHERE contest_id = ${contestId}) AS entries`;
  assert.equal(left.contests, 0, 'the sentinel day is removed');
  assert.equal(left.users, 0, 'the sentinel user is removed');
  assert.equal(left.entries, 0, 'and no entry outlives its contest');
});

/** Every rule a card must satisfy, checked against the stored lineup. */
function assertLegal(lineup, board, who) {
  const slots = Object.keys(lineup);
  assert.ok(slots.length >= 1, `${who}: filed something`);
  for (const s of slots) assert.ok(SLOTS.includes(s), `${who}: ${s} is a real slot`);
  // ONE ARM, FOUR BATS - the shape of the card.
  if (lineup.arm) assert.equal(lineup.arm.kind, 'arm', `${who}: the arm slot holds an arm`);
  for (const s of ['bat1', 'bat2', 'bat3', 'bat4']) {
    if (lineup[s]) assert.equal(lineup[s].kind, 'bat', `${who}: ${s} holds a bat`);
  }
  // THE DAY'S CAP, which on this three-game board is 2.
  const byGame = new Map();
  for (const s of slots) {
    const k = String(lineup[s].matchId);
    byGame.set(k, (byGame.get(k) ?? 0) + 1);
  }
  for (const [k, n] of byGame) {
    assert.ok(n <= maxPerGame(board), `${who}: ${n} from game ${k} exceeds the cap of ${maxPerGame(board)}`);
  }
  // NO PLAYER TWICE.
  const ids = slots.map((s) => String(lineup[s].playerId));
  assert.equal(new Set(ids).size, ids.length, `${who}: no player twice on one card`);
}

test('A CREATED DAY HAS THE HOUSE ROWS, and every one is legal under the cap', async () => {
  const contest = await mkContest(POOL);
  contestId = contest.id;
  const out = await fileOctoberDay(contest, { now: NOW });

  const playing = PERSONAS.filter((p) => playsGame(p.key, 'october')).map((p) => p.key);
  assert.ok(playing.length >= 2, 'more than one persona plays October');

  const rows = await sql`
    SELECT e.user_id, e.lineup, u.handle, u.is_house
      FROM contest_entries e JOIN users u ON u.id = e.user_id
     WHERE e.contest_id = ${contestId}`;
  assert.equal(rows.length, playing.length, 'one row per persona that plays');
  assert.equal(rows.every((r) => r.is_house === true), true, 'and every one is marked house');

  for (const r of rows) {
    assertLegal(r.lineup, contest.board, r.handle);
    // A FULL CARD IS REACHABLE on this pool, and the filer got there.
    assert.equal(Object.keys(r.lineup).length, CARD_SIZE, `${r.handle}: five slots`);
    // THE CLUB AND THE NAME ARE ON EVERY PICK. The card's slot sub-line reads
    // s.team ("PIT · 7:40 PM"); pickOctober's fill() dropped `team` and the first
    // house rows filed on PROD showed a blank club beside every name.
    for (const s of Object.keys(r.lineup)) {
      assert.ok(r.lineup[s].team, `${r.handle}: ${s} carries its club`);
      assert.ok(r.lineup[s].name, `${r.handle}: ${s} carries a name`);
      assert.equal(typeof r.lineup[s].matchId, 'number', `${r.handle}: ${s} matchId is a number`);
    }
  }
  // THE SUMMARY AGREES WITH THE DATABASE.
  for (const key of playing) {
    assert.equal(out.filed[key].ok, true, `${key}: filed ok`);
    assert.equal(out.filed[key].filed, CARD_SIZE, `${key}: five`);
    assert.equal(out.filed[key].short, false, `${key}: not short`);
    assert.equal(out.filed[key].cap, 2, `${key}: the cap it played under`);
  }
  // A PERSONA WITH NO METHOD HAS NO ROW (ruling R1) - not an empty one.
  for (const p of PERSONAS) {
    if (playsGame(p.key, 'october')) continue;
    assert.equal(out.filed[p.key].skipped, 'does not play', `${p.key} is skipped`);
    assert.equal(rows.some((r) => r.handle === p.handle), false, `${p.key} has no row`);
  }
});

test('NO PRIVATE INSERT: every pick is a saveOctoberPick, and the door is the only writer', () => {
  const src = readFileSync(path.join(REPO, 'lib/house/october.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // THE TEMPTATION IS ONE INSERT WITH A WHOLE LINEUP IN IT, and that would be a
  // second writer able to file a card the rules forbid.
  assert.doesNotMatch(src, /INSERT\s+INTO/i, 'the filer writes no rows of its own');
  assert.doesNotMatch(src, /UPDATE\s+contest_entries/i);
  assert.match(src, /saveOctoberPick\(/, 'it goes through the door');
  // AND THE DOOR IS THE ONE THE CARD USES.
  const action = readFileSync(path.join(REPO, 'app/actions/october.js'), 'utf8');
  assert.match(action, /saveOctoberPick/, 'the same function the card calls');
});

test("A SHORT CARD IS FILED SHORT AND DNFs - the house takes the reader's consequence", async () => {
  // A pool with ONE bat in it: the arm and one bat are legal, the other three
  // bat slots have no candidate at all.
  const thin = { byGame: { 9000001: [P(401, 'arm', 9000001, 20, 'PHI'), P(402, 'bat', 9000001, 12, 'ATL')] } };
  const contest = { id: contestId, board: BOARD, season_year: 2097, meta: { pool: thin } };
  const r = await fileOctober({ userId: soloUser, personaKey: 'chalk', contest, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.filed, 2, 'two slots, because only two legal players exist');
  assert.equal(r.short, true, 'and it says so');

  const [row] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${soloUser}`;
  assert.equal(Object.keys(row.lineup).length, 2, 'the row is short, not padded');
  assertLegal(row.lineup, BOARD, 'chalk-thin');
  // AND THAT IS A DNF ONCE THE LAST FIRST PITCH PASSES - the same rule that
  // catches a reader who left a slot empty. No fallback, no filler.
  assert.equal(dayState(row.lineup, BOARD, new Date('2097-10-05T23:00:00Z')).state, DNF);
  // While games are still to come it is simply OPEN, not yet a DNF.
  assert.notEqual(dayState(row.lineup, BOARD, NOW).state, DNF);
});

test('THE CAP BINDS THE HOUSE: a pool concentrated in one game files two, not five', async () => {
  // EVERY CANDIDATE IN ONE GAME, on a three-game board whose cap is 2. The house
  // wants five and the day allows two from that game, so it files two and goes
  // short - which is what a reader with the same pool would get.
  //
  // THIS IS THE DOOR DOING IT, not the picker being polite. Deleting the
  // refuseReason filter from candidates() (lib/house/pickOctober.js) does not
  // produce an illegal card here: saveOctoberPick refuses the third, fourth and
  // fifth, and the row stays legal and short. That is the whole reason the house
  // files through the door instead of inserting a lineup.
  const oneGame = {
    byGame: {
      9000001: [
        P(501, 'arm', 9000001, 20, 'PHI'), P(502, 'bat', 9000001, 12, 'ATL'),
        P(503, 'bat', 9000001, 11, 'PHI'), P(504, 'bat', 9000001, 10, 'ATL'),
        P(505, 'bat', 9000001, 9, 'PHI'),
      ],
    },
  };
  const contest = { id: contestId, board: BOARD, season_year: 2097, meta: { pool: oneGame } };
  const r = await fileOctober({ userId: soloUser, personaKey: 'chalk', contest, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.cap, 2, 'three games, so ceil(5/3)');
  assert.equal(r.filed, 2, 'the cap, not the card');
  assert.equal(r.short, true);

  const [row] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${soloUser}`;
  assertLegal(row.lineup, BOARD, 'chalk-onegame');
  const fromGame = Object.values(row.lineup).filter((p) => String(p.matchId) === '9000001').length;
  assert.equal(fromGame, 2, 'exactly the cap reached the database');
});

test('THE GUT IS DETERMINISTIC PER CONTEST: filing twice files the same five', async () => {
  // Creation is idempotent, so a second pass must not produce a different card -
  // otherwise the house's entry would depend on how often an importer ran.
  const contest = { id: contestId, board: BOARD, season_year: 2097, meta: { pool: POOL } };
  const a = await fileOctober({ userId: soloUser, personaKey: 'gut', contest, now: NOW });
  const [first] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${soloUser}`;
  const b = await fileOctober({ userId: soloUser, personaKey: 'gut', contest, now: NOW });
  const [second] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${soloUser}`;
  assert.equal(a.filed, b.filed);
  assert.deepEqual(first.lineup, second.lineup, 'the same five, twice');
});

test('DAY CREATION CALLS THE FILER, and cannot be taken down by it', () => {
  const src = readFileSync(path.join(REPO, 'lib/october/create.js'), 'utf8');
  assert.match(src, /fileOctoberDay/, 'ensureOctoberDay files the house');
  assert.match(src, /await import\('\.\.\/house\/october\.js'\)/, 'dynamically, so a no-op import costs nothing');
  // A HOUSE THAT CANNOT FILE IS MISSING ROWS; A THROW HERE IS A MISSING CARD.
  assert.match(src, /\.catch\(\(e\) => \(\{ error:/, 'and a failure cannot propagate');
});
