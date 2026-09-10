// lib/gridiron/teamColors.test.mjs - the nflverse join, pure; and the DB
// state after ingest: every NFL team dressed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nflColorRows, NFLVERSE_ABBR_MAP, NFLVERSE_RETIRED } from './teamColors.js';
import { parseCsv } from './nflverse.js';

const CSV = `team_abbr,team_name,team_id,team_nick,team_conf,team_division,team_color,team_color2,team_color3,team_color4
ARI,Arizona Cardinals,3800,Cardinals,NFC,NFC West,#97233F,#000000,#ffb612,#a5acaf
LA,Los Angeles Rams,2510,Rams,NFC,NFC West,#003594,#FFD100,#001532,#af925d
LAR,Los Angeles Rams,2510,Rams,NFC,NFC West,#003594,#FFD100,#001532,#af925d
LAC,Los Angeles Chargers,4400,Chargers,AFC,AFC West,#007BC7,#ffc20e,#ffb612,#001532
LV,Las Vegas Raiders,2520,Raiders,AFC,AFC West,#000000,#A5ACAF,#a6aeb0,#000000
OAK,Oakland Raiders,2520,Raiders,AFC,AFC West,#000000,#A5ACAF,#a6aeb0,#000000
SD,San Diego Chargers,4400,Chargers,AFC,AFC West,#007BC7,#ffc20e,#ffb612,#001532
STL,St. Louis Rams,2510,Rams,NFC,NFC West,#003594,#FFD100,#001532,#af925d
WAS,Washington Commanders,5110,Commanders,NFC,NFC East,#5A1414,#FFB612,#ffb612,#5a1414
`;

test('nflverse codes map onto ours: LA -> LAR, WAS -> WSH; LAC and LV already agree; retired codes are dropped', () => {
  assert.deepEqual(NFLVERSE_ABBR_MAP, { LA: 'LAR', WAS: 'WSH' });
  assert.deepEqual([...NFLVERSE_RETIRED].sort(), ['OAK', 'SD', 'STL']);
  const rows = nflColorRows(parseCsv(CSV));
  assert.deepEqual(rows.map((r) => r.abbreviation), ['ARI', 'LAC', 'LAR', 'LV', 'WSH']);
  assert.deepEqual(rows.find((r) => r.abbreviation === 'LAR'), { abbreviation: 'LAR', primary: '#003594', secondary: '#FFD100' });
  assert.deepEqual(rows.find((r) => r.abbreviation === 'WSH'), { abbreviation: 'WSH', primary: '#5A1414', secondary: '#FFB612' });
  assert.equal(rows.find((r) => r.abbreviation === 'LAC').secondary, '#FFC20E', 'hex is normalised upper-case with the #');
});

test('a row missing a color, or with a bad hex, is left out rather than half-written', () => {
  const rows = nflColorRows([{ team_abbr: 'X', team_color: '#123456', team_color2: '' }, { team_abbr: 'Y', team_color: 'blue', team_color2: '#123456' }, { team_abbr: 'Z', team_color: '123456', team_color2: '#abcdef' }]);
  assert.deepEqual(rows, [{ abbreviation: 'Z', primary: '#123456', secondary: '#ABCDEF' }]);
});

test('the feed contradicting itself on one team throws instead of picking silently', () => {
  assert.throws(() => nflColorRows([{ team_abbr: 'LA', team_color: '#003594', team_color2: '#FFD100' }, { team_abbr: 'LAR', team_color: '#000000', team_color2: '#FFD100' }]), /disagrees/);
});

test('after ingest every NFL team carries both colors, hex with the #', async () => {
  const { sql } = await import('../db.js');
  const rows = await sql`SELECT t.abbreviation, t.color_primary, t.color_secondary FROM teams t JOIN leagues l ON l.id = t.league_id WHERE l.slug = 'nfl' ORDER BY 1`;
  assert.equal(rows.length, 32);
  for (const r of rows) {
    assert.match(r.color_primary ?? '', /^#[0-9A-F]{6}$/, `${r.abbreviation} primary`);
    assert.match(r.color_secondary ?? '', /^#[0-9A-F]{6}$/, `${r.abbreviation} secondary`);
  }
});
