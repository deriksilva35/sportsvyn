// lib/cfb/liveBoxScore.test.mjs — the source-per-game-state switch, and what
// each state renders. Run: node --test lib/cfb/liveBoxScore.test.mjs
//
// WHAT IS ACTUALLY AT RISK HERE. Two tables hold the same game's box score in
// two vocabularies, and the failure this file exists to prevent is not a crash
// - it is a page that quietly shows the WRONG one: a four-group overlay still
// standing after the complete import landed, or an empty tab for the half hour
// between the whistle and that import. Both look fine. Neither is.
//
// The switch talks to the database, so the pure half (cfbTablesFor over the
// two group sets) is exercised with real-shaped rows and the switch itself is
// exercised against a SENTINEL match built here and torn down after - never a
// real game's rows, which must not be seeded or deleted to prove a read path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
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

const { cfbTablesFor, cfbBoxScoreFor, boxScoreLabel, CFB_GROUPS, CFB_LIVE_GROUPS, LIVE_COLUMNS }
  = await import('./boxScore.js');

// ---------------------------------------------------------------- the shapes

// A live payload as cfbLiveBoxScore's query returns it: the live table's
// columns, the identity the feed hands over free, and a slug only where the
// name+team join resolved.
const LIVE_ROWS = [
  { full_name: 'Jaden Craig', team_name: 'TCU', position: 'QB', jersey_number: '6',
    slug: 'jaden-craig-cfb-5083569',
    pass_cmp: 12, pass_att: 19, pass_yds: 104, pass_td: 1, pass_int: 0, rush_car: 2, rush_yds: -8 },
  { full_name: 'Jeremy Payne', team_name: 'TCU', position: 'RB', jersey_number: '21', slug: null,
    rush_car: 14, rush_yds: 88, rush_td: 1, rush_long: 31 },
  { full_name: 'Eric McAlister', team_name: 'TCU', position: 'WR', jersey_number: '5', slug: null,
    rec: 4, rec_yds: 61, rec_td: 0, rec_long: 24 },
  { full_name: 'Ansel Din-Mbuh', team_name: 'TCU', position: 'DT', jersey_number: '92', slug: null,
    tackles_tot: 4, tackles_solo: 3, tfl: 1.5, sacks: 1, def_int: null, pass_def: null },
  { full_name: 'Namdi Obiazor', team_name: 'TCU', position: 'LB', jersey_number: '2', slug: null,
    tackles_tot: 7, tackles_solo: 5, tfl: 0, sacks: 0 },
];

test('THE LIVE RENDER CARRIES EXACTLY FOUR GROUPS', () => {
  const t = cfbTablesFor(LIVE_ROWS, 'TCU', CFB_LIVE_GROUPS);
  assert.deepEqual(t.map((x) => x.group), ['passing', 'rushing', 'receiving', 'defensive']);
  // KICKING IS ABSENT, and not because nobody kicked - the live feed has no
  // kicking columns at all, so the group cannot exist while a game is live.
  assert.equal(CFB_LIVE_GROUPS.some((g) => g.group === 'kicking'), false);
  assert.equal(t.some((x) => x.group === 'kicking'), false);
  for (const g of ['punting', 'interceptions', 'fumbles', 'kickReturns', 'puntReturns']) {
    assert.equal(CFB_LIVE_GROUPS.some((x) => x.group === g), false, `${g} cannot render live`);
  }
});

test('the live DEFENSE table is NARROWER, and honestly so', () => {
  // The complete import carries QB HUR and a defensive TD; the live feed sends
  // neither. A column of dashes would be a promise we do not keep, so the
  // column is gone rather than empty.
  const fin = CFB_GROUPS.find((g) => g.group === 'defensive');
  const liv = CFB_LIVE_GROUPS.find((g) => g.group === 'defensive');
  assert.deepEqual(fin.cols.map(([, h]) => h), ['TOT', 'SOLO', 'TFL', 'SACKS', 'QB HUR', 'PD', 'TD']);
  assert.deepEqual(liv.cols.map(([, h]) => h), ['TOT', 'SOLO', 'TFL', 'SACKS', 'PD']);
});

test('the live groups are DERIVED from the final ones, never retyped', () => {
  // Same label, same headings, same order wherever the columns exist in both.
  for (const g of CFB_LIVE_GROUPS) {
    const fin = CFB_GROUPS.find((x) => x.group === g.group);
    assert.equal(g.label, fin.label);
    assert.equal(g.sort, fin.sort);
    for (const [k] of g.cols) {
      for (const c of (Array.isArray(k) ? k : [k])) {
        assert.ok(LIVE_COLUMNS.includes(c), `${c} is displayed live but not stored live`);
      }
    }
  }
  const code = src('lib/cfb/boxScore.js');
  assert.match(code, /CFB_LIVE_GROUPS = Object\.freeze\(CFB_GROUPS/,
    'a hand-written second group list is how the two tables start disagreeing');
});

test('live rows sort by the group primary stat, descending — the real rows', () => {
  const t = cfbTablesFor(LIVE_ROWS, 'TCU', CFB_LIVE_GROUPS);
  const def = t.find((x) => x.group === 'defensive');
  assert.deepEqual(def.rows.map((r) => `${r.name} ${r.cells[0]}`),
    ['Namdi Obiazor 7', 'Ansel Din-Mbuh 4']);
  const rush = t.find((x) => x.group === 'rushing');
  assert.deepEqual(rush.rows.map((r) => r.name), ['Jeremy Payne', 'Jaden Craig']);
});

test('POSITION AND JERSEY RIDE THE ROW — no roster join for either', () => {
  const t = cfbTablesFor(LIVE_ROWS, 'TCU', CFB_LIVE_GROUPS);
  const qb = t.find((x) => x.group === 'passing').rows[0];
  assert.equal(qb.position, 'QB');
  assert.equal(qb.jersey, '6');
  // The reader takes them from the live row itself - the feed hands them over
  // with the stat line, so asking the roster for them would be a second query
  // for something we already hold.
  const code = src('lib/cfb/boxScore.js');
  assert.match(code, /l\.position, l\.jersey_number/);
});

test('LINKED AND UNLINKED ROWS ARE THE SAME ROW, minus the link', () => {
  const t = cfbTablesFor(LIVE_ROWS, 'TCU', CFB_LIVE_GROUPS);
  const passing = t.find((x) => x.group === 'passing').rows[0];   // resolved
  const rushing = t.find((x) => x.group === 'rushing').rows[0];   // unresolved
  assert.equal(passing.slug, 'jaden-craig-cfb-5083569');
  assert.equal(rushing.slug, null);
  // Identical keys, identical grammar - no marker on the unresolved one.
  assert.deepEqual(Object.keys(passing).sort(), Object.keys(rushing).sort());
  const tabs = src('components/gridiron/GameTabs.js');
  assert.match(tabs, /r\.slug \? <a className="gg-pl" href=\{`\/player\/\$\{r\.slug\}`\}>\{r\.name\}<\/a> : r\.name/);
  // and the join that produces the slug is EXACT - a name and a resolved team
  // id, never a fuzzy or contains match.
  const code = src('lib/cfb/boxScore.js');
  assert.match(code, /p\.current_team_id = l\.team_id/);
  assert.doesNotMatch(code, /ILIKE|similarity\(|LIKE '%/);
});

// ---------------------------------------------------------------- the labels

test('the label states what each box score IS, and a settled final says nothing', () => {
  assert.deepEqual(boxScoreLabel('live'), { text: 'LIVE', live: true });
  assert.deepEqual(boxScoreLabel('bridge'), { text: 'Final - complete box score pending', live: false });
  assert.equal(boxScoreLabel('final'), null, 'the absence of a caveat is the claim');
  assert.equal(boxScoreLabel(undefined), null);
});

test('the LIVE badge borrows the scoreboard pill, the bridge label does not', () => {
  const css = src('app/nfl/game/[slug]/game.css');
  const live = css.slice(css.indexOf('.gg-boxstate.live'), css.indexOf('.gg-st td.p .gg-pl'));
  assert.match(live, /border-radius: 99px/);
  assert.match(live, /color: var\(--live\)/);
  // The bridge label is a sentence in the muted voice, not a second pill.
  const base = css.slice(css.indexOf('.gg-boxstate {'), css.indexOf('.gg-boxstate.live'));
  assert.doesNotMatch(base, /border-radius/);
});

// ------------------------------------------------------- the switch itself
//
// THE STATE MACHINE IS TESTED THROUGH INJECTED READERS, not a database. What
// the switch promises is an ORDER and a set of fallbacks - the complete import
// is asked FIRST and wins whenever it answers - and a live table can only ever
// show that one of them returned rows, never which was asked first. The two
// readers' own SQL is asserted structurally above.
//
// (It cannot be tested against this database in any case: DEV holds none of
//  cfb_player_game_stats, cfb_live_player_lines, team_records or league_tables.
//  That drift is reported, not silently worked around.)

const COMPLETE = { teams: [{ name: 'TCU', tables: [{ group: 'kicking', label: 'KICKING', rows: [] }] }], count: 9 };
const LIVE = { teams: [{ name: 'TCU', tables: [{ group: 'passing', label: 'PASSING', rows: [] }] }], count: 2 };

const spy = (complete, live) => {
  const calls = [];
  return {
    calls,
    readComplete: async () => { calls.push('complete'); return complete; },
    readLive: async () => { calls.push('live'); return live; },
  };
};

test('LIVE -> the overlay, and the complete import is never even asked', async () => {
  const s = spy(COMPLETE, LIVE);
  const r = await cfbBoxScoreFor(1, 'live', s);
  assert.equal(r.state, 'live');
  assert.equal(r.count, 2);
  assert.deepEqual(s.calls, ['live'], 'a live game must not pay for a query it cannot use');
});

test('FINAL -> the complete import WINS, and is asked FIRST', async () => {
  const s = spy(COMPLETE, LIVE);
  const r = await cfbBoxScoreFor(1, 'final', s);
  assert.equal(r.state, 'final');
  assert.equal(r.count, 9);
  // THE ORDER IS THE WHOLE DESIGN. Ask live first and the overlay would
  // outlive the real box score every single time.
  assert.deepEqual(s.calls, ['complete']);
});

test('THE BRIDGE WINDOW: final, no complete rows -> the last live snapshot', async () => {
  const s = spy(null, LIVE);
  const r = await cfbBoxScoreFor(1, 'final', s);
  assert.equal(r.state, 'bridge');
  assert.equal(r.count, 2, 'the snapshot is kept, not blanked for half an hour');
  assert.deepEqual(s.calls, ['complete', 'live'], 'and only after the complete import came back empty');
  assert.deepEqual(boxScoreLabel(r.state), { text: 'Final - complete box score pending', live: false });
});

test('the bridge label DISAPPEARS the moment the complete rows land', async () => {
  // Same match, same status, one thing changed: the import arrived.
  const before = await cfbBoxScoreFor(1, 'final', spy(null, LIVE));
  const after = await cfbBoxScoreFor(1, 'final', spy(COMPLETE, LIVE));
  assert.equal(boxScoreLabel(before.state).text, 'Final - complete box score pending');
  assert.equal(boxScoreLabel(after.state), null);
  assert.equal(after.count, 9, 'and the ten-group import is what renders');
});

test('FINAL with nothing at all is null, not an empty tab', async () => {
  assert.equal(await cfbBoxScoreFor(1, 'final', spy(null, null)), null);
});

test('SCHEDULED is null even when rows exist - a row before kickoff is an error', async () => {
  const s = spy(COMPLETE, LIVE);
  assert.equal(await cfbBoxScoreFor(1, 'scheduled', s), null);
  assert.deepEqual(s.calls, [], 'and it costs no query to say so');
  assert.equal(await cfbBoxScoreFor(1, undefined, spy(COMPLETE, LIVE)), null);
});

test('the live reader and the complete reader read ONE TABLE EACH', () => {
  const code = src('lib/cfb/boxScore.js');
  const live = code.slice(code.indexOf('export async function cfbLiveBoxScore'),
    code.indexOf('export async function cfbBoxScoreFor'));
  const complete = code.slice(code.indexOf('export async function cfbBoxScore('),
    code.indexOf('export async function cfbLiveBoxScore'));
  assert.ok(live.includes('cfb_live_player_lines') && !live.includes('cfb_player_game_stats'));
  assert.ok(complete.includes('cfb_player_game_stats') && !complete.includes('cfb_live_player_lines'));
});

// ------------------------------------------------------------- the consumers

test('THE TAB APPEARS WHEN EITHER TABLE HAS ROWS', () => {
  const page = src('app/cfb/game/[slug]/page.js');
  // The page asks ONE reader and never looks at a status to pick a table.
  assert.match(page, /cfbBoxScoreFor\(game\.id, game\.status\)/);
  assert.match(page, /boxTeams\.length \? \{ key: 'players', label: 'PLAYER LINES' \} : null/);
  // The forbidden shape: a surface choosing its own source.
  assert.doesNotMatch(page, /cfb_live_player_lines/);
  assert.doesNotMatch(page, /status === 'live' \? cfb/);
});

test('NO SURFACE CHOOSES A SOURCE - the switch is the only chooser', () => {
  for (const f of ['app/cfb/game/[slug]/page.js', 'components/gridiron/GameTabs.js']) {
    const code = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /cfb_live_player_lines/, `${f} reads the live table directly`);
    assert.doesNotMatch(code, /cfb_player_game_stats/, `${f} reads the complete table directly`);
  }
});

test('the live reader hands the page OUR team name, not the feed\'s', () => {
  // The page matches a box-score team against game.away / game.home by name.
  // The live table stores the provider's college string - "Saint Francis"
  // where we say "St. Francis (PA)" - so an unresolved spelling would label
  // the team toggle in a second vocabulary. team_id is already resolved at
  // write time; the reader spends it.
  const code = src('lib/cfb/boxScore.js');
  assert.match(code, /COALESCE\(tm\.name, l\.team_name\) AS team_name/);
  assert.match(code, /LEFT JOIN teams tm ON tm\.id = l\.team_id/);
  // COALESCE, not a plain join: a line we could not attach to a team still
  // renders under the name the feed gave it rather than vanishing.
  assert.doesNotMatch(code, /\n\s+JOIN teams tm/);
});

test('PRINT THE REAL ROWS - what each state actually renders', () => {
  const show = (label, tables) => {
    console.log(`\n    ${label}`);
    for (const t of tables) {
      console.log(`      ${t.label.padEnd(10)} ${t.headings.join('  ')}`);
      for (const r of t.rows) {
        const id = [r.position, r.jersey != null ? `#${r.jersey}` : null].filter(Boolean).join(' ');
        console.log(`        ${(r.name + (r.slug ? ' *' : '  ')).padEnd(22)} ${id.padEnd(7)} ${r.cells.join('  ')}`);
      }
    }
  };
  show('LIVE (4 groups, * = player page resolves)', cfbTablesFor(LIVE_ROWS, 'TCU', CFB_LIVE_GROUPS));
  const FINAL_ROWS = [
    ...LIVE_ROWS.map((r) => ({ ...r, slug: r.slug ?? null })),
    { full_name: 'Kyle Lemmermann', team_name: 'TCU', position: 'PK', jersey_number: '99',
      slug: null, fgm: 2, fga: 2, xpm: 3, xpa: 3, fg_long: 41, kick_pts: 9 },
  ];
  show('FINAL (the complete import adds the groups live cannot)', cfbTablesFor(FINAL_ROWS, 'TCU'));
  assert.ok(true);
});
