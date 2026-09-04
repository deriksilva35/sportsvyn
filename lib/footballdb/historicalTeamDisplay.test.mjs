import test from 'node:test';
import assert from 'node:assert/strict';
import { displayTeamCode } from './historicalTeamDisplay.js';

const CURRENT_ABBREVIATIONS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET',
  'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE',
  'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH',
]);

const HISTORICAL_NAMES = [
  'Houston Oilers', 'Tennessee Oilers', 'St. Louis Cardinals', 'Phoenix Cardinals',
  'Baltimore Colts', 'San Diego Chargers', 'Los Angeles Raiders', 'Oakland Raiders',
  'St. Louis Rams', 'Washington Redskins',
];

// Franchise lineage: which of the ten historical names is the SAME real team
// as a current, already-resolved franchise (so reusing that franchise's
// current code is correct, not a collision).
const SAME_FRANCHISE_AS_CURRENT = {
  'Tennessee Oilers': 'TEN',     // -> Titans
  'Washington Redskins': 'WSH',  // -> Commanders
};

test('a real abbreviation passes through unchanged', () => {
  for (const abbr of CURRENT_ABBREVIATIONS) assert.equal(displayTeamCode(abbr), abbr);
});

test('every historical name maps to something', () => {
  for (const name of HISTORICAL_NAMES) {
    const code = displayTeamCode(name);
    assert.notEqual(code, name, `${name} should get a real short code, not fall through unchanged`);
  }
});

test('no historical code collides with a DIFFERENT current franchise', () => {
  // The whole point of this file: HOU/BAL would silently rename the Oilers/
  // Colts as the (unrelated) Texans/Ravens on a card. Assert the general
  // property, not just the two cases already caught, so a future addition
  // to the map can't reintroduce it.
  for (const name of HISTORICAL_NAMES) {
    const code = displayTeamCode(name);
    if (CURRENT_ABBREVIATIONS.has(code)) {
      assert.equal(
        SAME_FRANCHISE_AS_CURRENT[name], code,
        `"${name}" -> "${code}" collides with a current team's real abbreviation, and they are not the same franchise`,
      );
    }
  }
});

test('no two historical names share a display code, except true same-franchise lineage', () => {
  const seen = new Map();
  for (const name of HISTORICAL_NAMES) {
    const code = displayTeamCode(name);
    if (seen.has(code)) {
      const other = seen.get(code);
      // Only lineage pairs (same real franchise, different era) may share a
      // code: Oilers eras share nothing here (HOU vs TEN, deliberately
      // distinct), so any collision found by this test is a real bug.
      assert.fail(`"${name}" and "${other}" both display as "${code}"`);
    }
    seen.set(code, name);
  }
});

test('an unrecognized string falls back to itself rather than throwing', () => {
  assert.equal(displayTeamCode('Some Unknown Team'), 'Some Unknown Team');
});
