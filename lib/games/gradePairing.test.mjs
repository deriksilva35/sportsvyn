// lib/games/gradePairing.test.mjs - PURE, no DB.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pairRows, gradeGlyphRow, gradeStory, draftGradeRows, firstDivergentRound } from './gradePairing.js';

const you = [
  { label: 'QB', id: 1, name: 'Allen', pos: 'QB', points: 28.6, dropped: false },
  { label: 'RB', id: 2, name: 'Irving', pos: 'RB', points: 24.1, dropped: false },
  { label: 'WR', id: 3, name: 'Nacua', pos: 'WR', points: 26.3, dropped: false },
  { label: 'TE', id: 4, name: 'Kincaid', pos: 'TE', points: 6.4, dropped: true },
  { label: 'FLEX', id: 5, name: 'Hunter', pos: 'WR', points: 21.8, dropped: false },
  { label: 'FLEX2', id: 6, name: 'Collins', pos: 'WR', points: 11.2, dropped: false },
];
const best = [
  { label: 'QB', id: 1, name: 'Allen', pos: 'QB', points: 28.6, dropped: false },
  { label: 'RB', id: 7, name: 'Gibbs', pos: 'RB', points: 22.9, dropped: false },
  { label: 'WR', id: 3, name: 'Nacua', pos: 'WR', points: 26.3, dropped: false },
  { label: 'TE', id: 8, name: 'Bowers', pos: 'TE', points: 21.7, dropped: false },
  { label: 'FLEX2', id: 5, name: 'Hunter', pos: 'WR', points: 21.8, dropped: false }, // matched, DIFFERENT slot
  { label: 'FLEX', id: 9, name: 'Hampton', pos: 'RB', points: 31.4, dropped: false },
];

test('matched rows come first, in your own slot order', () => {
  const rows = pairRows(you, best);
  const matched = rows.filter((r) => r.verdict === 'hit');
  assert.equal(matched.length, 3, 'Allen, Nacua, Hunter matched by id');
  assert.deepEqual(matched.map((r) => r.label), ['QB', 'WR', 'FLEX'], 'your own slot order, not best\'s');
});

test('a matched player in a DIFFERENT slot on each side carries the note', () => {
  const rows = pairRows(you, best);
  const hunter = rows.find((r) => r.you.name === 'Hunter');
  assert.match(hunter.note, /You had him at FLEX\. Same player, same points - it counts\./);
  const allen = rows.find((r) => r.you.name === 'Allen');
  assert.equal(allen.note, null, 'same slot both sides - no note');
});

test('unmatched are paired rank-for-rank by points desc, not by closest gap', () => {
  const rows = pairRows(you, best);
  const swaps = rows.filter((r) => r.verdict !== 'hit');
  // your remaining desc: Irving 24.1, Collins 11.2, Kincaid 6.4
  // best remaining desc: Hampton 31.4, Gibbs 22.9, Bowers 21.7
  assert.deepEqual(swaps.map((r) => r.you.name), ['Irving', 'Collins', 'Kincaid']);
  assert.deepEqual(swaps.map((r) => r.best.name), ['Hampton', 'Gibbs', 'Bowers']);
  assert.equal(swaps[0].verdict, 'miss', 'Irving 24.1 < Hampton 31.4');
  assert.equal(swaps[0].diff, -7.3);
  assert.equal(swaps[1].verdict, 'miss', 'Collins 11.2 < Gibbs 22.9');
  assert.equal(swaps[2].verdict, 'miss', 'Kincaid 6.4 < Bowers 21.7');
});

test('yours strictly ahead of its paired counterpart verdicts "ahead"', () => {
  const rows = pairRows(
    [{ label: 'RB', id: 1, name: 'A', points: 20 }],
    [{ label: 'RB', id: 2, name: 'B', points: 15 }],
  );
  assert.equal(rows[0].verdict, 'ahead');
  assert.equal(rows[0].diff, 5);
});

test('gradeGlyphRow: one glyph per row, in row order', () => {
  const rows = pairRows(you, best);
  const glyphs = [...gradeGlyphRow(rows)];
  assert.equal(glyphs.length, 6, 'code-point aware, not UTF-16 code units');
  assert.equal(glyphs.filter((g) => g === '🟩').length, 3);
});

test('draftGradeRows compares round-for-round, not by searching for a match elsewhere', () => {
  const yours = [
    { label: 'R1', round: 1, id: 1, name: 'Chase', points: 24.8 },
    { label: 'R2', round: 2, id: 2, name: 'Bowers', points: 21.7 },
    { label: 'R3', round: 3, id: 3, name: 'Achane', points: 9.1 },
  ];
  const best = [
    { label: 'R1', round: 1, id: 1, name: 'Chase', points: 24.8 },
    { label: 'R2', round: 2, id: 2, name: 'Bowers', points: 21.7 },
    { label: 'R3', round: 3, id: 9, name: 'Hampton', points: 31.4 },
  ];
  const rows = draftGradeRows(yours, best);
  assert.deepEqual(rows.map((r) => r.verdict), ['hit', 'hit', 'miss']);
  assert.equal(rows[2].diff, -22.3);
  // A player who WOULD match elsewhere (e.g. Chase at round 1 both sides) is
  // never searched for outside his own round - this is the whole reason the
  // Draft does not reuse pairRows()'s matched-anywhere search.
});

test('firstDivergentRound names the earliest round that is not a hit', () => {
  const rows = draftGradeRows(
    [{ label: 'R1', id: 1, points: 10 }, { label: 'R2', id: 2, points: 5 }],
    [{ label: 'R1', id: 1, points: 10 }, { label: 'R2', id: 99, points: 20 }],
  );
  const first = firstDivergentRound(rows);
  assert.equal(first.label, 'R2');
  assert.equal(firstDivergentRound([{ verdict: 'hit' }]), null, 'no divergence at all');
});

test('gradeGlyphRow renders a dropped pick as ⬜ regardless of its verdict', () => {
  const rows = [
    { verdict: 'hit', you: { dropped: false } },
    { verdict: 'miss', you: { dropped: true } },
  ];
  assert.equal(gradeGlyphRow(rows), '🟩⬜');
});

test('gradeStory is a pure template - same rows, same story, always', () => {
  const rows = pairRows(you, best);
  const s1 = gradeStory(rows);
  const s2 = gradeStory(rows);
  assert.equal(s1, s2);
  assert.match(s1, /^3 of your six were on the best roster\./);
  // biggest gap by ABSOLUTE size, not the row's own display order -
  // Kincaid/Bowers (15.3) beats Irving/Hampton (7.3) and Collins/Gibbs (11.7).
  assert.match(s1, /Bowers outscored Kincaid by 15\.3/);
});
