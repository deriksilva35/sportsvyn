// lib/briefGates.test.mjs - gateCountClaims: arithmetic the other gates miss.
//
// Both are PURE: a parsed brief and an envelope in, a verdict out. No model, no
// database, no network - which is the only reason they can pin behaviour that
// only shows up once a night during a preseason.
//
// (1) gateHallucination rejected "Mercedes-Benz Stadium" - a venue the envelope
//     itself supplied - because the checker and the source-token collector
//     normalised hyphens differently.
// (2) gateCountClaims did not exist, so "all three Washington touchdowns" went
//     out over a game in which Washington scored two.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { gateCountClaims, COUNT_CLAIMS_BLOCKING } = await import('./aiBrief.js');

// The 14 Aug Miami-at-Washington envelope, trimmed to what the gates read.
// Washington: 2 TD + 2 FG = 20. Miami: 1 TD = 7. Q1 MIA 7, Q2 WAS 17, Q4 WAS 3.
const WAS = 'Washington Commanders';
const MIA = 'Miami Dolphins';
const ENV = {
  match: {
    league: 'NFL',
    round: 'Preseason · Week 1',
    venue: 'Northwest Stadium, Landover',
    teams: { home: WAS, away: MIA },
    score: { home: 20, away: 7 },
    scoring_counts: {
      total_scoring_plays: 5,
      by_team: { [MIA]: { TD: 1 }, [WAS]: { FG: 2, TD: 2 } },
      points_by_quarter_by_team: {
        First: { [MIA]: 7 }, Second: { [WAS]: 17 }, Fourth: { [WAS]: 3 },
      },
      touchdowns_by_scoring_player: { 'Devon Achane': 1, 'Robert Henry': 1, 'Kaytron Allen': 1 },
      field_goals_by_kicker: { 'Jake Moody': 1, 'Drew Stevens': 1 },
    },
  },
  events: [
    { quarter: 'First', clock: "7:54", type: 'TD', team: MIA, player: 'Devon Achane', detail: "De'Von Achane 1 Yd Rush (Riley Patterson Kick)" },
    { quarter: 'Second', clock: '10:13', type: 'FG', team: WAS, player: 'Jake Moody', detail: 'Jake Moody 29 Yd Field Goal' },
    { quarter: 'Second', clock: '4:28', type: 'TD', team: WAS, player: 'Robert Henry', detail: 'Robert Henry Jr. 22 Yd Rush (Drew Stevens Kick)' },
    { quarter: 'Second', clock: '0:08', type: 'TD', team: WAS, player: 'Kaytron Allen', detail: 'Kaytron Allen 1 Yd Rush (Jake Moody Kick)' },
    { quarter: 'Fourth', clock: '6:25', type: 'FG', team: WAS, player: 'Drew Stevens', detail: 'Drew Stevens 41 Yd Field Goal' },
  ],
};

// A DETECTED issue suppresses the brief only while the gate BLOCKS. These
// tests assert DETECTION - the reason - and let the verdict follow the
// switch, so flipping it back does not rewrite the suite.
const DETECTED = 'detected: verdict follows COUNT_CLAIMS_BLOCKING';

const brief = (p1, extra = {}) => ({
  headline: 'Washington Commanders beat Miami Dolphins twenty to seven',
  paragraph_1: p1,
  paragraph_2: 'A preseason result with nothing attached to it.',
  paragraph_3: null,
  ...extra,
});

// ---------------------------------------------------------------------------
// gateCountClaims
// ---------------------------------------------------------------------------

test('THE 14 AUG CLAIM: "all three Washington touchdowns" fails against TD:2', () => {
  const r = gateCountClaims(brief('Together they accounted for all three Washington touchdowns on the ground.'), ENV);
  assert.equal(r.pass, !COUNT_CLAIMS_BLOCKING, DETECTED);
  assert.match(r.reason, /3 touchdowns/);
  assert.match(r.reason, /Washington Commanders/);
});

test('the correct count passes: "two touchdowns" for Washington', () => {
  assert.equal(gateCountClaims(brief('Washington scored two touchdowns on the ground.'), ENV).pass, true);
});

test('a number word in an unrelated phrase does not trigger the gate', () => {
  const sentences = [
    'Achane rushed in from one yard out to open the scoring.',
    'Stevens extended the lead with a 41-yard field goal in the fourth quarter.',
    'Moody converted a 29-yard field goal.',
    'Allen carried 23 times for 85 yards and a touchdown.',
    'Washington won 20-7 at home.',
    'Allen punched in a one-yard score with eight seconds left in the half.',
  ];
  for (const s of sentences) {
    const r = gateCountClaims(brief(s), ENV);
    assert.equal(r.pass, true, `false positive on: ${s} -> ${r.reason}`);
  }
});

test('THE 14 AUG QUARTER CLAIM: "20 points ... second quarter" fails (it was 17)', () => {
  const r = gateCountClaims(brief('Washington answered with 20 consecutive points across the second quarter.'), ENV);
  assert.equal(r.pass, !COUNT_CLAIMS_BLOCKING, DETECTED);
  assert.match(r.reason, /Second quarter/);
});

test('the corrected quarter claim passes: 17 in the second', () => {
  assert.equal(gateCountClaims(brief('Washington responded in the second quarter with 17 unanswered points.'), ENV).pass, true);
});

test('a combined-team count may not be attached to one team', () => {
  // 3 is the real game-wide touchdown total - correct unattributed...
  assert.equal(gateCountClaims(brief('The game produced three touchdowns.'), ENV).pass, true);
  // ...and wrong the moment it is pinned to a team that scored two.
  assert.equal(gateCountClaims(brief('Washington scored three touchdowns.'), ENV).pass, !COUNT_CLAIMS_BLOCKING, DETECTED);
});

test('field goals are counted separately from touchdowns', () => {
  assert.equal(gateCountClaims(brief('Washington kicked two field goals.'), ENV).pass, true);
  assert.equal(gateCountClaims(brief('Washington kicked four field goals.'), ENV).pass, !COUNT_CLAIMS_BLOCKING, DETECTED);
});

test('the gate is gridiron-only: an envelope with no scoring_counts passes', () => {
  const soccer = { match: { teams: { home: 'France', away: 'Brazil' }, score: { home: 2, away: 1 } }, events: [] };
  assert.equal(gateCountClaims(brief('France scored nine goals and seven touchdowns.'), soccer).pass, true);
});

// ---------------------------------------------------------------------------
// ADVISORY MODE - flipped 15 Aug
// ---------------------------------------------------------------------------

test('ADVISORY: the gate DETECTS but does not BLOCK', () => {
  const r = gateCountClaims(brief('Together they accounted for all three Washington touchdowns.'), ENV);
  assert.equal(r.pass, true, 'advisory: a suspected miscount must not suppress the brief');
  assert.equal(r.advisory, true);
  assert.match(r.reason, /3 touchdowns/, 'but the finding is still reported, for the ledger');
});

test("ADVISORY: tonight's three false positives no longer suppress anything", () => {
  // The evening that caused the flip. Every one of these is CORRECT prose the
  // gate rejected, and every one must now pass.
  const cases = [
    'Reichard cut the lead to four with a 54-yard field goal at 8:02 of the third.',
    'Keenum finished 9-of-10 for 151 yards and two touchdowns operating the Bears offense.',
    'Santos added four extra points, accounting for 14 of Chicago 34 points.',
  ];
  for (const c of cases) assert.equal(gateCountClaims(brief(c), ENV).pass, true, c);
});

test('the blocking switch is a single constant, and it is currently OFF', () => {
  assert.equal(COUNT_CLAIMS_BLOCKING, false);
});
