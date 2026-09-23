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

// --- THE CARD'S LAST PLAY ---------------------------------------------------

test('lastPlay is the newest COMPLETED AT-BAT, never a pitch', async () => {
  const { baseballLastPlay } = await import('./playsTab.js');
  // THE CASE THE RELAY NAMES: a double, then three pitches of the next at-bat.
  // The newest ROW is a pitch and the card must not say "Pitch 3 : Ball 2".
  const rows = [
    row({ id: 20, type: 'Start Batter/Pitcher', bat: 700 }),
    row({ id: 21, type: 'Double', pt: 'Sinker', pv: 90, bat: 700, text: 'Pitch 1 : Ball In Play' }),
    row({ id: 22, type: 'Play Result', bat: 700, text: 'Stott doubled to left.' }),
    row({ id: 23, type: 'End Batter/Pitcher', bat: 700 }),
    row({ id: 24, type: 'Start Batter/Pitcher', bat: 608 }),
    row({ id: 25, type: 'Ball', pt: 'Slider', pv: 84, bat: 608, text: 'Pitch 1 : Ball 1' }),
    row({ id: 26, type: 'Foul Ball', pt: 'Cutter', pv: 93, bat: 608, text: 'Pitch 2 : Strike 1 Foul' }),
    row({ id: 27, type: 'Ball', pt: 'Curve', pv: 79, bat: 608, text: 'Pitch 3 : Ball 2' }),
  ];
  assert.equal(baseballLastPlay(rows, []), 'Stott doubled to left.');
  // Row order must not matter - the newest is by play_number, not by position.
  assert.equal(baseballLastPlay([...rows].reverse(), []), 'Stott doubled to left.');

  // BOTH HALVES OF THE RULE ARE LOAD-BEARING: a result type AND no pitch_type.
  // In today's feed a "Play Result" row never carries a pitch, so the type test
  // alone would pass every case above - and a feed that started attaching the
  // pitch to the result row would put "Pitch 3 : Ball 2" on a lock screen. This
  // is the row that tells the two guards apart.
  const withPitch = [...rows,
    row({ id: 28, type: 'Play Result', bat: 608, pt: 'Curve', pv: 79, text: 'Pitch 3 : Ball 2' })];
  assert.equal(baseballLastPlay(withPitch, []), 'Stott doubled to left.');
});

test('lastPlay prefers the curated scoring sentence when that at-bat scored', async () => {
  const { baseballLastPlay } = await import('./playsTab.js');
  // WITH ITS BRACKETS, as the feed always sends them: an at-bat is Start to End
  // and the result is only the result of the man who was batting.
  const rows = [
    row({ id: 29, type: 'Start Batter/Pitcher', bat: 608 }),
    row({ id: 30, type: 'Home Run', pt: 'Sinker', pv: 96, bat: 608, text: 'Pitch 5 : Ball In Play' }),
    row({ id: 31, type: 'Play Result', bat: 608, scoring: true, h: 2, a: 0, text: 'Marsh homered.' }),
    row({ id: 32, type: 'End Batter/Pitcher', bat: 608 }),
  ];
  const curated = [{ text: 'Marsh homered to right (390 feet), Stott scored.', inning: '2nd', half: 'bottom' }];
  assert.equal(baseballLastPlay(rows, curated),
    'Marsh homered to right (390 feet), Stott scored.');
  // AND ONLY WHEN THAT AT-BAT IS THE NEWEST ONE. An out after the home run is
  // the news; a card still showing the homer would describe a game that moved on
  // - which is what reading the scoring plays ALONE did.
  const later = [...rows,
    row({ id: 33, type: 'Start Batter/Pitcher', bat: 700 }),
    row({ id: 34, type: 'Fly Out', pt: 'Slider', pv: 85, bat: 700, text: 'Pitch 2 : Ball In Play' }),
    row({ id: 35, type: 'Play Result', bat: 700, text: 'Realmuto flied out to center.' }),
    row({ id: 36, type: 'End Batter/Pitcher', bat: 700 })];
  assert.equal(baseballLastPlay(later, curated), 'Realmuto flied out to center.');
});

test('lastPlay is not a SUBSTITUTION, which the feed also types "Play Result"', async () => {
  const { baseballLastPlay } = await import('./playsTab.js');
  // MEASURED ON PROD: the newest row in SD @ LAD's 8th was a Play Result reading
  // "Taylor hit for Harris". A card reporting a pinch hitter as the last play is
  // reporting a roster move as news - which the first version of this did.
  const rows = [
    row({ id: 50, type: 'Start Batter/Pitcher', bat: 700 }),
    row({ id: 51, type: 'Ground Out', pt: 'Sinker', pv: 92, bat: 700, text: 'Pitch 3 : Ball In Play' }),
    row({ id: 52, type: 'Play Result', bat: 700, text: 'Tucker grounded out to first.' }),
    row({ id: 53, type: 'End Batter/Pitcher', bat: 700 }),
    row({ id: 54, type: 'Play Result', text: 'Taylor hit for Harris' }),
  ];
  assert.equal(baseballLastPlay(rows, []), 'Tucker grounded out to first.');
  // The discriminator is PITCHES THROWN: a substitution has none, so it is not
  // an at-bat however the feed types it.
  assert.equal(baseballLastPlay([rows[4]], []), '');

  // AND INSIDE THE NEW BATTER'S BRACKET, which is where a pinch hitter is
  // actually announced - he is named as he comes up, so the row lands in an OPEN
  // at-bat and becomes its result. Nothing has been pitched to him yet, and that
  // is the only thing separating this from a real at-bat.
  const announced = [
    ...rows.slice(0, 4),
    row({ id: 55, type: 'Start Batter/Pitcher', bat: 800 }),
    row({ id: 56, type: 'Play Result', bat: 800, text: 'Taylor hit for Harris' }),
  ];
  assert.equal(baseballLastPlay(announced, []), 'Tucker grounded out to first.');
});

test('lastPlay skips events and markers, and falls back when there are no rows', async () => {
  const { baseballLastPlay } = await import('./playsTab.js');
  // A stolen base and a pitching change have text and no pitch either; they are
  // lines of the half, not the at-bat a card is reporting.
  const rows = [
    row({ id: 39, type: 'Start Batter/Pitcher', bat: 700 }),
    row({ id: 39.5, type: 'Single', pt: 'Sinker', pv: 91, bat: 700, text: 'Pitch 1 : Ball In Play' }),
    row({ id: 40, type: 'Play Result', bat: 700, text: 'Stott singled to center.' }),
    row({ id: 40.5, type: 'End Batter/Pitcher', bat: 700 }),
    row({ id: 41, type: 'Stolen Base', text: 'Stott stole second.' }),
    row({ id: 42, type: 'Start Inning', text: 'Top of the 3rd inning' }),
  ];
  assert.equal(baseballLastPlay(rows, []), 'Stott singled to center.');
  // NO PLAY ROWS IS A REAL STATE - an import that has not landed, or a game
  // played before the importer existed - and the scoring summary is what is left.
  assert.equal(baseballLastPlay([], [{ text: 'Judge homered.', inning: '4th', half: 'bottom' }]),
    'Judge homered.');
  assert.equal(baseballLastPlay([], []), '');
  assert.equal(baseballLastPlay(null, null), '');
});
