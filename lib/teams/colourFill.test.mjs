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
import { CFB_STATIC_COLORS } from '../cfb/teamColors.js';
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

test('planColourFill: both-NULL rows only; primary-only allowed; static fallback only when the source has no primary', () => {
  const colours = new Map([
    ['1', { primary: '#111111', secondary: '#222222', source: 's1' }],
    ['2', { primary: '#333333', secondary: null, source: 's2' }],
    ['3', { primary: null, secondary: null, source: 's3' }],
    ['4', { primary: '#444444', secondary: '#555555', source: 's4' }],
    ['6', { primary: '#666666', secondary: null, source: 's6' }],
  ]);
  const fallback = new Map([
    ['3', { primary: '#AAAAAA', secondary: '#BBBBBB', source: 'static3' }],
    ['6', { primary: '#CCCCCC', secondary: '#DDDDDD', source: 'static6' }],
    ['99', { primary: '#EEEEEE', secondary: '#FFFFFF', source: 'static99' }],
  ]);
  const teams = [
    { id: 10, name: 'Fill', key: '1', color_primary: null, color_secondary: null },
    { id: 11, name: 'PrimaryOnly', key: '2', color_primary: null, color_secondary: null },
    { id: 12, name: 'NoneInSource', key: '3', color_primary: null, color_secondary: null },
    { id: 13, name: 'Coloured', key: '4', color_primary: '#ABCDEF', color_secondary: null },
    { id: 16, name: 'SourceWins', key: '6', color_primary: null, color_secondary: null },
    { id: 14, name: 'Missing', key: '98', color_primary: null, color_secondary: null },
    { id: 15, name: 'NoKey', key: null, color_primary: null, color_secondary: null },
    { id: 17, name: 'NotInSourceStatic', key: '99', color_primary: null, color_secondary: null },
  ];
  const p = planColourFill(teams, colours, { fallback });
  assert.deepEqual(p.fills.map((f) => [f.id, f.primary, f.secondary, f.primaryOnly, f.source]), [
    [10, '#111111', '#222222', false, 's1'],
    [11, '#333333', null, true, 's2'],
    [12, '#AAAAAA', '#BBBBBB', false, 'static3'],
    [16, '#666666', null, true, 's6'],            // CFBD had a primary: the static table is not consulted
    [17, '#EEEEEE', '#FFFFFF', false, 'static99'],
  ]);
  assert.equal(p.alreadyColoured, 1, 'a half-coloured row is never touched');
  assert.deepEqual(p.unfilled.map((u) => [u.id, u.reason]), [[14, 'not in source'], [15, 'no join key']]);
  // without a fallback, a source with no primary is unfilled
  const bare = planColourFill([teams[2]], colours);
  assert.deepEqual(bare.unfilled.map((u) => u.reason), ['source has no primary']);
});

test('CFB static table: LIU (cfbd 2341) and UTRGV (cfbd 292) only, full pairs with a cited source', () => {
  assert.deepEqual(Object.keys(CFB_STATIC_COLORS).sort(), ['2341', '292']);
  assert.equal(CFB_STATIC_COLORS['2341'].name, 'Long Island University');
  assert.equal(CFB_STATIC_COLORS['292'].name, 'UT Rio Grande Valley');
  for (const [k, c] of Object.entries(CFB_STATIC_COLORS)) {
    for (const f of ['primary', 'secondary']) assert.match(c[f], /^#[0-9A-F]{6}$/, `${k} ${f}`);
    assert.notEqual(c.primary, c.secondary, k);
    assert.ok(c.source, k);
  }
  const src = readFileSync(path.join(REPO, 'lib/cfb/teamColors.js'), 'utf8');
  assert.match(src, /https:\/\/post\.liuathletics\.com\//, 'LIU cites its athletics site');
  assert.match(src, /https:\/\/www\.utrgv\.edu\/brand\//, 'UTRGV cites its brand palette');
});

test('EPL table: 20 clubs, home-kit pairs, valid uppercase hex, primary != secondary, a cited source each', () => {
  // the mon-24 rulings, verbatim
  const ruled = { brighton: ['#0057B8', '#FFFFFF'], fulham: ['#FFFFFF', '#000000'], leeds: ['#FFFFFF', '#1D428A'],
    liverpool: ['#C8102E', '#FFFFFF'], tottenham: ['#FFFFFF', '#132257'] };
  for (const [slug, [p1, p2]] of Object.entries(ruled)) assert.deepEqual([EPL_COLORS[slug].primary, EPL_COLORS[slug].secondary], [p1, p2], slug);
  const src = readFileSync(path.join(REPO, 'lib/soccer/teamColors.js'), 'utf8');
  assert.match(src, /https:\/\/www\.itfc\.co\.uk\//, 'Ipswich verified on the club site');
  assert.match(src, /https:\/\/www\.safc\.com\//, 'Sunderland verified on the club site');
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
  assert.match(m.get('crystal-palace').source, /^T: .*\[FLAG: /, 'flags ride into the printed source');
});

test('THE GUARD: the EPL and CFB tables are census-exempt by name, and the ratchet still holds', () => {
  assert.ok(CENSUS_EXEMPT.includes('lib/soccer/teamColors.js'));
  assert.ok(CENSUS_EXEMPT.includes('lib/cfb/teamColors.js'));
  const now = hexCensus(REPO);
  assert.equal(now.byFile['lib/soccer/teamColors.js'], undefined);
  assert.equal(now.byFile['lib/cfb/teamColors.js'], undefined);
  assert.equal(now.byFile['lib/teams/colourFill.js'], undefined, 'the fill logic writes no colour literal');
  const base = JSON.parse(readFileSync(path.join(REPO, 'lib/brand/hexBaseline.json'), 'utf8'));
  const grew = Object.entries(now.byFile).filter(([f, n]) => n > (base.byFile[f] ?? 0));
  assert.deepEqual(grew, []);
  assert.ok(now.total <= base.total);
});

test('A PRIMARY-ONLY team reads as "no colours": the gridiron reader returns null, so TeamMark draws the abbreviation ring disc', async () => {
  const { teamColors } = await import('../gridiron/readers.js');
  assert.equal(teamColors('#123456', null), null);
  assert.deepEqual(teamColors('#123456', '#654321'), { primary: '#123456', secondary: '#654321' });
  const mark = readFileSync(path.join(REPO, 'components/team/TeamMark.js'), 'utf8');
  assert.match(mark, /if \(!primary \|\| !secondary\) \{/, 'TeamMark falls back to the abbr disc when either colour is missing');
});

test('mon-25: a primary-only BLACK from the source is not stored - left for review; black with a secondary is kept', () => {
  const black = ['#', '000000'].join('');
  const teams = [
    { id: 1, name: 'North Alabama', key: '2453', color_primary: null, color_secondary: null },
    { id: 2, name: 'Bryant', key: '2803', color_primary: null, color_secondary: null },
    { id: 3, name: 'Austin Peay', key: '2046', color_primary: null, color_secondary: null },
  ];
  const colours = new Map([
    ['2453', { primary: black, secondary: null, source: 'cfbd' }],
    ['2803', { primary: black, secondary: ['#', '9F8343'].join(''), source: 'cfbd' }],
    ['2046', { primary: ['#', '8E0B0B'].join(''), secondary: null, source: 'cfbd' }],
  ]);
  const p = planColourFill(teams, colours);
  assert.deepEqual(p.fills.map((f) => [f.id, f.primaryOnly]), [[2, false], [3, true]]);
  assert.deepEqual(p.unfilled.map((u) => [u.id, u.reason]), [[1, 'primary-only black (CFBD placeholder) - left for review']]);
});
