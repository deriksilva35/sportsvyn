// lib/gridiron/gameDetail.test.mjs - the shaping behind /nfl/game/[slug].
//
// Everything tested here is PURE: a stored game in, render-ready structures
// out. The fetch half needs the provider and the read half needs the database,
// but the part that decides what a reader sees - which groups render, in what
// order, ranked by what, and whether the fantasy arithmetic is right - is
// checkable in milliseconds, which is the only way it stays right.
//
// THE FIXTURE IS REAL. Every stat line below was served by API-Sports for game
// 21464 (Carolina at Arizona, the 2026 Hall of Fame game) and read off the
// payload, not invented. Labels like "total receptions" and "extra point" look
// like near-misses for the obvious names because they ARE the provider's, and
// three of them were wrong in the first draft of the parser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const {
  scoringByQuarter, linesByGroup, fantasyLeaders, proseLine, pointsAllFormats,
  PRIMARY_GROUPS, SCORING_FORMATS,
} = await import('./gameDetail.js');
const { fantasyPoints } = await import('../fantasy/scoring.js');
const { parseStatLine } = await import('./ingest.js');

const CAR = 1, ARI = 2;

// A line as it comes back OUT of the database: stats/parsed already jsonb, plus
// the stat_order column that exists because jsonb does not keep key order.
function line(teamId, group, name, pairs) {
  const { group: g, stats, order, parsed } = parseStatLine(group, pairs);
  return { team_id: teamId, stat_group: g, player_name: name, stats, stat_order: order, parsed };
}

const P = (n, v) => ({ name: n, value: v });

const GAME = {
  home: { id: ARI, name: 'Arizona Cardinals', abbreviation: 'ARI' },
  away: { id: CAR, name: 'Carolina Panthers', abbreviation: 'CAR' },
  events: [
    { seq: 0, quarter: 2, clock: '14:55', team_id: ARI, scoring_type: 'TD', description: 'Corey Kiner 1 Yd Rush', home_score: 7, away_score: 0 },
    { seq: 1, quarter: 2, clock: '10:56', team_id: CAR, scoring_type: 'TD', description: 'AJ Dillon 1 Yd Rush', home_score: 7, away_score: 7 },
    { seq: 2, quarter: 4, clock: '0:22', team_id: CAR, scoring_type: 'TD', description: 'Jimmy Horn Jr. 31 Yd pass', home_score: 30, away_score: 33 },
    { seq: 3, quarter: 3, clock: '7:44', team_id: ARI, scoring_type: 'FG', description: 'Chad Ryland 38 Yd Field Goal', home_score: 20, away_score: 17 },
  ],
  lines: [
    line(CAR, 'Passing', 'Haynes King', [
      P('comp att', '21/34'), P('yards', '180'), P('average', '5.3'),
      P('passing touch downs', '2'), P('interceptions', '0'), P('sacks', '3'), P('rating', '95.2'), P('two pt', '0'),
    ]),
    line(CAR, 'Rushing', 'Haynes King', [
      P('total rushes', '3'), P('yards', '39'), P('average', '13.0'),
      P('rushing touch downs', '1'), P('longest rush', '26'), P('two pt', '0'),
    ]),
    line(CAR, 'Rushing', 'AJ Dillon', [
      P('total rushes', '3'), P('yards', '18'), P('average', '6.0'),
      P('rushing touch downs', '1'), P('longest rush', '13'), P('two pt', '0'),
    ]),
    line(CAR, 'Receiving', 'Jimmy Horn Jr.', [
      P('targets', '6'), P('total receptions', '4'), P('yards', '44'), P('average', '11.0'),
      P('receiving touch downs', '0'), P('longest reception', '17'), P('two pt', '0'),
    ]),
    line(CAR, 'Kicking', 'Ryan Fitzgerald', [
      P('field goals', '2/2'), P('pct', '100'), P('long', '37'), P('extra point', '3/3'), P('points', '9'),
    ]),
    line(CAR, 'Defensive', 'Akayleb Evans', [
      P('tackles', '5'), P('unassisted tackles', '2'), P('sacks', '0'), P('tfl', '0'),
      P('passes defended', '0'), P('qb hts', '0'), P('interceptions for touch downs', '0'),
      P('blocked kicks', '0'), P('kick return td', null), P('exp return td', null), P('ff', '0'),
    ]),
    line(ARI, 'Receiving', 'Jalen Brooks', [
      P('targets', '4'), P('total receptions', '3'), P('yards', '99'), P('average', '33.0'),
      P('receiving touch downs', '0'), P('longest reception', '49'), P('two pt', '0'),
    ]),
    line(ARI, 'Rushing', 'Corey Kiner', [
      P('total rushes', '14'), P('yards', '57'), P('average', '4.1'),
      P('rushing touch downs', '1'), P('longest rush', '13'), P('two pt', '0'),
    ]),
  ],
};

// ---------------------------------------------------------------------------
// Scoring summary
// ---------------------------------------------------------------------------

test('quarters come back in order, and a scoreless quarter is ABSENT', () => {
  const qs = scoringByQuarter(GAME);
  assert.deepEqual(qs.map((q) => q.label), ['Q2', 'Q3', 'Q4'],
    'the provider sent Q3 last; a first quarter nobody scored in gets no heading');
  assert.equal(qs[0].plays.length, 2);
  assert.equal(qs[1].plays.length, 1);
});

test('overtime periods keep counting rather than getting a magic number', () => {
  const ot = scoringByQuarter({ events: [{ seq: 0, quarter: 5 }, { seq: 1, quarter: 6 }] });
  assert.deepEqual(ot.map((q) => q.label), ['OT', 'OT2']);
});

test('a game with no scoring plays yields nothing to render', () => {
  assert.deepEqual(scoringByQuarter({ events: [] }), []);
  assert.deepEqual(scoringByQuarter(null), []);
});

// ---------------------------------------------------------------------------
// Player line tables
// ---------------------------------------------------------------------------

test('the designed groups come FIRST, in the order the lock puts them', () => {
  const tables = linesByGroup(GAME, CAR);
  const primary = tables.filter((t) => t.primary).map((t) => t.group);
  assert.deepEqual(primary, PRIMARY_GROUPS.filter((g) => primary.includes(g)));
  assert.deepEqual(tables.map((t) => t.group),
    ['passing', 'rushing', 'receiving', 'kicking', 'defensive'],
    'defence sits behind the four designed groups');
});

test('a group with nothing in it does not render - there is no empty table', () => {
  const tables = linesByGroup(GAME, ARI).map((t) => t.group);
  assert.ok(!tables.includes('passing'), 'Arizona has no passing line in this fixture');
  assert.ok(!tables.includes('punting'));
  assert.deepEqual(tables, ['rushing', 'receiving']);
});

test('the designed columns are the LOCK\'s, not everything the provider sent', () => {
  const passing = linesByGroup(GAME, CAR).find((t) => t.group === 'passing');
  assert.deepEqual(passing.headings, ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'RTG']);
  assert.deepEqual(passing.rows[0].cells, ['21/34', '180', '5.3', '2', '0', '95.2']);
  // "sacks" and "two pt" are in the payload and out of the table, per the lock.
  assert.ok(!passing.headings.includes('SACKS'));
});

test('an UNDESIGNED group renders the box-score order, not the storage order', () => {
  // Postgres re-sorts jsonb object keys by length then bytes, so reading
  // Object.keys(stats) would print "FF, TFL, SACKS, QB HTS, TACKLES". The
  // stat_order column exists for exactly this row.
  const def = linesByGroup(GAME, CAR).find((t) => t.group === 'defensive');
  assert.equal(def.headings[0], 'TACKLES');
  assert.equal(def.headings[1], 'UNASSISTED TACKLES');
  assert.ok(def.headings.indexOf('FF') > def.headings.indexOf('SACKS'),
    'FF is last in the payload and must stay last');
});

test('a stat the provider sent as null renders as the ABSENCE glyph, never 0', () => {
  const def = linesByGroup(GAME, CAR).find((t) => t.group === 'defensive');
  const i = def.headings.indexOf('KICK RETURN TD');
  assert.equal(def.rows[0].cells[i], '–', 'en dash, the same one the line score uses');
});

test('FPTS appears on the three groups it means something for, and not on kicking', () => {
  const tables = linesByGroup(GAME, CAR);
  const withFpts = tables.filter((t) => t.showFpts).map((t) => t.group);
  assert.deepEqual(withFpts, ['passing', 'rushing', 'receiving']);
  const kicking = tables.find((t) => t.group === 'kicking');
  assert.equal(kicking.showFpts, false,
    'the scoring module prices field goals without distances and says so - a short number is not a column');
  assert.equal(kicking.rows[0].pts, null);
});

test('every row carries all three formats, so the toggle is a lookup', () => {
  const rec = linesByGroup(GAME, CAR).find((t) => t.group === 'receiving');
  const r = rec.rows[0];
  for (const f of SCORING_FORMATS) assert.equal(typeof r.pts[f], 'number', f);
  // 4 rec, 44 yds, no TD: 4.4 + reception value × 4.
  assert.equal(r.pts.ppr, 8.4);
  assert.equal(r.pts['half-ppr'], 6.4);
  assert.equal(r.pts.standard, 4.4);
});

test('rushing rows sort by points, which puts the better night first', () => {
  const rush = linesByGroup(GAME, CAR).find((t) => t.group === 'rushing');
  assert.deepEqual(rush.rows.map((r) => r.name), ['Haynes King', 'AJ Dillon']);
  assert.ok(rush.rows[0].pts.ppr > rush.rows[1].pts.ppr);
});

// ---------------------------------------------------------------------------
// The parse boundary - where three real bugs lived
// ---------------------------------------------------------------------------

test('THE PROVIDER\'S LABELS ARE NEAR-MISSES, and the map uses the real ones', () => {
  const rec = GAME.lines.find((l) => l.stat_group === 'receiving' && l.team_id === CAR);
  assert.equal(rec.parsed.rec, 4, '"total receptions", not "receptions"');
  const rush = GAME.lines.find((l) => l.stat_group === 'rushing' && l.player_name === 'AJ Dillon');
  assert.equal(rush.parsed.rushAtt, 3, '"total rushes", not "attempts"');
  const kick = GAME.lines.find((l) => l.stat_group === 'kicking');
  assert.equal(kick.parsed.xp, 3, '"extra point" singular, not "extra points"');
  assert.equal(kick.parsed.fgm, 2, 'made/attempted split from "2/2"');
});

test('A QUARTERBACK IS NOT PAID FOR BEING SACKED', () => {
  // "sacks" appears in the passing group (sacks TAKEN) and the defensive group
  // (sacks RECORDED). An unscoped label map would have credited the quarterback
  // a point per burial - three of them, in this fixture.
  const pass = GAME.lines.find((l) => l.stat_group === 'passing');
  assert.equal(pass.stats.sacks, '3', 'the number is stored and displayed');
  assert.equal(pass.parsed.sacks, undefined, 'and it never reaches the scorer');
  assert.equal(pass.parsed.passYds, 180);
  assert.equal(pass.parsed.passTd, 2);
});

// ---------------------------------------------------------------------------
// Fantasy leaders
// ---------------------------------------------------------------------------

test('leaders span BOTH squads and merge a player\'s groups into one entry', () => {
  const top = fantasyLeaders(GAME, 'ppr', 5);
  const names = top.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, 'nobody appears twice');
  const king = top.find((p) => p.name === 'Haynes King');
  assert.match(king.line, /21\/34, 180 yds, 2 TD · 3 att, 39 yds, TD/,
    'the passing and rushing lines read as one sentence');
  // 180 pass yds (7.2) + 2 pass TD (8) + 39 rush yds (3.9) + 1 rush TD (6)
  assert.equal(king.pts.ppr, 25.1);
  assert.ok(names.includes('Corey Kiner'), 'and the other team is in the same table');
});

test('KICKERS AND DEFENDERS ARE NOT RANKED', () => {
  // Both are scored short by lib/fantasy/scoring.js's own account - flat field
  // goals, no points-allowed tiers - so ranking them against skill players
  // would present a known-partial number as a comparison.
  const names = fantasyLeaders(GAME, 'ppr', 20).map((p) => p.name);
  assert.ok(!names.includes('Ryan Fitzgerald'), 'kicker');
  assert.ok(!names.includes('Akayleb Evans'), 'defender');
});

test('the format changes the order, not just the numbers', () => {
  // Jalen Brooks: 3 catches for 99. Corey Kiner: 14 for 57 and a touchdown.
  // PPR pays the catches; standard does not.
  const ppr = fantasyLeaders(GAME, 'ppr', 5).map((p) => p.name);
  const std = fantasyLeaders(GAME, 'standard', 5).map((p) => p.name);
  assert.equal(ppr[0], 'Haynes King');
  assert.equal(std[0], 'Haynes King');
  assert.ok(ppr.indexOf('Jalen Brooks') < std.indexOf('Jalen Brooks'),
    'receptions matter more in PPR, and the ranking says so');
});

test('the leaders list is computed PER FORMAT, not sliced then re-sorted', () => {
  // A top five re-ranked after slicing is the wrong five: a three-catch night
  // that made the PPR cut can leave the list entirely under standard rather
  // than moving down it.
  const five = fantasyLeaders(GAME, 'standard', 5);
  const all = fantasyLeaders(GAME, 'standard', 50);
  assert.deepEqual(five.map((p) => p.name), all.slice(0, 5).map((p) => p.name));
});

// ---------------------------------------------------------------------------
// The methodology, against the design lock
// ---------------------------------------------------------------------------

test('THE MOCK HAS TWO ARITHMETIC SLIPS AND THE SHARED MODULE IS RIGHT', () => {
  // The gate asked for the computed FPTS to be cross-checked against the mock's
  // math. Nine of its eleven cells reconcile exactly. Two do not, and both are
  // the mock's - pinned here so nobody "fixes" the module to match a typo.
  const pprOf = (s) => fantasyPoints(s, 'ppr');

  // Reconciling cells, verbatim from the lock.
  assert.equal(pprOf({ rec: 5, recYds: 84, recTd: 1 }), 19.4, 'Coker, leaders + receiving');
  assert.equal(pprOf({ rec: 3, recYds: 61, recTd: 1 }), 15.1, 'Horn');
  assert.equal(pprOf({ rec: 4, recYds: 47 }), 8.7, 'Chisena');
  assert.equal(pprOf({ rushAtt: 11, rushYds: 58, rushTd: 1 }), 11.8, 'Etienne, rushing');
  assert.equal(pprOf({ rushYds: 34, rushTd: 1 }), 9.4, 'Dillon');
  assert.equal(pprOf({ rushYds: 12 }), 1.2, 'Plummer, rushing');
  assert.equal(pprOf({ passYds: 74, passTd: 0, int: 1 }), 1.0, 'Hooker, passing');
  assert.equal(pprOf({ rec: 1, recYds: 6, rushAtt: 9, rushYds: 41, rushTd: 1 }), 11.7, 'Kiner, combined');

  // The two that do not.
  assert.equal(pprOf({ passYds: 203, passTd: 2 }), 16.1,
    'the mock prints 9.3 for this cell; 203/25 + 2x4 is 16.12, and Hooker\'s cell above proves the same formula');
  assert.equal(pprOf({ passYds: 203, passTd: 2, rushYds: 12 }), 17.3,
    'the mock prints 18.3 for the combined line; it is 17.32');
});

test('the toggle values come from the shared module, not from a second copy', () => {
  const s = { rec: 5, recYds: 84, recTd: 1 };
  const all = pointsAllFormats(s);
  for (const f of SCORING_FORMATS) assert.equal(all[f], fantasyPoints(s, f), f);
});

// ---------------------------------------------------------------------------
// Prose lines
// ---------------------------------------------------------------------------

test('the prose line is built from parsed numbers, so groups read as one sentence', () => {
  assert.equal(
    proseLine({ parsed: { completions: 14, attempts: 21, passYds: 203, passTd: 2, rushAtt: 3, rushYds: 12 } }),
    '14/21, 203 yds, 2 TD · 3 att, 12 yds',
  );
  assert.equal(proseLine({ parsed: { rec: 5, recYds: 84, recTd: 1 } }), '5 rec, 84 yds, TD');
  assert.equal(proseLine({ parsed: { rec: 2, recYds: 30, recTd: 2 } }), '2 rec, 30 yds, 2 TD');
  assert.equal(proseLine({ parsed: {} }), '', 'nothing to say is said as nothing');
});
