// lib/gridiron/roster.test.mjs - two providers, one column shape.
//
// The test that matters is the CONVERGENCE one: a real BDL display string and a
// real CFBD number describing the same body must land on the same value. Two
// providers writing different meanings into one column is the yards_to_goal
// mistake, and this is the same column-level guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  heightFromBdl, heightFromInches, weightToKg, experienceYears,
  positionGroup, fromBdl, fromCfbd,
} from './roster.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// Verbatim from the live probes.
const BDL_ROW = {
  id: 1, first_name: 'Thomas', last_name: 'Morstead', position: 'Punter',
  position_abbreviation: 'P', height: "6' 4\"", weight: '225 lbs',
  jersey_number: '7', college: 'SMU', experience: '17th Season', age: 40,
  team: { id: 30, abbreviation: 'SF' },
};
const CFBD_ROW = {
  id: '4032497', firstName: 'Jake', lastName: 'Helms', team: 'Air Force',
  weight: 210, height: 72, jersey: 42, year: 3, position: 'LS',
};

// ------------------------------------------------------- convergence

test('BOTH PROVIDERS LAND ON ONE SHAPE - a 6\'4" string and 76 inches agree', () => {
  // The same body, described two ways by two vendors.
  assert.equal(heightFromBdl("6' 4\""), 193);
  assert.equal(heightFromInches(76), 193);
  assert.equal(heightFromBdl("6' 4\""), heightFromInches(76));
});

test('weight converges from a display string and a bare number', () => {
  assert.equal(weightToKg('225 lbs'), weightToKg(225));
  assert.equal(weightToKg('225 lbs'), 102.06);
  assert.equal(weightToKg(210), 95.25);
});

test('weight keeps enough precision to round-trip to the stated pounds', () => {
  // Integer kilos would turn 225 lb into 224.9 lb - a weight the provider never
  // said. Two decimals survive the round trip.
  const kg = weightToKg('225 lbs');
  assert.equal(Math.round(kg / 0.45359237), 225);
});

test('experience is one integer scale across both vocabularies', () => {
  assert.equal(experienceYears('17th Season'), 17);
  assert.equal(experienceYears('2nd Season'), 2);
  assert.equal(experienceYears('Rookie'), 1, 'a rookie is season ONE, not zero');
  assert.equal(experienceYears(3), 3);
  assert.equal(experienceYears(null), null);
});

test('an unparseable measurement is NULL, never zero', () => {
  // A 0cm player is a lie the roster would render as fact; null is an honest gap.
  for (const v of [null, undefined, '', 'unknown', 'N/A', 0, -5]) {
    assert.equal(heightFromBdl(v), null, `height ${JSON.stringify(v)}`);
    assert.equal(weightToKg(v === 0 || v === -5 ? String(v) : v), null, `weight ${JSON.stringify(v)}`);
  }
  assert.equal(heightFromInches(0), null);
});

// ------------------------------------------------------- bucketing

test('position groups are sane for real gridiron positions', () => {
  for (const [p, g] of [['QB','OFF'],['RB','OFF'],['WR','OFF'],['TE','OFF'],['OT','OFF'],['LS','OFF'],
                        ['DE','DEF'],['DT','DEF'],['LB','DEF'],['CB','DEF'],['S','DEF'],['EDGE','DEF'],
                        ['K','ST'],['P','ST']]) {
    assert.equal(positionGroup(p), g, `${p} should be ${g}`);
  }
});

test('BDL sends WORDS, not abbreviations - both resolve', () => {
  assert.equal(positionGroup('Punter', 'P'), 'ST');
  assert.equal(positionGroup('Punter'), 'ST', 'the word alone still resolves');
  assert.equal(positionGroup('Quarterback'), 'OFF');
  // The abbreviation wins when both are present and disagree.
  assert.equal(positionGroup('Quarterback', 'K'), 'ST');
});

test('an unknown position returns NULL rather than a wrong bucket', () => {
  // Same law as an unmapped drive result: name it, do not guess it.
  assert.equal(positionGroup('Sousaphone'), null);
  assert.equal(positionGroup(null), null);
});

test('specialists are their own group, not swept into OTHER', () => {
  // A 53-man roster with kicker and punter buried under OTHER is the bug
  // SquadList's GK/DEF/MID/ATT vocabulary would have produced for every
  // gridiron player.
  assert.equal(positionGroup('K'), 'ST');
  assert.equal(positionGroup('P'), 'ST');
  assert.notEqual(positionGroup('K'), positionGroup('QB'));
});

// ------------------------------------------------------- row mapping

test('a real BDL row maps whole', () => {
  const p = fromBdl(BDL_ROW);
  assert.equal(p.fullName, 'Thomas Morstead');
  assert.equal(p.position, 'P');
  assert.equal(p.positionGroup, 'ST');
  assert.equal(p.jersey, 7);
  assert.equal(p.heightCm, 193);
  assert.equal(p.weightKg, 102.06);
  assert.equal(p.college, 'SMU');
  assert.equal(p.experienceYears, 17);
  assert.equal(p.providerTeamId, '30');
  assert.equal(p.providerKey, 'bdl_player_id');
});

test('a real CFBD row maps whole, and college is NULL by design', () => {
  const p = fromCfbd(CFBD_ROW);
  assert.equal(p.fullName, 'Jake Helms');
  assert.equal(p.position, 'LS');
  assert.equal(p.positionGroup, 'OFF');
  assert.equal(p.jersey, 42);
  assert.equal(p.heightCm, 183);
  assert.equal(p.weightKg, 95.25);
  assert.equal(p.experienceYears, 3);
  // Not missing - for a college player the TEAM is the college.
  assert.equal(p.college, null);
  assert.equal(p.providerTeamName, 'Air Force');
});

// ------------------------------------------------------- safety

test('the migration is additive - no soccer column is altered', () => {
  const m = src('migrations/076_gridiron_roster.sql');
  assert.match(m, /ADD COLUMN IF NOT EXISTS weight_kg/);
  assert.match(m, /ADD COLUMN IF NOT EXISTS college/);
  assert.match(m, /ADD COLUMN IF NOT EXISTS experience_years/);
  assert.match(m, /ADD COLUMN IF NOT EXISTS position_group/);
  assert.doesNotMatch(m, /DROP COLUMN|ALTER COLUMN|UPDATE players|DELETE/i);
});

test('the import is idempotent and cannot touch a soccer row', () => {
  const imp = src('lib/gridiron/rosterImport.js');
  // Keyed on the provider id via a PARTIAL unique index, so a re-import updates
  // in place - and batched, because per-row upserts measured ~4 rows/sec.
  assert.match(imp, /ON CONFLICT \(\(external_ids->>'\$\{providerKey\}'\)\) WHERE external_ids \? '\$\{providerKey\}'/);
  assert.match(imp, /DO UPDATE SET/);
  const m = src('migrations/076_gridiron_roster.sql');
  assert.match(m, /CREATE UNIQUE INDEX IF NOT EXISTS players_bdl_player_uniq/);
  assert.match(m, /CREATE UNIQUE INDEX IF NOT EXISTS players_cfbd_player_uniq/);
  // PARTIAL is what keeps the index off the 1,248 soccer rows.
  assert.match(m, /WHERE external_ids \? 'bdl_player_id'/);
  // A World Cup player carries neither provider key, so the UPDATE cannot find
  // them and the INSERT writes a gridiron-tagged slug.
  assert.match(imp, /const tag = providerKey === 'bdl_player_id' \? 'nfl' : 'cfb';/);
});

test('CFB is ONE request, filtered in code - not 243 per-team calls', () => {
  const imp = src('lib/gridiron/rosterImport.js');
  assert.match(imp, /cfbdGet\(`\/roster\?year=\$\{season\}`\)/);
  assert.doesNotMatch(imp, /roster\?team=/, 'no per-team fetching');
  // The scope is applied to what we keep.
  assert.match(imp, /if \(teamId == null\) \{ skipped\+\+; continue; \}/);
});
