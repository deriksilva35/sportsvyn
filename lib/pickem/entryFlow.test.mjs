// lib/pickem/entryFlow.test.mjs - the living board's laws against the
// database. Hermetic like the builder's tests: own league slug, own users,
// an OCTOBER 2031 window (the builder file owns August 2031 - different
// windows so the two files cannot cross-adopt boards when the suite runs
// them in parallel), torn down whole.
//
// CALENDAR FACT PINNED: Mon 2031-10-06 starts the window; the slate sits on
// Sat Oct 11 with a Sunday-UTC straggler.

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
const { savePick, pickemBoardView, pickemCardData } = await import('./entry.js');
const { winnerOf, gameRows, recordOf, progressOf } = await import('./view.js');

const LG = 'pickemtest2-cfb';
const EMAIL_A = 'pickemtest-a@example.invalid';
const EMAIL_B = 'pickemtest-b@example.invalid';
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// The one wire shape a board game may have - the leak law's exact key set.
//
// FOUR KEYS ARGUED IN, per the law that says a new key here must be justified
// rather than merely added: home_team_id / away_team_id / home_rank / away_rank,
// added so a Pick'em row can wear an AP rank badge. The board previously sent
// only the two team NAME strings, so the badge was impossible without them.
//
// NONE OF THE FOUR IS VIEWER-SCOPED. A team's id and its AP rank are the same
// for every reader of the board - they carry no pick, no entry, no user id, and
// leak nothing about anyone. That is exactly why they are safe to add and why
// my_side stays the only field that differs between two viewers.
const WIRE_KEYS = ['match_id', 'slug', 'kickoff_at', 'home', 'away', 'status',
  'home_score', 'away_score', 'kicked', 'my_side', 'graded', 'nopick',
  'home_team_id', 'away_team_id', 'home_rank', 'away_rank'].sort();

const KO = {
  g1: '2031-10-11T16:00:00Z', // Sat noon ET - kicks first
  g2: '2031-10-11T19:30:00Z',
  g3: '2031-10-11T23:00:00Z',
  g4: '2031-10-12T00:30:00Z', // Sat 8:30 PM ET, Sunday in UTC
};
const OPEN = new Date('2031-10-07T13:00:00Z');      // Tue 9 AM ET, derived
const MIDSAT = new Date('2031-10-11T20:00:00Z');    // g1+g2 kicked, g3+g4 not

let leagueId, uA, uB, contestId;
const matchIds = {};

// ---- fixture ---------------------------------------------------------------
{
  leagueId = (await sql`
    INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${LG}, 'Pickem Entry Test', 'cfb', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const tA = (await sql`INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
    VALUES (${leagueId}, 'pk2-alpha', 'Alpha', 'Alpha', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const tB = (await sql`INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
    VALUES (${leagueId}, 'pk2-beta', 'Beta', 'Beta', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  for (const [key, ko] of Object.entries(KO)) {
    matchIds[key] = (await sql`
      INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id,
                           season_year, season_phase, week, external_ids, metadata)
      VALUES (${leagueId}, ${'pk2-' + key}, ${ko}, 'scheduled', ${tA}, ${tB},
              2031, 'REG', 99, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  }
  for (const email of [EMAIL_A, EMAIL_B]) {
    await sql`INSERT INTO users (email) VALUES (${email}) ON CONFLICT DO NOTHING`;
  }
  uA = (await sql`SELECT id FROM users WHERE email = ${EMAIL_A}`)[0].id;
  uB = (await sql`SELECT id FROM users WHERE email = ${EMAIL_B}`)[0].id;
  const made = await ensurePickemBoard({ leagueSlug: LG, now: new Date('2031-10-08T12:00:00Z') });
  contestId = made.id;
}

after(async () => {
  await sql`DELETE FROM contest_entries WHERE contest_id = ${contestId}`;
  await sql`DELETE FROM contests WHERE game_type = 'pickem' AND sport = ${LG}`;
  await sql`DELETE FROM matches WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM teams WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
  await sql`DELETE FROM users WHERE email IN (${EMAIL_A}, ${EMAIL_B})`;
});

// ---- the per-game lock -----------------------------------------------------

test('a pick saves before ITS kickoff, is refused after, exact at the boundary', async () => {
  const wed = new Date('2031-10-08T15:00:00Z');
  assert.equal((await savePick(uA, contestId, matchIds.g1, 'home', { now: wed })).ok, true,
    'Wednesday: every game is open');
  // Mid-Saturday: g1 kicked, g3 not
  const locked = await savePick(uA, contestId, matchIds.g1, 'away', { now: MIDSAT });
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, 'game_locked', 'the error names the lock');
  assert.equal((await savePick(uA, contestId, matchIds.g3, 'away', { now: MIDSAT })).ok, true,
    'an un-kicked game on the same board still saves');
  // THE BOUNDARY IS EXACT: kickoff <= now seals - at the instant, sealed.
  const atKick = await savePick(uA, contestId, matchIds.g2, 'home', { now: new Date(KO.g2) });
  assert.equal(atKick.reason, 'game_locked', 'at the kickoff instant the pick is sealed');
  const justBefore = await savePick(uA, contestId, matchIds.g2, 'home',
    { now: new Date(new Date(KO.g2).getTime() - 1000) });
  assert.equal(justBefore.ok, true, 'one second before, it is still yours to change');
});

test('the failed save changed nothing - the sealed pick still reads home', async () => {
  const v = await pickemBoardView(uA, { now: MIDSAT });
  const g1 = v.games.find((g) => g.match_id === matchIds.g1);
  assert.equal(g1.my_side, 'home', 'the rejected away-flip never landed');
  assert.equal(g1.kicked, true);
});

// ---- mid-board entry -------------------------------------------------------

test('a mid-board entrant picks only what has not kicked; kicked games read no-pick', async () => {
  const r1 = await savePick(uB, contestId, matchIds.g1, 'home', { now: MIDSAT });
  assert.equal(r1.reason, 'game_locked', 'the kicked game refuses the newcomer too');
  assert.equal((await savePick(uB, contestId, matchIds.g4, 'away', { now: MIDSAT })).ok, true);
  const v = await pickemBoardView(uB, { now: MIDSAT });
  const g1 = v.games.find((g) => g.match_id === matchIds.g1);
  assert.equal(g1.nopick, true, 'kicked + unpicked = a no-pick row, dimmed, no mark');
  assert.equal(g1.my_side, null);
  assert.equal(v.progress.picked, 1);
});

// ---- sealed per-game: the leak law ----------------------------------------

test('LEAK: the board payload carries MY picks and no trace of anyone else', async () => {
  // B holds a pick on g4 (planted above). Serve A's board.
  const v = await pickemBoardView(uA, { now: MIDSAT });
  for (const g of v.games) {
    assert.deepEqual(Object.keys(g).sort(), WIRE_KEYS,
      'a board game carries exactly the pinned key set - nothing rides along');
  }
  const g4 = v.games.find((g) => g.match_id === matchIds.g4);
  assert.equal(g4.my_side, null, "B's g4 pick must not surface as anyone's my_side");
  const flat = JSON.stringify(v);
  assert.ok(!flat.includes(String(uB)), "no other user's id in the wire");
  // NEGATIVE CONTROL: the same field carries A's own pick - the probe would
  // have caught a leak shaped like this.
  const g1 = v.games.find((g) => g.match_id === matchIds.g1);
  assert.equal(g1.my_side, 'home');
});

// ---- grading + record ------------------------------------------------------

test('grades and the record derive from finals; a no-pick final marks nobody', async () => {
  await sql`UPDATE matches SET status = 'final', home_score = 31, away_score = 17
    WHERE id = ${matchIds.g1}`;                       // A picked home: W
  await sql`UPDATE matches SET status = 'live', home_score = 14, away_score = 17
    WHERE id = ${matchIds.g2}`;
  const late = new Date('2031-10-11T21:30:00Z');
  const v = await pickemBoardView(uA, { now: late });
  const g1 = v.games.find((g) => g.match_id === matchIds.g1);
  assert.equal(g1.graded, 'W');
  assert.equal(v.record.wins, 1);
  assert.equal(v.record.losses, 0);
  assert.equal(v.record.pending, 3, 'live + the two un-kicked');
  assert.equal(v.record.anyKicked, true);
  // B never picked g1 - final, but no W, no L, a dim row.
  const vb = await pickemBoardView(uB, { now: late });
  const bg1 = vb.games.find((g) => g.match_id === matchIds.g1);
  assert.equal(bg1.nopick, true);
  assert.equal(bg1.graded, null);
  assert.equal(vb.record.wins, 0);
  assert.equal(vb.record.losses, 0);
  // cleanup for later tests: back to scheduled
  await sql`UPDATE matches SET status = 'scheduled', home_score = NULL, away_score = NULL
    WHERE id IN (${matchIds.g1}, ${matchIds.g2})`;
});

test('winnerOf: final + scores only; a tie crowns nobody', () => {
  assert.equal(winnerOf({ status: 'final', home_score: 20, away_score: 10 }), 'home');
  assert.equal(winnerOf({ status: 'final', home_score: 10, away_score: 20 }), 'away');
  assert.equal(winnerOf({ status: 'final', home_score: 20, away_score: 20 }), null);
  assert.equal(winnerOf({ status: 'live', home_score: 20, away_score: 10 }), null);
});

// ---- pre-open + never-404 --------------------------------------------------

test('before opens_at the view is preopen with no games; no board at all likewise', async () => {
  const v = await pickemBoardView(uA, { now: new Date('2031-10-06T12:00:00Z') });
  assert.equal(v.phase, 'preopen');
  assert.deepEqual(v.games, []);
  const none = await pickemBoardView(uA, { now: new Date('2020-01-01T00:00:00Z') });
  assert.equal(none.phase, 'preopen');
});

test('the route can never 404 and holds the sign-in law', () => {
  const t = src('app/pickem/page.js');
  assert.ok(!/notFound/.test(t), 'no 404 path exists on /pickem');
  assert.match(t, /requireSignInInShell\(\{ isShell, userId, dest: '\/pickem' \}\)/);
  assert.match(t, /shellSigninHref\('\/pickem', isShell\)/);
  assert.match(t, /pk-ghost/, 'the pre-open ghost renders, not an error');
});

// ---- lobby card ------------------------------------------------------------

test('the lobby card summary is viewer-scoped and ghosts without a board', async () => {
  const card = await pickemCardData(uA, { now: MIDSAT });
  assert.equal(card.entered, true);
  assert.equal(card.total, 4);
  assert.ok(card.picked >= 2);
  assert.equal(card.nextKickoff, KO.g3.replace('Z', '.000Z').replace('T', 'T'), 'next un-kicked kickoff');
  const nobody = await pickemCardData(null, { now: MIDSAT });
  assert.equal(nobody.entered, false, 'a stranger gets board facts, never an entry');
  assert.equal(await pickemCardData(uA, { now: new Date('2020-01-01T00:00:00Z') }), null);
});
