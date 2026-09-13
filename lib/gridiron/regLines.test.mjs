// lib/gridiron/regLines.test.mjs - the group-derivation rule, pinned shape by
// shape. The rule is the whole build: nfl_player_game_stats is one wide row per
// player and the panel wants one table per group, so which tables a man lands
// in is DERIVED, and a derivation nobody tested is a guess with a function
// around it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REG_GROUPS, groupsForRow, cellsFor, parsedFor, leaderParsed,
  tablesFromRows, leadersFromRows,
} from './regLines.js';
import { linesByGroup, PRIMARY_GROUPS } from './gameDetail.js';

// One wide row, every column null, to be spread over.
const EMPTY = {
  team_id: 1, full_name: 'A Player', position: null, jersey_number: null, slug: null,
  pass_cmp: null, pass_att: null, pass_yds: null, pass_td: null, pass_int: null,
  rush_att: null, rush_yds: null, rush_td: null,
  tgt: null, rec: null, rec_yds: null, rec_td: null, fumbles_lost: null,
  fgm: null, fga: null, fg_long: null, xp: null,
};
const row = (o) => ({ ...EMPTY, ...o });

const QB = row({ full_name: 'J.Love', pass_cmp: 22, pass_att: 31, pass_yds: 284, pass_td: 3, pass_int: 1 });
const RB = row({ full_name: 'J.Jacobs', rush_att: 19, rush_yds: 94, rush_td: 1 });
const WR = row({ full_name: 'C.Watson', tgt: 9, rec: 6, rec_yds: 88, rec_td: 1 });
const K = row({ full_name: 'B.McManus', fgm: 3, fga: 4, fg_long: 52, xp: 2 });
const DUAL = row({ full_name: 'B.Robinson', rush_att: 11, rush_yds: 52, rush_td: 1, tgt: 4, rec: 3, rec_yds: 31 });
const BENCH = row({ full_name: 'A Linebacker', sacks: 2, def_int: 1, fr: 1, def_td: 1 });

// ---------------------------------------------------------------------------
// THE RULE, SHAPE BY SHAPE
// ---------------------------------------------------------------------------
test('pass-only lands in passing alone', () => {
  assert.deepEqual(groupsForRow(QB), ['passing']);
});

test('rush-only lands in rushing alone', () => {
  assert.deepEqual(groupsForRow(RB), ['rushing']);
});

test('a receiver lands in receiving alone', () => {
  assert.deepEqual(groupsForRow(WR), ['receiving']);
});

test('a kicker lands in kicking alone', () => {
  assert.deepEqual(groupsForRow(K), ['kicking']);
});

test('rushing AND receiving puts one player in two tables, in panel order', () => {
  assert.deepEqual(groupsForRow(DUAL), ['rushing', 'receiving']);
});

test('a player with zero offensive touches is in no table at all', () => {
  assert.deepEqual(groupsForRow(BENCH), []);
  assert.deepEqual(groupsForRow(row({})), []);
  assert.deepEqual(groupsForRow(null), []);
});

test('TARGETS COUNT: thrown at four times, caught none, still a receiving line', () => {
  // Leaving him out would report the night as though nobody had thrown at him.
  assert.deepEqual(groupsForRow(row({ tgt: 4, rec: 0, rec_yds: 0 })), ['receiving']);
});

test('a quarterback who also ran is a passing line and a rushing line', () => {
  assert.deepEqual(
    groupsForRow(row({ pass_att: 28, pass_yds: 210, rush_att: 4, rush_yds: 31 })),
    ['passing', 'rushing'],
  );
});

test('an extra point with no field goal attempt is still a kicking line', () => {
  assert.deepEqual(groupsForRow(row({ xp: 4, fga: 0 })), ['kicking']);
});

test('a zero in a column is not a touch - only a positive count opens a group', () => {
  assert.deepEqual(groupsForRow(row({ pass_att: 0, rush_att: 0, tgt: 0, rec: 0, fga: 0, xp: 0 })), []);
});

// ---------------------------------------------------------------------------
// DEFENSIVE COLUMNS STAY OUT (R4)
// ---------------------------------------------------------------------------
test('defensive columns never open a group and never reach a parsed object', () => {
  const d = row({ rush_att: 3, rush_yds: 9, sacks: 2, def_int: 1, fr: 3, def_td: 1 });
  assert.deepEqual(groupsForRow(d), ['rushing'], 'defence does not add a table');
  const p = parsedFor('rushing', d);
  for (const k of ['sacks', 'defInt', 'fr', 'defTd']) {
    assert.equal(k in p, false, `${k} must not reach scoring.js from this path`);
  }
  const lp = leaderParsed(d);
  for (const k of ['sacks', 'defInt', 'fr', 'defTd']) assert.equal(k in lp, false);
});

test('the module names no defensive group', () => {
  assert.equal(REG_GROUPS.includes('defensive'), false);
  assert.deepEqual([...REG_GROUPS], ['passing', 'rushing', 'receiving', 'kicking']);
});

// ---------------------------------------------------------------------------
// CELLS
// ---------------------------------------------------------------------------
test('passing cells read C/ATT, YDS, AVG, TD, INT and an absent rating', () => {
  const c = cellsFor('passing', QB);
  assert.equal(c[0], '22/31');
  assert.equal(c[1], 284);
  assert.equal(c[2], '9.2');
  assert.equal(c[3], 3);
  assert.equal(c[4], 1);
  assert.equal(c[5], '–', 'no passer rating is stored, so the column is absent not invented');
});

test('kicking cells read FG, LONG, XP and computed points', () => {
  assert.deepEqual(cellsFor('kicking', K), ['3/4', 52, 2, 11]);
});

test('an average never divides by zero', () => {
  assert.equal(cellsFor('rushing', row({ rush_att: 0, rush_yds: 0 }))[2], '–');
  assert.equal(cellsFor('receiving', row({ tgt: 3, rec: 0, rec_yds: 0 }))[2], '–');
});

// ---------------------------------------------------------------------------
// FPTS IS SCOPED TO THE GROUP, exactly as the preseason path scores it
// ---------------------------------------------------------------------------
test("a dual-threat back's rushing FPTS is his rushing points, not his night", () => {
  const tables = tablesFromRows([DUAL]);
  const rush = tables.find((t) => t.group === 'rushing').rows[0];
  const rec = tables.find((t) => t.group === 'receiving').rows[0];
  // 52 rush yds + 1 TD = 5.2 + 6 = 11.2 ; 3 rec, 31 yds PPR = 3 + 3.1 = 6.1
  assert.equal(rush.pts.ppr, 11.2);
  assert.equal(rec.pts.ppr, 6.1);
  assert.notEqual(rush.pts.ppr, rec.pts.ppr);
});

test('the kicking table carries no FPTS at all', () => {
  const k = tablesFromRows([K]).find((t) => t.group === 'kicking');
  assert.equal(k.showFpts, false);
  assert.equal(k.rows[0].pts, null);
});

test('the three formats differ where receptions do', () => {
  const rec = tablesFromRows([WR]).find((t) => t.group === 'receiving').rows[0];
  assert.ok(rec.pts.ppr > rec.pts['half-ppr']);
  assert.ok(rec.pts['half-ppr'] > rec.pts.standard);
});

// ---------------------------------------------------------------------------
// THE CONTRACT - it must be the one GameTabs already renders
// ---------------------------------------------------------------------------
test('tablesFromRows returns linesByGroup\'s field set, field for field', () => {
  const PRE_GAME = {
    lines: [{
      team_id: 7, stat_group: 'rushing', player_name: 'A Back',
      stats: { 'total rushes': '12', yards: '60' }, stat_order: ['total rushes', 'yards'],
      parsed: { rushAtt: 12, rushYds: 60 },
    }],
  };
  const pre = linesByGroup(PRE_GAME, 7)[0];
  const reg = tablesFromRows([RB])[0];
  assert.deepEqual(Object.keys(reg).sort(), Object.keys(pre).sort());
  assert.deepEqual(Object.keys(reg.rows[0]).sort().filter((k) => k in pre.rows[0]),
    Object.keys(pre.rows[0]).sort());
  assert.equal(reg.headings.length, reg.rows[0].cells.length,
    'every heading has a cell under it');
});

test('every table declares primary the way the panel expects', () => {
  for (const t of tablesFromRows([QB, RB, WR, K])) {
    assert.equal(t.primary, PRIMARY_GROUPS.includes(t.group));
  }
});

test('groups come back in panel order and empty ones do not come back at all', () => {
  assert.deepEqual(tablesFromRows([K, WR, QB]).map((t) => t.group), ['passing', 'receiving', 'kicking']);
  assert.deepEqual(tablesFromRows([BENCH]), []);
  assert.deepEqual(tablesFromRows([]), []);
});

test('an FPTS table is sorted by points, then by name', () => {
  const a = row({ full_name: 'B Back', rush_att: 10, rush_yds: 40 });
  const b = row({ full_name: 'A Back', rush_att: 10, rush_yds: 40 });
  const c = row({ full_name: 'C Back', rush_att: 10, rush_yds: 90 });
  const rows = tablesFromRows([a, b, c])[0].rows.map((r) => r.name);
  assert.deepEqual(rows, ['C Back', 'A Back', 'B Back']);
});

// ---------------------------------------------------------------------------
// LEADERS
// ---------------------------------------------------------------------------
test('a leader line merges a player\'s groups into one sentence', () => {
  const [top] = leadersFromRows([DUAL], 'ppr', 5);
  assert.equal(top.name, 'B.Robinson');
  assert.equal(top.line, '11 att, 52 yds, TD · 3 rec, 31 yds');
  // 5.2 rush + 6 TD + 3 rec + 3.1 rec yds. It is also the sum of his two
  // tables (11.2 + 6.1), which is the check that the group scoping splits a
  // night without losing any of it.
  assert.equal(top.pts.ppr, 17.3);
  assert.equal(top.pts.standard, 14.3);
});

test('kickers are absent from the leaders table, by having no prose line', () => {
  const names = leadersFromRows([K, QB, RB], 'ppr', 5).map((p) => p.name);
  assert.equal(names.includes('B.McManus'), false);
  assert.deepEqual(names, ['J.Love', 'J.Jacobs']);
});

test('the leaders table honours its limit and its format', () => {
  assert.equal(leadersFromRows([QB, RB, WR, DUAL], 'ppr', 2).length, 2);
  const ppr = leadersFromRows([WR, RB], 'ppr', 5).map((p) => p.name);
  const std = leadersFromRows([WR, RB], 'standard', 5).map((p) => p.name);
  assert.deepEqual(ppr, ['C.Watson', 'J.Jacobs'], 'six catches lead under PPR');
  assert.deepEqual(std, ['J.Jacobs', 'C.Watson'], 'and trail without them');
});

// ---------------------------------------------------------------------------
// WIRING - the page must prefer stored preseason rows and fall back otherwise
// ---------------------------------------------------------------------------
test('the game page reads regLines only when gridiron_player_lines is empty', () => {
  const page = readFileSync(new URL('../../app/nfl/game/[slug]/page.js', import.meta.url), 'utf8');
  assert.match(page, /const reg = game\.lines\?\.length \? null : await regTeamTables\(game\.id\)/);
  assert.match(page, /tables: reg \? \(reg\.tables\.get\(t\.id\) \?\? \[\]\) : linesByGroup\(game, t\.id\)/);
  assert.match(page, /leaders\[f\] = reg \? leadersFromRows\(reg\.rows, f, 5\) : fantasyLeaders\(game, f, 5\)/);
});

test('pointsForLine is gone from the tree', () => {
  const detail = readFileSync(new URL('./gameDetail.js', import.meta.url), 'utf8');
  assert.equal(detail.includes('pointsForLine'), false,
    'it never had a caller; pointsAllFormats is the plural of it');
});
