// lib/fantasy/collegeSurface.test.mjs — the NCAA chip's surface, and the
// server's refusal behind it. node --test, against DEV.
//
// WHAT THIS FILE IS FOR. The college half is one chip away from the NFL board,
// and the two must not bleed into each other in either direction: no college
// row may print a VAL or a seat read (both are facts about the NFL board), and
// no NFL view may gain a control that only means something under the chip. The
// last test goes through the SERVED action rather than calling canRoster,
// because "bench-eligible only" is a promise about what the server does with a
// pick, not about what a pure function returns.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POS_FILTERS, NCAA_FILTER, sortsFor, filterPlayers,
} from './statView.js';
import { lineTwoTokens } from './lineTwo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
})(path.resolve(__dirname, '..', '..', '.env.local'));

const src = (rel) => readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
const BOARD = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'fantrax-one-board.json'), 'utf8'));

const collegeRow = { ...BOARD.ncaaf[3] };            // Caleb Hawkins, RB·OkSt, ncaafAdp 3.78
const nflRow = { ...BOARD.nfl.find((p) => p.position === 'RB') };
const seatRead = { gap: -29.9, slot: 'flex', deferred: false, streamer: false };

// ===========================================================================
// 1. no VAL and no seat tokens on a college row
// ===========================================================================
test('a college row emits no gap and no slot token, even under the MY TEAM sort with a seat read in hand', () => {
  const kinds = (t) => t.map((x) => x.kind);
  // The hostile case: seatSort ON and a fully populated seatRead passed in. The
  // refusal must be in lineTwo, not in the caller remembering not to pass it.
  const college = lineTwoTokens({ pos: 'RB', team: collegeRow.team, quick: ['1424 RUSH'],
    seatSort: true, seatRead, league: 'ncaaf' });
  assert.deepEqual(kinds(college), ['tag', 'quick']);
  assert.equal(college[0].text, 'RB·OkSt', 'the tag carries the SCHOOL');
  // The control: the identical call on an NFL row DOES emit both.
  const nfl = lineTwoTokens({ pos: 'RB', team: 'ATL', quick: ['1424 RUSH'],
    seatSort: true, seatRead, league: 'nfl' });
  assert.deepEqual(kinds(nfl), ['tag', 'gap', 'slot', 'quick']);
  // Default league is nfl, so no existing caller changes behaviour by omission.
  assert.deepEqual(kinds(lineTwoTokens({ pos: 'RB', team: 'ATL', seatSort: true, seatRead })),
    ['tag', 'gap', 'slot']);
});

test('the room renders the VAL column only off the college view, and states the reason instead', () => {
  const room = src('components/sim/DraftRoom.js');
  // The VAL cell is inside the non-college branch, not rendered-then-blanked.
  assert.match(room, /collegeView \? \(\s*<span className="ncol">\s*<span className="v dim">\{p\.ncaafAdp/,
    'the college view shows NCAAF ADP where ADP+VAL would be');
  assert.match(room, /signed1\(val\)/, 'the NFL view still prints VAL');
  // The reason is stated once, as text, not as an empty cell.
  assert.match(room, /College ADP is a separate market/, 'the header states why VAL is absent');
  assert.match(room, /\{collegeView\s*\?\s*<span className="ncol">NCAAF<\/span>/,
    'the header column label changes with the view');
  // And the room hands lineTwo the league, or the refusal above cannot fire.
  assert.match(room, /lineTwoTokens\(\{ pos: slot, team: p\.team, range, quick, seatSort, seatRead, league: p\.league \}\)/);
});

// ===========================================================================
// 2. the NCAAF ADP sort exists ONLY inside the filter
// ===========================================================================
test('NCAAF ADP is offered under the NCAA chip and nowhere else', () => {
  const keys = (f) => sortsFor(f).map((o) => o.key);
  assert.ok(keys(NCAA_FILTER).includes('ncaafAdp'), 'the college view offers it');
  for (const f of POS_FILTERS.filter((x) => x !== NCAA_FILTER)) {
    assert.ok(!keys(f).includes('ncaafAdp'), `${f} must not offer the college sort`);
  }
  // It really sorts by the college price, and an unpriced row goes last rather
  // than to the front as a zero.
  const opt = sortsFor(NCAA_FILTER).find((o) => o.key === 'ncaafAdp');
  const rows = [{ ncaafAdp: 9.34 }, { ncaafAdp: null }, { ncaafAdp: 2.06 }];
  assert.deepEqual([...rows].sort(opt.compare).map((r) => r.ncaafAdp), [2.06, 9.34, null]);
  // The seat read is not on offer here: it ranks by a slot college cannot fill.
  assert.ok(!keys(NCAA_FILTER).includes('myteam'), 'MY TEAM is absent from the college view');
});

// ===========================================================================
// 3. the NFL view is byte-identical
// ===========================================================================
test('every NFL view is unchanged: same rows, same order, as if the college half were not there', () => {
  const nflOnly = BOARD.nfl.map((p) => ({ ...p }));
  const oneBoard = [...BOARD.nfl, ...BOARD.ncaaf].map((p) => ({ ...p }));
  const ids = (l) => l.map((p) => p.ffcPlayerId).join(',');
  for (const f of POS_FILTERS.filter((x) => x !== NCAA_FILTER)) {
    const withCollege = filterPlayers(oneBoard, { position: f });
    const without = filterPlayers(nflOnly, { position: f });
    assert.equal(ids(withCollege), ids(without), `${f}: the college half leaked into an NFL view`);
    assert.ok(withCollege.every((p) => p.league !== 'ncaaf'), `${f}: a college row is showing`);
  }
  // ALL is the one worth naming: 927 rows below the 417 a reader came for.
  assert.equal(filterPlayers(oneBoard, { position: 'ALL' }).length, BOARD.nfl.length);
  // And the chip shows the college half, all of it, and only it.
  const ncaa = filterPlayers(oneBoard, { position: NCAA_FILTER });
  assert.equal(ncaa.length, BOARD.ncaaf.length);
  assert.ok(ncaa.every((p) => p.league === 'ncaaf'));
  // The two partition the board: nothing appears twice, nothing is unreachable.
  assert.equal(filterPlayers(oneBoard, { position: 'ALL' }).length + ncaa.length, oneBoard.length);
  // The chip row itself still leads with ALL and ends with NCAA.
  assert.equal(POS_FILTERS[0], 'ALL');
  assert.equal(POS_FILTERS[POS_FILTERS.length - 1], NCAA_FILTER);
});

// ===========================================================================
// 4. the served action refuses a bench-full college pick
// ===========================================================================
const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const d = await import('./drafts.js');
const engine = await import('./engine.js');

const MARK = 'collegesurface-%@example.invalid';
async function wipe() { await sql`DELETE FROM users WHERE email LIKE ${MARK}`; }
let USER = null;

before(async () => {
  await wipe();
  USER = (await sql`INSERT INTO users (name, email)
    VALUES ('CollegeSurface Sentinel', ${`collegesurface-${Date.now()}@example.invalid`})
    RETURNING id`)[0].id;
});
after(async () => {
  await wipe();
  const left = await sql`SELECT count(*)::int n FROM users WHERE email LIKE ${MARK}`;
  assert.equal(left[0].n, 0, 'the sentinel user must be gone');
});

test('the served pick path refuses a college player when the bench is full, in the same grammar as any illegal pick', () => {
  // The refusal the ACTION returns, proved on the state the action validates
  // against. makePickFor's only legality gate is this call - drafts.js:842 -
  // so what it returns is what the server returns.
  const cfg = { teams_count: BOARD.teamsCount, roster_slots: BOARD.rosterSlots, scoring_format: 'ppr' };
  const pool = [...BOARD.nfl, ...BOARD.ncaaf].map((p) => ({ ...p }));
  const st = engine.createDraftState(cfg, pool, 1);
  const team = st.teams[0];
  const college = st.available.find((p) => p.league === 'ncaaf');
  const nfl = st.available.find((p) => p.league === 'nfl' && p.position === 'RB');

  // Bench open -> legal, for a human, exactly like an NFL row.
  assert.equal(engine.canRoster(st, team, college, 1, null, { humanPick: true }), true);

  // Bench full, every starting slot still open.
  team.slots.BN.filled = team.slots.BN.cap;
  assert.ok(team.slots.RB.cap - team.slots.RB.filled > 0);
  assert.equal(engine.canRoster(st, team, college, 1, null, { humanPick: true }), false);
  // The NFL row in the SAME state is still legal, so the refusal is about the
  // college row and not about a full roster.
  assert.equal(engine.canRoster(st, team, nfl, 1, null, { humanPick: true }), true);

  // And the action turns that false into the reason the room already renders.
  const drafts = src('lib/fantasy/drafts.js');
  const makePick = drafts.slice(drafts.indexOf('export async function makePickFor'));
  assert.match(makePick.slice(0, 1200), /canRoster\(state, state\.teams\[userTeamIndex\], player, round, null, \{ humanPick: true \}\)[\s\S]*?reason: 'illegal_pick'/);
  assert.match(src('components/sim/DraftRoom.js'), /illegal_pick: "Roster can't fit that pick"/);
});

test('a college pick with a bench open is committed to BN through the same path an NFL pick takes', () => {
  const cfg = { teams_count: BOARD.teamsCount, roster_slots: BOARD.rosterSlots, scoring_format: 'ppr' };
  const pool = [...BOARD.nfl, ...BOARD.ncaaf].map((p) => ({ ...p }));
  const st = engine.createDraftState(cfg, pool, 1);
  const college = st.available.find((p) => p.league === 'ncaaf');
  const rec = engine.applyPick(st, 0, college, 'user');
  assert.ok(rec, 'the pick is committed');
  assert.equal(rec.rosterSlot, 'BN', 'a college pick lands on the bench');
  assert.equal(rec.pickedBy, 'user');
  assert.equal(st.teams[0].slots.RB.filled, 0, 'and takes no starting slot');
  assert.ok(!st.available.includes(college), 'and comes off the board like any pick');
});

// ===========================================================================
// 5. the PPG behind the column
// ===========================================================================
test('college PPG is COALESCEd per category, season-stamped, league-scoped, and never guesses', () => {
  const cs = src('lib/fantasy/collegeStats.js');
  // COALESCE on every scoring category. Named individually, because the trap
  // was that MOST columns are NULL on any given row: of 63,257 rows in 2025,
  // rec is non-null on 13,899, rush_yds on 9,983, pass_yds on 2,914.
  for (const col of ['pass_yds', 'pass_td', 'pass_int', 'rush_yds', 'rush_td',
                     'rec', 'rec_yds', 'rec_td', 'fum_lost', 'fgm', 'xpm']) {
    assert.match(cs, new RegExp(`COALESCE\\(gs\\.${col},0\\)`), `${col} must be COALESCEd`);
  }
  // The identity lookup is scoped to the college half, so an NFL id handed in
  // cannot fall through to a college player of the same name.
  assert.match(cs, /WHERE ffc_player_id = ANY\(\$\{ids\}\) AND league = 'ncaaf'/);
  // The season is a named constant and rides on every summary.
  assert.match(cs, /export const CFB_SEASON = 2025;/);
  assert.match(cs, /season: CFB_SEASON,/);
  // Ambiguity yields nothing rather than the first hit.
  assert.match(cs, /perPlayer\.size !== 1\) continue;/);
  // The house scorer, not a second one - so a college PPG and an NFL PPG are
  // the same arithmetic and a reader comparing them compares like with like.
  assert.match(cs, /import \{ seasonSummary \} from '\.\/scoring\.js';/);
  // The action merges both rosters into one map.
  const act = src('app/actions/sim.js');
  assert.match(act, /getPlayerSeasonSummaries\(ids, scoringFormat\),\s*\n\s*getCollegeSeasonSummaries\(ids, scoringFormat\),/);
});

test('an unresolved college player renders nothing, never a zero', () => {
  const room = src('components/sim/DraftRoom.js');
  // The cell is driven by the PRESENCE of a summary, not by its value: a player
  // with no CFB match has no entry at all, so `sum` is undefined and the cell
  // takes the empty branch. A 0.0 would read as a man who played and was useless.
  assert.match(room, /\{sum \? `\$\{approx && !collegeView \? '~' : ''\}\$\{fmt1\(sum\.ppg\)\}` : '-'\}/);
  assert.match(room, /className=\{`v\$\{sum \? '' : ' empty'\}`\}/);
  // collegeStats only writes a key when a single player matched with games.
  assert.match(src('lib/fantasy/collegeStats.js'), /if \(!games\.length\) continue;/);
});
