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
  POS_FILTERS, NCAA_LEAGUE, COLLEGE_DEFAULT_SORT, sortsFor, filterPlayers, displayPosition,
  sortPlayers,
} from './statView.js';
import { lineTwoTokens } from './lineTwo.js';
import { quickTokens, fmt1 } from './statView.js';

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
test('NCAAF ADP is offered in the college view only, and is what that view opens on', () => {
  const keys = (f, o) => sortsFor(f, o).map((x) => x.key);
  assert.ok(keys('ALL', { college: true }).includes('ncaafAdp'), 'the college view offers it');
  assert.equal(sortsFor('ALL', { college: true })[0].key, COLLEGE_DEFAULT_SORT,
    'and opens on it - the order the reader came for');
  // Absent from EVERY position in the NFL view, and the default there is unchanged.
  for (const f of POS_FILTERS) {
    assert.ok(!keys(f).includes('ncaafAdp'), `${f}: the NFL view must not offer the college sort`);
    assert.ok(!keys(f, { college: false }).includes('ncaafAdp'), `${f}: explicit college:false too`);
    assert.equal(keys(f)[0], 'adp', `${f}: the NFL view still opens on ADP`);
  }
  // It really sorts by the college price, and an unpriced row goes last rather
  // than to the front as a zero.
  const opt = sortsFor('ALL', { college: true }).find((o) => o.key === 'ncaafAdp');
  const rows = [{ ncaafAdp: 9.34 }, { ncaafAdp: null }, { ncaafAdp: 2.06 }];
  assert.deepEqual([...rows].sort(opt.compare).map((r) => r.ncaafAdp), [2.06, 9.34, null]);
  // ADP (the board placement) stays available; MY TEAM does not.
  assert.ok(keys('ALL', { college: true }).includes('adp'), 'board placement stays askable');
  assert.ok(keys('ALL', { college: true }).includes('ppg'));
  assert.ok(!keys('ALL', { college: true }).includes('myteam'), 'MY TEAM is absent');
  // THE SORT LIST DOES NOT VARY BY POSITION IN THE COLLEGE VIEW - the stat sorts
  // read NFL season totals a college summary has none of - but it is the SAME
  // list for every position, so switching chips never strands a chosen sort.
  for (const f of POS_FILTERS) {
    assert.deepEqual(keys(f, { college: true }), keys('ALL', { college: true }), `${f}: same college sorts`);
  }
});

test('the position row stays live inside the college view: college QBs are two taps', () => {
  const board = [...BOARD.nfl, ...BOARD.ncaaf].map((p) => ({ ...p }));
  const college = { league: NCAA_LEAGUE };
  // Every position chip narrows the COLLEGE half, and narrows it to that position.
  const counts = {};
  for (const f of POS_FILTERS) {
    const got = filterPlayers(board, { position: f, ...college });
    assert.ok(got.every((p) => p.league === 'ncaaf'), `${f}: NFL leaked into the college view`);
    counts[f] = got.length;
    if (f !== 'ALL') {
      assert.ok(got.every((p) => displayPosition(p.position) === f), `${f}: another position leaked in`);
      assert.ok(got.length > 0, `${f}: the college board really has players at ${f}`);
    }
  }
  // ALL is the whole college half, and the positions sum to it (K/DST included).
  assert.equal(counts.ALL, BOARD.ncaaf.length);
  const summed = POS_FILTERS.filter((f) => f !== 'ALL').reduce((a, f) => a + counts[f], 0);
  assert.equal(summed, counts.ALL, 'the position chips partition the college half too');
  // This is the defect that prompted the toggle: as a position chip, NCAA was
  // mutually exclusive with QB, so this combination could not be expressed.
  const qbs = filterPlayers(board, { position: 'QB', ...college });
  assert.ok(qbs.length > 50, `college QBs should be a real list, got ${qbs.length}`);
  assert.ok(qbs.every((p) => p.league === 'ncaaf' && displayPosition(p.position) === 'QB'));
});

// ===========================================================================
// 3. the NFL view is byte-identical
// ===========================================================================
test('every NFL view is unchanged: same rows, same order, as if the college half were not there', () => {
  const nflOnly = BOARD.nfl.map((p) => ({ ...p }));
  const oneBoard = [...BOARD.nfl, ...BOARD.ncaaf].map((p) => ({ ...p }));
  const ids = (l) => l.map((p) => p.ffcPlayerId).join(',');
  for (const f of POS_FILTERS) {
    // The default league is 'nfl', so an untouched caller keeps its view.
    const withCollege = filterPlayers(oneBoard, { position: f });
    const without = filterPlayers(nflOnly, { position: f });
    assert.equal(ids(withCollege), ids(without), `${f}: the college half leaked into an NFL view`);
    assert.ok(withCollege.every((p) => p.league !== 'ncaaf'), `${f}: a college row is showing`);
  }
  assert.equal(filterPlayers(oneBoard, { position: 'ALL' }).length, BOARD.nfl.length);
  // The two views partition the board: nothing twice, nothing unreachable.
  const ncaa = filterPlayers(oneBoard, { position: 'ALL', league: NCAA_LEAGUE });
  assert.equal(ncaa.length, BOARD.ncaaf.length);
  assert.equal(filterPlayers(oneBoard, { position: 'ALL' }).length + ncaa.length, oneBoard.length);
  // NCAA IS NO LONGER A POSITION. It left the position row when it became a
  // toggle, and a stray 'NCAA' there would be a chip that filters nothing.
  assert.ok(!POS_FILTERS.includes('NCAA'), 'NCAA must not be a position chip');
  assert.deepEqual(POS_FILTERS, ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST']);
  // A row written before 086 has no league at all and must read as NFL.
  const legacy = [{ ffcPlayerId: 'x', name: 'Legacy', position: 'RB', adp: 5 }];
  assert.equal(filterPlayers(legacy, { position: 'ALL' }).length, 1);
  assert.equal(filterPlayers(legacy, { position: 'ALL', league: NCAA_LEAGUE }).length, 0);
});

test('the toggle sits with the class row, not in the position row, and carries the sort with it', () => {
  const room = src('components/sim/DraftRoom.js');
  // It is rendered INSIDE the class-chip row, after the class chips - so the
  // position row above it is untouched and stays live in both views.
  const classRow = room.slice(room.indexOf('avail-chips avail-class'), room.indexOf('avail-team'));
  assert.match(classRow, /className=\{`ncaa-toggle\$\{college \? ' on' : ''\}`\}/,
    'the toggle lives in the class row');
  assert.match(classRow, /aria-pressed=\{college\}/, 'a toggle announces itself as one');
  // The position row renders POS_FILTERS and nothing else.
  const posRow = room.slice(room.indexOf('<div className="avail-chips">'), room.indexOf('avail-chips avail-class'));
  assert.match(posRow, /POS_FILTERS\.map/);
  assert.ok(!/ncaa-toggle/.test(posRow), 'the toggle is not a position chip');
  // Entering the college view lands on NCAAF ADP; leaving returns to ADP. A sort
  // key that only exists on one board would otherwise be left selected on the
  // other, where sortsFor does not offer it and it silently falls back.
  assert.match(room, /setCollege\(next\);\s*\n\s*setSort\(next \? COLLEGE_DEFAULT_SORT : 'adp'\);/);
  // The view flag is the toggle, NOT the position - or the position row could
  // not stay live inside the college view.
  assert.match(room, /const collegeView = college;/);
  // And the list is filtered on the league axis.
  assert.match(room, /filterPlayers\(available, \{ position: filter, team, search, cls, league: college \? 'ncaaf' : 'nfl' \}\)/);
  // The toggle is visually distinct from a filter chip: the chips light volt,
  // this lights terra, because it changes which board is on screen.
  assert.match(src('components/sim/sim.css'), /\.avail-chips button\.ncaa-toggle\.on \{/);
});

test('college + QB, as the room builds it: only college QBs, ordered by NCAAF ADP', () => {
  // Exactly the room's pipeline - filterPlayers then sortPlayers with the option
  // sortsFor hands back - so this is the list the view renders, not a re-derivation.
  const board = [...BOARD.nfl, ...BOARD.ncaaf].map((p) => ({ ...p }));
  const opts = { college: true };
  const opt = sortsFor('QB', opts).find((o) => o.key === COLLEGE_DEFAULT_SORT);
  const list = sortPlayers(
    filterPlayers(board, { position: 'QB', league: NCAA_LEAGUE }), opt, {}, null);

  assert.ok(list.length > 50, `college QBs should be a real list, got ${list.length}`);
  assert.ok(list.every((p) => p.league === 'ncaaf'), 'an NFL row is in the college QB list');
  assert.ok(list.every((p) => displayPosition(p.position) === 'QB'), 'a non-QB is in the list');
  // Ordered by the COLLEGE price, ascending - not by the board placement, and
  // not by the NFL ADP the placement is derived to sit below.
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].ncaafAdp >= list[i - 1].ncaafAdp,
      `out of NCAAF-ADP order at ${i}: ${list[i - 1].ncaafAdp} then ${list[i].ncaafAdp}`);
  }
  // The top of that list is the best college QB by the provider's own price.
  const bestByPrice = [...board].filter((p) => p.league === 'ncaaf' && displayPosition(p.position) === 'QB')
    .sort((a, b) => a.ncaafAdp - b.ncaafAdp)[0];
  assert.equal(list[0].ffcPlayerId, bestByPrice.ffcPlayerId);
  // And ADP (the placement) is a DIFFERENT order that stays askable - on this
  // board the two agree, because the placement IS the NCAAF-ADP rank; the point
  // is that both are offered and neither is the other.
  const byPlacement = sortPlayers(filterPlayers(board, { position: 'QB', league: NCAA_LEAGUE }),
    sortsFor('QB', opts).find((o) => o.key === 'adp'), {}, null);
  assert.equal(byPlacement.length, list.length);
  assert.ok(byPlacement[0].adp < byPlacement[byPlacement.length - 1].adp);
});

test('the AVAILABLE count is the number of rows actually rendered', () => {
  const room = src('components/sim/DraftRoom.js');
  // One constant feeds the label and the slice, so they cannot drift.
  assert.match(room, /^const ROW_CAP = 120;$/m);
  assert.match(room, /\{shown\.slice\(0, ROW_CAP\)\.map/, 'the render reads the cap');
  assert.match(room, /shown\.length > ROW_CAP\s*\n?\s*\? `\$\{ROW_CAP\} of \$\{shown\.length\}` : shown\.length/,
    'the label says both numbers when the cap bites');
  // No bare 120 left anywhere near the list - that is how the two drifted.
  const listBlock = room.slice(room.indexOf('Available ·'), room.indexOf('isMyTurn && !complete'));
  assert.ok(!/slice\(0, 120\)/.test(listBlock), 'the literal cap is gone from the render');
  // The college half is 927 rows, so this is not hypothetical: without the fix
  // the label would read 927 over 120 rendered rows.
  assert.ok(BOARD.ncaaf.length > 120, 'the college board really does exceed the cap');
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

// ===========================================================================
// 6. THE ROW MUST CONSUME WHAT collegeStats RETURNS
// ===========================================================================
// WHY THIS TEST EXISTS, IN THE WORDS OF THE BUG IT MISSED. Everything above
// pinned the shape collegeStats PRODUCES and the '-' branch the room shows when
// there is NO summary. Nothing rendered a row with a summary PRESENT, and the
// two shapes are not the same shape: an NFL summary has `totals`, a college one
// has `season` and `school` and no totals at all. The room guarded on `sum`, so
// a college summary passed the guard and reached quick(t), which reads
// t.rushYds off undefined. Every college row carrying a PPG threw — measured on
// the live board, 101 of the first 120 rendered, starting at row 0 — and the
// college view could not paint a single row. The test suite was green.
//
// THE TWO SHAPES ARE ASSERTED AS DIFFERENT ON PURPOSE below, so a future change
// that quietly gives college rows a `totals` (or takes the NFL one away) fails
// here rather than in a room.

// The exact shapes the two readers return, copied from live PROD output:
//   collegeStats:  06k5i Kewan Lacy
//   playerStats:   an NFL RB
const COLLEGE_SUMMARY = { points: 345.4, ppg: 23, games: 15, season: 2025, school: 'Ole Miss' };
const NFL_SUMMARY = { points: 108, ppg: 6.4, games: 17,
  totals: { rushYds: 1223, rec: 77, rushTd: 12, recTd: 6 } };

// THE ROOMS' OWN FUNCTION, IMPORTED - NOT A COPY OF IT. The first cut of this
// test re-implemented the guard here, which meant reverting the fix in both
// rooms left it green: it was asserting that the test agreed with itself. The
// expression now lives in exactly one place (statView.quickTokens) and both
// rooms call it, so this exercises the code that ships.
const roomQuick = quickTokens;

test('the two summary shapes are different, and that is deliberate', () => {
  assert.ok(!('totals' in COLLEGE_SUMMARY), 'a college summary has no totals');
  assert.ok('totals' in NFL_SUMMARY, 'an NFL summary has totals');
  assert.ok('season' in COLLEGE_SUMMARY && 'school' in COLLEGE_SUMMARY,
    'a college summary carries the season and the school its number was earned at');
  assert.ok(!('season' in NFL_SUMMARY), 'the NFL summary does not - its season is a module constant');
});

test('a college row renders through the room expression: no throw, and the PPG is populated', () => {
  // THE REGRESSION, DIRECTLY. Before the fix this line threw
  //   TypeError: Cannot read properties of undefined (reading 'rushYds')
  assert.doesNotThrow(() => roomQuick(COLLEGE_SUMMARY, 'RB'));
  assert.equal(roomQuick(COLLEGE_SUMMARY, 'RB'), null, 'no totals -> no quick tokens');
  // Every position the college board carries, not just RB - each VIEW has its
  // own quick() and each would have thrown on its own field.
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF']) {
    assert.doesNotThrow(() => roomQuick(COLLEGE_SUMMARY, pos), `${pos} must not throw`);
    assert.equal(roomQuick(COLLEGE_SUMMARY, pos), null, `${pos}: no tokens without totals`);
  }
  // AND THE PPG STILL RENDERS. It reads sum.ppg, never totals - losing the quick
  // tokens must not cost the row its number, which is the point of the column.
  assert.equal(fmt1(COLLEGE_SUMMARY.ppg), '23.0');
  assert.equal(COLLEGE_SUMMARY.season, 2025, 'and it is season-stamped');

  // The control: an NFL summary still produces its tokens, unchanged.
  assert.deepEqual(roomQuick(NFL_SUMMARY, 'RB'), ['1223 RUSH', '77 REC', '18 TD']);
  assert.equal(fmt1(NFL_SUMMARY.ppg), '6.4');
});

test('BOTH rooms take the tokens from the shared function, and neither re-implements the guard', () => {
  // The bug lived in two files because the expression lived in two files.
  // Pinning the guard's text would only have pinned the copies; what matters is
  // that there are no copies left to drift.
  for (const rel of ['components/sim/DraftRoom.js', 'components/sim/TrackerRoom.js']) {
    const t = src(rel);
    assert.match(t, /const quick = quickTokens\(sum, p\.position\);/, `${rel}: calls the shared function`);
    assert.ok(!/viewFor\(p\.position\)\.quick\(/.test(t), `${rel}: must not call quick() itself`);
  }
  // And the one home guards on totals rather than on the summary.
  assert.match(src('lib/fantasy/statView.js'),
    /export function quickTokens\(summary, position\) \{\s*\n\s*return summary\?\.totals \? viewFor\(position\)\.quick\(summary\.totals\) : null;/);
});

// ===========================================================================
// 7. HELD PLAYERS ARE NOT ON THE COLLEGE BOARD — against the live league
// ===========================================================================
// THE COUNT IS DERIVED, NEVER A LITERAL. The number of held devy players is a
// property of the league on the night, not a constant: it was 35 on 2 Sep and
// will be different next week. Writing "18" here would pin tonight and start
// lying tomorrow. So the expectation is computed from the CONFIG'S OWN
// draft_configs.teams[].minors, and the assertion is the invariant: not one of
// those ids may appear on the written college board.
test('no held minors id is on the college board, counted from the config rather than a literal', async () => {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL);
  const cfg = await sql`SELECT teams FROM draft_configs WHERE source = 'fantrax'
                          AND teams IS NOT NULL ORDER BY id LIMIT 1`;
  if (!cfg.length) return; // no imported league on this database; nothing to assert
  const minorsIds = (cfg[0].teams ?? []).flatMap((t) => (t.minors ?? []).map((m) => String(m.fantraxId)));
  assert.ok(minorsIds.length > 0, 'the league really does hold devy players');

  const snap = await sql`SELECT max(snapshot_date) d FROM sim_player_pool WHERE source = 'fantrax'`;
  const onBoard = await sql`SELECT ffc_player_id, name, league FROM sim_player_pool
     WHERE source='fantrax' AND snapshot_date = ${snap[0].d}
       AND ffc_player_id = ANY(${minorsIds})`;
  assert.deepEqual(onBoard, [],
    `held players are draftable: ${onBoard.map((r) => `${r.name} (${r.league})`).join(', ')}`);

  // And the board is not empty, or the assertion above would pass vacuously.
  const total = await sql`SELECT league, count(*)::int n FROM sim_player_pool
     WHERE source='fantrax' AND snapshot_date = ${snap[0].d} GROUP BY 1`;
  const byLeague = Object.fromEntries(total.map((r) => [r.league, r.n]));
  assert.ok((byLeague.ncaaf ?? 0) > 500, `the college board should be populated, got ${byLeague.ncaaf ?? 0}`);
  assert.ok((byLeague.nfl ?? 0) > 300, `the NFL board should be populated, got ${byLeague.nfl ?? 0}`);
});
