// lib/teams/colourFill.test.mjs - the pure half of scripts/team-colours-fill.mjs
// (mon-22): hex normalisation, a CFBD /teams row -> colours, the fill plan
// (fill NULLs only, never a half pair), the EPL table's completeness, and the
// colour-literal ratchet still holding with the table in place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normHex, cfbdColourRow, cfbdColourMap, staticColourMap, planColourFill } from './colourFill.js';
import { EPL_COLORS } from '../soccer/teamColors.js';
import { hexCensus, CENSUS_EXEMPT } from '../brand/hexCensus.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('normHex: hash added, uppercased, trimmed; anything not six hex digits is null', () => {
  assert.equal(normHex('592d82'), '#592D82');
  assert.equal(normHex(' #abcdef '), '#ABCDEF');
  assert.equal(normHex('#ABCDEF'), '#ABCDEF');
  for (const bad of [null, undefined, '', 'null', '#fff', '12345', '1234567', 'ggggggg', '#12345G']) assert.equal(normHex(bad), null, String(bad));
});

test('cfbdColourRow: color + alternateColor, keyed on the id as a string', () => {
  assert.deepEqual(cfbdColourRow({ id: 2000, school: 'Abilene Christian', color: '#592d82', alternateColor: 'b1b3b3' }),
    { key: '2000', name: 'Abilene Christian', primary: '#592D82', secondary: '#B1B3B3' });
  assert.deepEqual(cfbdColourRow({ id: 2046, school: 'Austin Peay', color: '#8e0b0b', alternateColor: null }),
    { key: '2046', name: 'Austin Peay', primary: '#8E0B0B', secondary: null });
  const m = cfbdColourMap([{ id: 13, school: 'Cal Poly', color: '1e4d2b', alternateColor: 'bd8b13' }, { school: 'no id' }]);
  assert.equal(m.size, 1);
  assert.equal(m.get('13').primary, '#1E4D2B');
  assert.match(m.get('13').source, /CFBD \/teams id 13 \(Cal Poly\)/);
});

test('planColourFill: only both-NULL rows, only full pairs; the rest listed with a reason', () => {
  const colours = new Map([
    ['1', { primary: '#111111', secondary: '#222222', source: 's1' }],
    ['2', { primary: '#333333', secondary: null, source: 's2' }],
    ['3', { primary: null, secondary: null, source: 's3' }],
    ['4', { primary: '#444444', secondary: '#555555', source: 's4' }],
  ]);
  const teams = [
    { id: 10, name: 'Fill', key: '1', color_primary: null, color_secondary: null },
    { id: 11, name: 'HalfSource', key: '2', color_primary: null, color_secondary: null },
    { id: 12, name: 'NoneSource', key: '3', color_primary: null, color_secondary: null },
    { id: 13, name: 'Coloured', key: '4', color_primary: '#ABCDEF', color_secondary: null },
    { id: 14, name: 'Missing', key: '99', color_primary: null, color_secondary: null },
    { id: 15, name: 'NoKey', key: null, color_primary: null, color_secondary: null },
  ];
  const p = planColourFill(teams, colours);
  assert.deepEqual(p.fills, [{ id: 10, name: 'Fill', primary: '#111111', secondary: '#222222', source: 's1' }]);
  assert.equal(p.alreadyColoured, 1, 'a half-coloured row is never touched');
  assert.deepEqual(p.unfilled.map((u) => [u.id, u.reason]), [
    [11, 'source lacks secondary'], [12, 'source lacks both colours'], [14, 'not in source'], [15, 'no join key'],
  ]);
});

test('EPL table: 20 clubs, valid uppercase hex, primary != secondary, a cited source each', () => {
  const rows = Object.entries(EPL_COLORS);
  assert.equal(rows.length, 20);
  for (const [slug, c] of rows) {
    assert.match(slug, /^[a-z0-9-]+$/, slug);
    assert.ok(c.name, `${slug} name`);
    for (const k of ['primary', 'secondary']) {
      assert.match(c[k], /^#[0-9A-F]{6}$/, `${slug} ${k}`);
      assert.equal(normHex(c[k]), c[k], `${slug} ${k} already normalised`);
    }
    assert.notEqual(c.primary, c.secondary, `${slug} pair is two colours`);
    assert.ok(c.source && c.source.length > 5, `${slug} cites a source`);
  }
  const m = staticColourMap(EPL_COLORS, 'T');
  assert.equal(m.size, 20);
  assert.match(m.get('tottenham').source, /^T: .*\[FLAG: /, 'flags ride into the printed source');
});

test('THE GUARD: the EPL table is census-exempt by name, and the ratchet still holds', () => {
  assert.ok(CENSUS_EXEMPT.includes('lib/soccer/teamColors.js'));
  const now = hexCensus(REPO);
  assert.equal(now.byFile['lib/soccer/teamColors.js'], undefined);
  assert.equal(now.byFile['lib/teams/colourFill.js'], undefined, 'the fill logic writes no colour literal');
  const base = JSON.parse(readFileSync(path.join(REPO, 'lib/brand/hexBaseline.json'), 'utf8'));
  const grew = Object.entries(now.byFile).filter(([f, n]) => n > (base.byFile[f] ?? 0));
  assert.deepEqual(grew, []);
  assert.ok(now.total <= base.total);
});
