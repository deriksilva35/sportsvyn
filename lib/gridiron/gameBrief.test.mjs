// lib/gridiron/gameBrief.test.mjs - the football envelope and its fallback.
//
// The generation half needs the model and the assembly half needs the database.
// What is testable without either is the part that got things WRONG on the
// first real run: the derived counts, and the deterministic text that publishes
// when the model fails twice.

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
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { countScoring, gridironFallback } = await import('./gameBrief.js');

// The real Hall of Fame game, all twelve scoring plays.
const ARI = 'Arizona Cardinals', CAR = 'Carolina Panthers';
const EVENTS = [
  { quarter: 'Second', clock: '14:55', type: 'TD', team: ARI, player: 'Corey Kiner', detail: 'Corey Kiner 1 Yd Rush (Chad Ryland Kick)' },
  { quarter: 'Second', clock: '10:56', type: 'TD', team: CAR, player: 'AJ Dillon', detail: 'AJ Dillon 1 Yd Rush (Ryan Fitzgerald Kick)' },
  { quarter: 'Second', clock: '9:38', type: 'TD', team: ARI, player: 'Simi Fehoko', detail: 'Simi Fehoko 5 Yd pass from Carson Beck (Chad Ryland Kick)' },
  { quarter: 'Second', clock: '5:54', type: 'TD', team: CAR, player: "Ja'seem Reed", detail: "Ja'seem Reed 15 Yd pass from Haynes King (Ryan Fitzgerald Kick)" },
  { quarter: 'Second', clock: '1:46', type: 'FG', team: ARI, player: 'Chad Ryland', detail: 'Chad Ryland 35 Yd Field Goal' },
  { quarter: 'Second', clock: '0:08', type: 'FG', team: CAR, player: 'Ryan Fitzgerald', detail: 'Ryan Fitzgerald 33 Yd Field Goal' },
  { quarter: 'Third', clock: '4:42', type: 'FG', team: ARI, player: 'Chad Ryland', detail: 'Chad Ryland 43 Yd Field Goal' },
  { quarter: 'Fourth', clock: '14:20', type: 'TD', team: CAR, player: 'Anthony Tyus III', detail: 'Anthony Tyus III 5 Yd pass from Haynes King (Ryan Fitzgerald Kick)' },
  { quarter: 'Fourth', clock: '10:19', type: 'FG', team: ARI, player: 'Chad Ryland', detail: 'Chad Ryland 35 Yd Field Goal' },
  { quarter: 'Fourth', clock: '6:53', type: 'FG', team: CAR, player: 'Ryan Fitzgerald', detail: 'Ryan Fitzgerald 37 Yd Field Goal' },
  { quarter: 'Fourth', clock: '1:55', type: 'TD', team: ARI, player: 'Bryson Green', detail: 'Bryson Green 1 Yd pass from Kedon Slovis (Chad Ryland Kick)' },
  { quarter: 'Fourth', clock: '0:00', type: 'TD', team: CAR, player: 'Haynes King', detail: 'Haynes King 5 Yd Rush' },
];

// ---------------------------------------------------------------------------
// The counts, which exist because the model got them wrong
// ---------------------------------------------------------------------------

test('THE TALLIES ARE DERIVED, not left to the model to add up', () => {
  // First real run on this game, gates all green: "four field goals" about a
  // kicker who kicked three, and "five touchdowns" in a quarter that had four.
  // Neither is catchable by a gate that checks names and minutes.
  const c = countScoring(EVENTS);
  assert.equal(c.total_scoring_plays, 12);
  assert.deepEqual(c.by_quarter.Second, { TD: 4, FG: 2 }, 'four, not five');
  assert.deepEqual(c.by_quarter.Third, { FG: 1 });
  assert.deepEqual(c.by_quarter.Fourth, { TD: 3, FG: 2 });
  assert.equal(c.field_goals_by_kicker['Chad Ryland'], 3, 'three, not four');
  assert.equal(c.field_goals_by_kicker['Ryan Fitzgerald'], 2);
});

test('A PASSING TOUCHDOWN BELONGS TO THE RECEIVER, and the key name says so', () => {
  // Haynes King threw two touchdowns and ran one in. A generic "by_player"
  // invited the reading that his entry was all three, and the second run wrote
  // "three passing touchdowns" for a man with two.
  const c = countScoring(EVENTS);
  assert.equal(c.touchdowns_by_scoring_player['Haynes King'], 1, 'the run he scored');
  assert.equal(c.touchdowns_by_scoring_player["Ja'seem Reed"], 1, 'the catch, credited to the catcher');
  assert.equal(c.touchdowns_by_scoring_player['Anthony Tyus III'], 1);
  assert.equal(c.touchdowns_by_scoring_player['Chad Ryland'], undefined,
    'a kicker has no touchdowns, and an empty count is not a zero');
  assert.ok('touchdowns_by_scoring_player' in c && 'field_goals_by_kicker' in c,
    'the keys carry the semantics - the model reads them');
});

test('by_team splits the scoring the way the scoreboard did', () => {
  const c = countScoring(EVENTS);
  assert.deepEqual(c.by_team[ARI], { TD: 3, FG: 3 });   // 21 + 9 = 30
  assert.deepEqual(c.by_team[CAR], { TD: 4, FG: 2 });   // 24 + 6 = 30, plus a missed try
});

test('an empty game counts to nothing rather than throwing', () => {
  const c = countScoring([]);
  assert.equal(c.total_scoring_plays, 0);
  assert.deepEqual(c.by_quarter, {});
});

// ---------------------------------------------------------------------------
// The fallback
// ---------------------------------------------------------------------------

const ENVELOPE = {
  match: {
    league: 'NFL', round: 'Preseason · Hall of Fame Weekend',
    venue: 'Tom Benson Hall of Fame Stadium, Canton',
    teams: { home: ARI, away: CAR }, score: { home: 30, away: 33 },
  },
  events: EVENTS,
};

test('THE FALLBACK SPEAKS FOOTBALL, not minutes', () => {
  // The soccer template writes scorers as "K. Mbappe 32'". Pointed at this game
  // it would have produced "Corey Kiner 2'" - a touchdown in the second minute.
  const fb = gridironFallback(ENVELOPE);
  assert.ok(!/\d+'/.test(`${fb.headline} ${fb.paragraph_1}`), 'no apostrophe-minutes');
  assert.match(fb.paragraph_1, /Second: .*Third: .*Fourth:/s, 'grouped by quarter');
  assert.match(fb.paragraph_1, /Corey Kiner 1 Yd Rush \(Chad Ryland Kick\) \(14:55\)/,
    "the provider's own prose is the payload");
});

test('the fallback names the winner and the score, and nothing it cannot source', () => {
  const fb = gridironFallback(ENVELOPE);
  assert.match(fb.headline, /Carolina Panthers wins 33-30 over Arizona Cardinals/);
  assert.match(fb.paragraph_1, /^Carolina Panthers 33, Arizona Cardinals 30\./);
  assert.match(fb.paragraph_2, /NFL · Preseason · Hall of Fame Weekend/);
  assert.equal(fb.paragraph_3, null, 'nothing extra to say is said as nothing');
});

test('a tie does not get a winner', () => {
  const fb = gridironFallback({ ...ENVELOPE, match: { ...ENVELOPE.match, score: { home: 20, away: 20 } } });
  assert.match(fb.headline, /finish level at 20/);
  assert.ok(!/wins/.test(fb.headline));
});

test('a game with no plays still produces renderable text', () => {
  // generateGameBrief refuses to brief this case at all, but the fallback must
  // not throw on it - the two guards are independent.
  const fb = gridironFallback({ match: ENVELOPE.match, events: [] });
  assert.equal(typeof fb.headline, 'string');
  assert.equal(fb.paragraph_1, 'Carolina Panthers 33, Arizona Cardinals 30.');
});
