// lib/mlb/playsTab.test.mjs - the pitch-by-pitch tab, shaped.
//
// THE FIXTURE IS THE REAL FEED, not an invention: these rows are the shape
// /mlb/v1/plays returned for 2026-09-22's MIL @ PHI, including the two things
// that make this grouping non-obvious - there is NO "Pitch" type (the
// ball-in-play row is called "Home Run") and a between-pitch event sits INSIDE
// an at-bat carrying a null batter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playsTab, halfLabel, pitchLine, pitchOutcome } from './playsTab.js';

const NAMES = new Map([['608', 'Brandon Marsh'], ['700', 'Bryson Stott']]);

const row = (o) => ({
  provider_play_id: String(o.id), play_number: o.id, period: o.inning ?? 2,
  inning_type: o.half ?? 'Bottom', play_type: o.type, text: o.text ?? null,
  home_score: o.h ?? 0, away_score: o.a ?? 0, scoring: o.scoring === true,
  batter_id: o.bat ?? null, pitch_type: o.pt ?? null, pitch_velocity: o.pv ?? null,
});

// One half: an at-bat that walks, a stolen base between pitches, then Marsh's
// home run - the real sequence, trimmed.
const ROWS = [
  row({ id: 1, type: 'Start Inning', text: 'Bottom of the 2nd inning' }),
  row({ id: 2, type: 'Start Batter/Pitcher', bat: 700 }),
  row({ id: 3, type: 'Ball', pt: 'Sinker', pv: 91, bat: 700, text: 'Pitch 1 : Ball 1' }),
  row({ id: 4, type: 'Strike Looking', pt: 'Slider', pv: 82, bat: 700, text: 'Pitch 2 : Strike 1 Looking' }),
  row({ id: 5, type: 'Single', pt: 'Sinker', pv: 90, bat: 700, text: 'Pitch 3 : Ball In Play' }),
  row({ id: 6, type: 'Play Result', text: 'Stott singled to center.', bat: 700 }),
  row({ id: 7, type: 'End Batter/Pitcher', bat: 700 }),
  row({ id: 8, type: 'Start Batter/Pitcher', bat: 608 }),
  row({ id: 9, type: 'Strike Looking', pt: 'Four-seam FB', pv: 95, bat: 608, text: 'Pitch 1 : Strike 1 Looking' }),
  // A BETWEEN-PITCH EVENT WITH A NULL BATTER, mid at-bat. Grouping by batter_id
  // would split Marsh's at-bat in two around it.
  row({ id: 10, type: 'Stolen Base', text: 'Stott stole second.' }),
  row({ id: 11, type: 'Foul Ball', pt: 'Cutter', pv: 94, bat: 608, text: 'Pitch 2 : Strike 2 Foul' }),
  row({ id: 12, type: 'Home Run', pt: 'Sinker', pv: 96, bat: 608, text: 'Pitch 3 : Ball In Play' }),
  row({ id: 13, type: 'Play Result', bat: 608, scoring: true, h: 2, a: 0,
    text: 'Marsh homered to right (390 feet), Stott scored.' }),
  row({ id: 14, type: 'End Batter/Pitcher', bat: 608 }),
  // A later half, so the ordering can be asserted.
  row({ id: 15, inning: 3, half: 'Top', type: 'Start Batter/Pitcher', bat: 700 }),
  row({ id: 16, inning: 3, half: 'Top', type: 'Ball', pt: 'Curve', pv: 85, bat: 700, text: 'Pitch 1 : Ball 1' }),
];

test('the halves come back NEWEST FIRST, and so do the at-bats in them', () => {
  const tab = playsTab(ROWS, NAMES);
  assert.deepEqual(tab.map((h) => h.label), ['Top 3rd', 'Bottom 2nd']);
  const second = tab[1];
  // Marsh (the later at-bat) is above the steal, which is above Stott - newest
  // first, with the between-pitch event in its own chronological place.
  assert.deepEqual(second.atBats.map((ab) => ab.batter ?? '(event)'),
    ['Brandon Marsh', '(event)', 'Bryson Stott']);
});

test('an at-bat is a BRACKET, so a null-batter event does not split it', () => {
  const [, second] = playsTab(ROWS, NAMES);
  const marsh = second.atBats.find((ab) => ab.batter === 'Brandon Marsh');
  // THREE PITCHES, one of them the ball in play - the stolen base between them
  // did not start a second at-bat and did not end this one.
  assert.deepEqual(marsh.pitches.map((p) => `${p.n}: ${p.line}`), [
    '1: 95 Four-seam FB · looking strike',
    '2: 94 Cutter · foul',
    '3: 96 Sinker · in play',
  ]);
  assert.equal(marsh.result, 'Marsh homered to right (390 feet), Stott scored.');
  // The stolen base IS a line of the half, in its own right, marked aside.
  const aside = second.atBats.find((ab) => ab.aside);
  assert.equal(aside.result, 'Stott stole second.');
  assert.equal(aside.batter, null);
  assert.deepEqual(aside.pitches, []);
});

test('A SCORING AT-BAT CARRIES THE SCORE AFTER, and an out carries none', () => {
  const [, second] = playsTab(ROWS, NAMES);
  const marsh = second.atBats.find((ab) => ab.batter === 'Brandon Marsh');
  assert.equal(marsh.scoring, true);
  assert.deepEqual(marsh.score, { away: 0, home: 2 });
  const stott = second.atBats.find((ab) => ab.batter === 'Bryson Stott');
  assert.equal(stott.scoring, false);
  assert.equal(stott.score, null, 'every row carries a scoreline; only a scoring play may print one');
});

test('THE LIVE AT-BAT IS KEPT - it has no End row yet', () => {
  const tab = playsTab(ROWS, NAMES);
  const top3 = tab[0];
  assert.equal(top3.atBats.length, 1);
  assert.equal(top3.atBats[0].result, null, 'nothing has happened yet, and it says so');
  assert.deepEqual(top3.atBats[0].pitches.map((p) => p.line), ['85 Curve · ball']);
});

test('a pitch is a PITCH, not an aside - its own text never becomes a half line', () => {
  // Real pitch rows carry text ("Pitch 2 : Strike 2 Foul"). If the pitch test
  // keyed on the type name - there is no "Pitch" type in this feed - every one
  // of them would fall through to the between-pitch branch and draw its own
  // line. Three pitches in Marsh's at-bat, and nothing else in the half.
  const [, second] = playsTab(ROWS, NAMES);
  assert.equal(second.atBats.filter((ab) => ab.aside).length, 1, 'the steal, and only the steal');
  assert.doesNotMatch(JSON.stringify(second.atBats.map((ab) => ab.result)), /Pitch \d/);
});

test('A PITCH IS A ROW WITH A pitch_type, not a row whose type is "Pitch"', () => {
  // There is no "Pitch" type in this feed at all: the ball-in-play row is named
  // for what happened. Keying on the name would drop the one pitch in every
  // at-bat a reader most wants to see.
  assert.equal(pitchLine({ pitch_type: 'Sinker', pitch_velocity: 96, play_type: 'Home Run' }),
    '96 Sinker · in play');
  assert.equal(pitchLine({ play_type: 'Play Result', text: 'x' }), null);
  assert.equal(pitchLine({ pitch_type: 'Slider', pitch_velocity: null, play_type: 'Ball' }),
    'Slider · ball', 'a pitch nobody clocked still prints');
  assert.equal(pitchLine({ pitch_type: 'Slider', pitch_velocity: 0, play_type: 'Ball' }),
    'Slider · ball', '0 is not a speed');
  // The four with a shorter English form, and passthrough for anything else.
  assert.equal(pitchOutcome('Strike Swinging'), 'swinging strike');
  assert.equal(pitchOutcome('Strike Looking'), 'looking strike');
  assert.equal(pitchOutcome('Foul Ball'), 'foul');
  assert.equal(pitchOutcome('Ball'), 'ball');
  assert.equal(pitchOutcome('Ground Out'), 'in play');
  assert.equal(pitchOutcome(''), null);
});

test('halfLabel says the half and the inning, and extra innings do not break it', () => {
  assert.equal(halfLabel('Top', 7), 'Top 7th');
  assert.equal(halfLabel('Bottom', 1), 'Bottom 1st');
  assert.equal(halfLabel('Mid', 3), 'Mid 3rd');
  assert.equal(halfLabel('End', 2), 'End 2nd');
  assert.equal(halfLabel('Top', 11), 'Top 11th', 'the teens are the case a naive ordinal gets wrong');
  assert.equal(halfLabel('Top', 21), 'Top 21st');
  assert.equal(halfLabel(null, 9), '9th', 'the inning alone, never an invented half');
  assert.equal(halfLabel('Top', 0), null);
  assert.equal(halfLabel('Top', null), null);
});

test('an empty half is dropped, and no rows is no tab', () => {
  // A "Start Inning" arriving one poll before its first pitch would otherwise
  // head the tab with a heading and nothing under it.
  assert.deepEqual(playsTab([row({ id: 1, type: 'Start Inning' })], NAMES), []);
  assert.deepEqual(playsTab([], NAMES), []);
  assert.deepEqual(playsTab(null), []);
});
