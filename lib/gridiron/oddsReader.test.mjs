// lib/gridiron/oddsReader.test.mjs — h2h read shaping + home/away orientation.
// Run: node --test lib/gridiron/oddsReader.test.mjs
//
// oddsReader imports lib/db (binds neon(DATABASE_URL) at import), so .env.local is
// loaded before importing — but these tests exercise the PURE shaping (shapeH2hRows
// / sideFor) with synthetic rows and never touch the DB. (DEV carries no gridiron
// odds rows — the odds cron runs on PROD only — so a live-row assertion would be
// empty; the shaping logic is what's worth testing.)

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
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { shapeH2hRows, sideFor, shapeSpreadRows } = await import('./oddsReader.js');

test('sideFor: NFL exact names', () => {
  assert.equal(sideFor('Kansas City Chiefs', 'Kansas City Chiefs', 'Buffalo Bills'), 'home');
  assert.equal(sideFor('Buffalo Bills', 'Kansas City Chiefs', 'Buffalo Bills'), 'away');
});

test('sideFor: CFB label is School+Mascot, our name is school-only', () => {
  assert.equal(sideFor('Alabama Crimson Tide', 'Alabama', 'Georgia'), 'home');
  assert.equal(sideFor('Georgia Bulldogs', 'Alabama', 'Georgia'), 'away');
  assert.equal(sideFor('Nobody State', 'Alabama', 'Georgia'), null);
});

const nflRows = [
  { match_id: 1, selection_label: 'Kansas City Chiefs', american_odds: -160, implied: 61.53, decimal: 1.63, move_prob: 1.2, move_odds: -10, num_books: 6, source_books: ['DraftKings', 'FanDuel'], fetched_at: '2026-09-05T00:00:00Z', home_name: 'Kansas City Chiefs', home_abbr: 'KC', away_name: 'Buffalo Bills', away_abbr: 'BUF' },
  { match_id: 1, selection_label: 'Buffalo Bills', american_odds: 140, implied: 38.51, decimal: 2.40, move_prob: -1.2, move_odds: 8, num_books: 6, source_books: ['DraftKings', 'FanDuel'], fetched_at: '2026-09-05T00:00:00Z', home_name: 'Kansas City Chiefs', home_abbr: 'KC', away_name: 'Buffalo Bills', away_abbr: 'BUF' },
];

test('shapeH2hRows: orients home/away, carries movement + books', () => {
  const m = shapeH2hRows(nflRows);
  assert.equal(m.size, 1);
  const g = m.get(1);
  assert.equal(g.home.abbr, 'KC');
  assert.equal(g.away.abbr, 'BUF');
  assert.equal(g.home.american, -160);
  assert.equal(g.home.implied, 61.53);
  assert.equal(g.home.moveProb, 1.2);
  assert.equal(g.away.moveProb, -1.2);
  assert.equal(g.numBooks, 6);
  assert.deepEqual(g.sourceBooks, ['DraftKings', 'FanDuel']);
  assert.equal(g.fetchedAt, '2026-09-05T00:00:00Z');
});

test('shapeH2hRows: a one-sided match is dropped (absence over inference)', () => {
  const oneSided = [nflRows[0], { match_id: 2, selection_label: 'Ohio State Buckeyes', american_odds: -200, implied: 66.7, decimal: 1.5, move_prob: 0, move_odds: 0, num_books: 5, source_books: ['DraftKings'], fetched_at: '2026-09-05T00:00:00Z', home_name: 'Ohio State', home_abbr: 'OSU', away_name: 'Michigan', away_abbr: 'MICH' }];
  const m = shapeH2hRows(oneSided);
  assert.equal(m.size, 0); // match 1 lost its away row here, match 2 has no away row
});

test('shapeH2hRows: empty input', () => {
  assert.equal(shapeH2hRows([]).size, 0);
});

// --- spreads ----------------------------------------------------------------
// THE BOARD READS THE SAME PIPELINE THE MARKET PAGE DOES. shapeSpreadRows
// normalises to ONE home-based signed number per match; the favourite is
// derived from that sign downstream (lib/standings/view.js spreadLabel), which
// is why the board's wire carries three keys and not four.

const spreadRow = (o) => ({
  match_id: 1, home_name: 'TCU', away_name: 'North Carolina', ...o,
});

test('shapeSpreadRows: a home selection keeps its sign', () => {
  const m = shapeSpreadRows([spreadRow({ selection_label: 'TCU Horned Frogs', selection_value: -6.5 })]);
  assert.equal(m.get(1), -6.5);
});

test('shapeSpreadRows: an away selection is FLIPPED to home-based', () => {
  // The away side at +6.5 is the same market as the home side at -6.5.
  const m = shapeSpreadRows([spreadRow({ selection_label: 'North Carolina Tar Heels', selection_value: 6.5 })]);
  assert.equal(m.get(1), -6.5);
});

test('shapeSpreadRows: an unattributable row is dropped, never guessed', () => {
  const m = shapeSpreadRows([spreadRow({ selection_label: 'Nobody State', selection_value: -3 })]);
  assert.equal(m.size, 0);
});

test('shapeSpreadRows: a null or non-numeric value is not a zero', () => {
  // 0 is a real spread (a pick'em). Absence must not become one.
  assert.equal(shapeSpreadRows([spreadRow({ selection_label: 'TCU Horned Frogs', selection_value: null })]).size, 0);
  assert.equal(shapeSpreadRows([spreadRow({ selection_label: 'TCU Horned Frogs', selection_value: 'x' })]).size, 0);
});

test('shapeSpreadRows: one number per match, and empty input is an empty map', () => {
  const m = shapeSpreadRows([
    spreadRow({ selection_label: 'TCU Horned Frogs', selection_value: -6.5 }),
    spreadRow({ selection_label: 'North Carolina Tar Heels', selection_value: 6.5 }),
  ]);
  assert.equal(m.size, 1);
  assert.equal(shapeSpreadRows([]).size, 0);
});

test('ONE ODDS SOURCE: the board does not open its own odds_markets query', () => {
  // The relay's law - one surface, one source. If a board file starts reading
  // odds_markets itself, this fails rather than two readers drifting apart.
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of ['../pickem/entry.js', '../pickem/view.js', '../../components/pickem/PickemBoard.js']) {
    const code = strip(readFileSync(new URL(f, import.meta.url), 'utf8'));
    assert.equal(code.includes('odds_markets'), false, `${f} queries odds_markets directly`);
  }
});
