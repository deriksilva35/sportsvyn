// lib/briefGateNames.test.mjs - the hyphen defect in gateHallucination.
//
// On 14 Aug the gate rejected "Mercedes-Benz Stadium" - a venue the ENVELOPE
// ITSELF supplied - and published a deterministic template over a correct
// brief. The checker and the source-token collector normalised hyphens
// differently: tokenizeName SPLITS ("mercedes","benz"), the checker STRIPPED
// ("mercedesbenz"), and a concatenation matches neither half.
//
// PURE: a parsed brief and an envelope in, a verdict out.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { gateHallucination, tokenizeName, findReferencedNames } = await import('./aiBrief.js');

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

const brief = (p1, extra = {}) => ({
  headline: 'Washington Commanders beat Miami Dolphins twenty to seven',
  paragraph_1: p1,
  paragraph_2: 'A preseason result with nothing attached to it.',
  paragraph_3: null,
  ...extra,
});

// ---------------------------------------------------------------------------
// gateHallucination — the hyphen defect
// ---------------------------------------------------------------------------

test('tokenizeName splits hyphens, and the checker must agree', () => {
  const t = new Set();
  tokenizeName('Mercedes-Benz Stadium, Atlanta', t);
  assert.deepEqual([...t].sort(), ['atlanta', 'benz', 'mercedes', 'stadium']);
});

test("THE 14 AUG REJECTION: a hyphenated venue present in source must pass", () => {
  const env = { ...ENV, match: { ...ENV.match, venue: 'Mercedes-Benz Stadium, Atlanta' } };
  const r = gateHallucination(brief('The game was played at Mercedes-Benz Stadium.'), env);
  assert.equal(r.pass, true, r.reason);
});

test('hyphenated PLAYER names present in source are matchable', () => {
  const names = ['Amon-Ra St. Brown', 'JuJu Smith-Schuster', 'Nick Westbrook-Ikhine'];
  for (const name of names) {
    const env = {
      ...ENV,
      events: [...ENV.events, { quarter: 'First', type: 'TD', team: WAS, player: name, detail: `${name} 5 Yd pass` }],
    };
    const r = gateHallucination(brief(`${name} scored in the first quarter.`), env);
    assert.equal(r.pass, true, `${name} should be matchable: ${r.reason}`);
  }
});

test('the gate still catches a name that is genuinely absent', () => {
  const r = gateHallucination(brief('Patrick Mahomes threw for three hundred yards.'), ENV);
  assert.equal(r.pass, false);
  assert.match(r.reason, /Mahomes/);
});

test('a hyphenated FULL name not in source is still caught', () => {
  const r = gateHallucination(brief('JuJu Smith-Schuster caught the winner.'), ENV);
  assert.equal(r.pass, false);
  assert.match(r.reason, /Smith-Schuster/);
});

test('KNOWN GAP: a bare surname is never checked, hyphenated or not', () => {
  // findReferencedNames only extracts sequences of two or more capitalised
  // words, so "Mahomes" and "Smith-Schuster" alone are invisible to the gate.
  // This is NOT the hyphen defect - a single unhyphenated surname behaves
  // identically - and fixing it means widening name EXTRACTION, which would
  // start flagging ordinary sentence-initial words. Pinned as the current
  // boundary so the next person knows it is a decision and not an oversight.
  assert.deepEqual(findReferencedNames('The pass to Mahomes won it.'), []);
  assert.deepEqual(findReferencedNames('The pass to Smith-Schuster won it.'), []);
  assert.equal(gateHallucination(brief('Mahomes threw the winner.'), ENV).pass, true);
});
