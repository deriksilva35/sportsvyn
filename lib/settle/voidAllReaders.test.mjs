// lib/settle/voidAllReaders.test.mjs - ruling sun-11 item 1, PURE half.
//
// "The 'Void - no games were played' label on every settled view, and an
// audit of every reader (season tiers, Pick'em records, lobby, admin) so a
// void_all board is skipped, never read as 0. Test each with a planted
// void_all board."
//
// A PLANTED void_all BOARD is a contest row as closeVoidAll leaves it:
// settled, meta.void_all = true, meta.void = every id, perfect null, and
// entries with no score. Each view below is handed one and must say VOID -
// never a DNF, a 0, a rank, a tier or "you sat this one out". Each control
// (the same row without void_all) proves the test can see the difference:
// an entry with a null score there IS a DNF.
//
// The DB half (voidAllReadersDb.test.mjs) runs the readers that query.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const { VOID_ALL_LABEL, isVoidAll, notVoidAllSql } = await import('./voidRule.js');
const { settledView } = await import('../weekly/view.js');
const { weeklyHomeView } = await import('../weekly/homeModule.js');
const { draftSettledView, draftHomeView } = await import('../draft/view.js');
const { voidAllResults } = await import('../results/shape.js');
const reg = await import('../games/playRegistry.js');
const v2 = await import('../games/lobbyV2Shape.js');
const { nowCard } = await import('../games/nowCard.js');

const NOW = new Date('2026-10-13T12:00:00.000Z');
const SETTLED_AT = new Date('2026-10-13T10:00:00.000Z');
const plant = (over = {}) => ({
  id: 999001, game_type: 'weekly', sport: 'nfl', season_year: 2026, week: 5,
  opens_at: '2026-10-06T12:00:00.000Z', locks_at: '2026-10-11T17:00:00.000Z',
  settled: true, settled_at: SETTLED_AT.toISOString(), perfect: null, board: [],
  meta: { void_all: true, void: [11, 12, 13] }, ...over,
});
const control = (over = {}) => plant({ meta: {}, ...over });
const entry = { score: null, base_score: null, lineup: { QB: 1 }, meta: {} };

test('THE LABEL: exactly the ruling\'s words, defined once', () => {
  assert.equal(VOID_ALL_LABEL, 'Void - no games were played');
  // ONE STRING. Every view prints the constant; a second literal is a fork
  // that will drift. Tests may quote it; nothing else in the tree may.
  const hits = [];
  const walk = (dir) => {
    for (const n of readdirSync(path.join(REPO, dir))) {
      if (n === 'node_modules' || n.startsWith('.') || n === 'test-tmp') continue;
      const rel = path.join(dir, n);
      const st = statSync(path.join(REPO, rel));
      if (st.isDirectory()) walk(rel);
      else if (/\.(m?js|jsx)$/.test(n) && !/\.test\.mjs$/.test(n) && src(rel).includes('no games were played')) hits.push(rel);
    }
  };
  for (const d of ['lib', 'app', 'components']) walk(d);
  assert.deepEqual(hits, ['lib/settle/voidRule.js']);
});

test('isVoidAll / notVoidAllSql read meta.void_all and nothing else', () => {
  assert.equal(isVoidAll(plant()), true);
  assert.equal(isVoidAll(control()), false);
  assert.equal(isVoidAll({ meta: { void: [1, 2] } }), false, 'a partial void is not void_all');
  assert.equal(notVoidAllSql('c'), "NOT COALESCE((c.meta->>'void_all')::boolean, false)");
  assert.throws(() => notVoidAllSql('c; DROP TABLE x'));
});

test('WEEKLY settledView: a planted void_all week is VOID, never a DNF', () => {
  const v = settledView({ contest: plant(), entry, board: [] });
  assert.equal(v.voidAll, true);
  assert.equal(v.voidLabel, VOID_ALL_LABEL);
  assert.equal(v.dnf, false, 'no entrant DNFs a week nobody played');
  assert.equal(v.you, null);
  assert.equal(v.perfect, null);
  // CONTROL: the same null score on a real week IS a DNF.
  const c = settledView({ contest: control(), entry, board: [] });
  assert.equal(c.dnf, true);
  assert.equal(c.voidAll, false);
});

test('WEEKLY home module: void, not "played: false" with a perfect to quote', () => {
  const h = weeklyHomeView({ contest: plant(), entry, now: NOW });
  assert.equal(h.state, 'settled');
  assert.equal(h.voidAll, true);
  assert.equal(h.voidLabel, VOID_ALL_LABEL);
  assert.equal(h.perfect, null);
  assert.equal('score' in h, false, 'no score field at all');
  assert.equal(weeklyHomeView({ contest: control(), entry, now: NOW }).voidAll, undefined);
});

test('DRAFT settledView + home: VOID, never a DNF or a tier', () => {
  const de = { ...entry, meta: { roster: [{ id: 7, name: 'A', pos: 'QB', round: 1 }] } };
  const v = draftSettledView({ contest: plant({ game_type: 'draft' }), entry: de, board: [] });
  assert.equal(v.voidAll, true);
  assert.equal(v.voidLabel, VOID_ALL_LABEL);
  assert.equal(v.dnf, false);
  assert.equal(v.you, null);
  assert.equal(v.roster.length, 1, 'the roster drafted is still shown');
  assert.equal(v.roster[0].points, null, 'no points on a void week');
  assert.equal(draftSettledView({ contest: control({ game_type: 'draft' }), entry: de, board: [] }).dnf, true);

  const h = draftHomeView({ contest: plant({ game_type: 'draft' }), entry: de, now: NOW });
  assert.equal(h.state, 'settled');
  assert.equal(h.voidAll, true);
  assert.equal(h.voidLabel, VOID_ALL_LABEL);
  assert.equal('score' in h, false);
});

test('RESULTS: voidAllResults carries the label and nothing that reads as a score', () => {
  const r = voidAllResults({ game: 'weekly', title: 'The Weekly', contest: plant(), label: VOID_ALL_LABEL });
  assert.equal(r.voidAll, true);
  assert.equal(r.voidLabel, VOID_ALL_LABEL);
  assert.equal(r.subtitle, 'NFL week 5');
  assert.equal(r.edition, 'Settled 2026-10-13');
  for (const k of ['header', 'field', 'mine', 'ceiling', 'dnf']) assert.equal(k in r, false, `no ${k}`);
});

const E = Object.fromEntries(reg.PLAY_REGISTRY.map((e) => [e.key, e]));

test('PLAY REGISTRY rows: every closer game says VOID, never "Final · no lineup"', () => {
  const wk = reg.weeklyItem(E['nfl-weekly'], { home: { state: 'settled', week: 5, played: false, voidAll: true, voidLabel: VOID_ALL_LABEL } }, { signedIn: true });
  assert.equal(wk.status, VOID_ALL_LABEL);
  assert.equal(wk.voidAll, true);
  const wkC = reg.weeklyItem(E['nfl-weekly'], { home: { state: 'settled', week: 5, played: false } }, { signedIn: true });
  assert.equal(wkC.status, 'Final · no lineup', 'control');

  const pk = reg.pickemItem(E['nfl-pickem'], { card: { settled: true, voidAll: true, voidLabel: VOID_ALL_LABEL, record: null, displayWeek: 5, boardNumber: 5 } }, { signedIn: true, now: NOW });
  assert.equal(pk.status, VOID_ALL_LABEL);

  const dr = reg.draftItem(E['nfl-draft'], { home: { state: 'settled', week: 5, played: false, voidAll: true, voidLabel: VOID_ALL_LABEL } });
  assert.equal(dr.status, VOID_ALL_LABEL);

  const oc = reg.octoberItem(E['mlb-october'], { contest: plant({ game_type: 'october', sport: 'mlb' }), filled: 3, size: 5 }, { signedIn: true, now: NOW });
  assert.equal(oc.status, VOID_ALL_LABEL);
  assert.equal(oc.right, '—', 'no "3 / 5" on a day nobody played');
  assert.equal(reg.octoberItem(E['mlb-october'], { contest: control({ game_type: 'october', sport: 'mlb' }), filled: 3, size: 5 }, { now: NOW }).status, 'Final');

  const rn = reg.runItem(E['mlb-run'], { contest: plant({ game_type: 'run', sport: 'mlb', meta: { void_all: true, label: 'Wild Card' } }) });
  assert.equal(rn.status, VOID_ALL_LABEL);
  assert.equal(reg.runItem(E['mlb-run'], { contest: control({ game_type: 'run', sport: 'mlb', meta: { label: 'Wild Card' } }) }).status, 'Wild Card · final');
});

test('LOBBY v2 cards: void, never "See your grade" / "settled" / "Done"', () => {
  const home = { state: 'settled', week: 5, filled: 6, played: false, voidAll: true, voidLabel: VOID_ALL_LABEL };
  const wc = v2.weeklyCard({ home, uid: 1 });
  assert.equal(wc.voidAll, true);
  assert.match(wc.sub, /Void - no games were played/);
  assert.notEqual(wc.cta, 'See your grade');

  const p = { settled: true, voidAll: true, voidLabel: VOID_ALL_LABEL, record: null, sport: 'nfl' };
  const row = v2.pickemRow({ nfl: p, cfb: null, uid: 1 });
  assert.ok(JSON.stringify(row).includes(VOID_ALL_LABEL), 'pick\'em row carries the label');
  const tiles = v2.pickemTiles({ nfl: p, cfb: null, uid: 1 });
  assert.ok(JSON.stringify(tiles).includes(VOID_ALL_LABEL));
  assert.ok(!JSON.stringify(tiles).includes('Settled'), 'not "Settled"');

  const d = v2.draftRow({ home: { ...home, state: 'settled' } });
  assert.equal(d.pill.label, 'Void');
  assert.ok(d.lines.some((l) => String(l.text).includes(VOID_ALL_LABEL)));
});

test('NOW CARD: a void week is never "Graded · Week N is in"', () => {
  const weekly = { state: 'settled', week: 5, settledAt: SETTLED_AT.toISOString(), voidAll: true };
  assert.notEqual(nowCard({ weekly }, { now: NOW }).kind, 'week-graded');
  assert.equal(nowCard({ weekly: { ...weekly, voidAll: false } }, { now: NOW }).kind, 'week-graded', 'control');
});

// ---------------------------------------------------------------------------
// THE VIEWS THAT RENDER: each settled view of a closer game prints the label.
// Source guards, because these are server components behind auth and a DB;
// the readers that feed them are proven above and in the DB half.
// ---------------------------------------------------------------------------
test('EVERY SETTLED VIEW of a closer game renders the label', () => {
  const VIEWS = {
    'app/weekly/page.js': /if \(v\.voidAll\)[\s\S]{0,300}<VoidAllLabel/,
    'app/draft/page.js': /if \(v\.voidAll\)[\s\S]{0,300}<VoidAllLabel/,
    'app/pickem/[sport]/page.js': /view\.contest\?\.voidAll && \([\s\S]{0,80}<VoidAllLabel/,
    'components/results/Results.js': /if \(v\.voidAll\)[\s\S]{0,600}\{v\.voidLabel\}/,
    'components/run/RunRoster.js': /view\.contest\.voidAll \? <span data-void-all="">\{view\.contest\.voidLabel\}/,
    'components/october/OctoberCard.js': /view\.contest\.voidAll \? <span data-void-all="">\{view\.contest\.voidLabel\}/,
    'components/home/WeeklyModule.js': /view\.voidAll \?[\s\S]{0,200}\{view\.voidLabel\}/,
    'components/home/DraftModule.js': /view\.voidAll \?[\s\S]{0,200}\{view\.voidLabel\}/,
  };
  for (const [f, re] of Object.entries(VIEWS)) assert.match(src(f), re, f);
  // The void branch comes BEFORE the grade: on the Weekly and the Draft the
  // grade component is never reached for a void week.
  for (const [f, grade] of [['app/weekly/page.js', '<WeeklyGrade'], ['app/draft/page.js', '<DraftGrade']]) {
    const s = src(f);
    assert.ok(s.indexOf('if (v.voidAll)') < s.indexOf(grade), `${f}: void branch before ${grade}`);
  }
  assert.match(src('components/games/VoidAllLabel.js'), /\{VOID_ALL_LABEL\}/);
});

test('THE VIEW SHAPES carry the flag the views read', () => {
  assert.match(src('lib/pickem/entry.js'), /voidAll,\n\s*voidLabel: voidAll \? VOID_ALL_LABEL : null,/);
  assert.match(src('lib/run/entry.js'), /isDnf: !voidAll && state\.state === DNF/);
  assert.match(src('lib/run/entry.js'), /total: voidAll \? null : card\.total/);
  assert.match(src('lib/october/entry.js'), /isDnf: !voidAll && day\.state === DNF/);
  assert.match(src('lib/october/entry.js'), /total: voidAll \? null : card\.total/);
});

// ---------------------------------------------------------------------------
// THE AUDIT, PINNED: the SQL readers that count or pick settled contests skip
// void_all. The DB half runs boardsPlayedCount and the two lobby pickers.
// ---------------------------------------------------------------------------
const VA = /NOT COALESCE\(\((?:c\.)?meta->>'void_all'\)::boolean, false\)/;
test('SQL readers skip void_all: counts, "latest settled" pickers, season tables, admin', () => {
  const read = src('lib/games/read.js');
  const body = (name) => { const i = read.indexOf(name); return read.slice(i, read.indexOf('\n}\n', i)); };
  assert.match(body('async function pickemTable('), VA, 'pickemTable: N boards settled');
  assert.match(body('async function boardsPlayedCount('), VA, 'boardsPlayedCount');
  assert.match(body('async function fieldStrip('), VA, 'fieldStrip: boards settled');
  const lob = src('lib/games/lobbyV3.js');
  const lbody = (name) => { const i = lob.indexOf(name); return lob.slice(i, lob.indexOf('\n}\n', i)); };
  assert.match(lbody('async function pickemBoardV3('), VA);
  assert.match(lbody('async function draftBoardV3('), VA);
  assert.match(lbody('async function weeklyBoardV3('), /isVoidAll\(contest\)\) return \{ rows: \[\], empty: VOID_ALL_LABEL \}/);
  assert.match(src('lib/admin/reads.js'), /COALESCE\(\(c\.meta->>'void_all'\)::boolean, false\) THEN 'Void'/);
  // Already handled on run-void-all, kept honest here.
  assert.match(src('lib/leagues/results.js'), VA);
  assert.match(src('lib/settle/regrade.js'), VA);
});

// ---------------------------------------------------------------------------
// THE CENSUS GUARD: the closers. A new game that starts closing void_all must
// come through here, because its settled views are not covered until it does.
// ---------------------------------------------------------------------------
test('CLOSERS: closeVoidAll is called from exactly the settles this audit covers (four, plus Six / EPL5 / NBA day from void-rulings-2)', () => {
  const callers = [];
  const walk = (dir) => {
    for (const n of readdirSync(path.join(REPO, dir))) {
      const rel = path.join(dir, n);
      if (statSync(path.join(REPO, rel)).isDirectory()) walk(rel);
      else if (/\.js$/.test(n) && rel !== path.join('lib', 'settle', 'voidRule.js') && /await closeVoidAll\(sql/.test(src(rel))) callers.push(rel);
    }
  };
  walk('lib');
  assert.deepEqual(callers.sort(), [
    'lib/eplWeekly5/settle.js', 'lib/nba/dayPickem.js',
    'lib/october/settle.js', 'lib/pickem/settle.js', 'lib/run/settle.js',
    'lib/six/settle.js', 'lib/weekly/settle.js',
  ]);
});
