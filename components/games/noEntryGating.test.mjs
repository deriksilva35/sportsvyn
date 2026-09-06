// components/games/noEntryGating.test.mjs - no entry means no grade
// (relay 2b-fix item 2), for all three games.
//
// A SOURCE-STRUCTURE TEST, AND THE LIMIT IS STATED. These three components
// import Next-only aliases ('@/lib/...', '@/components/...'), so
// lib/testing/renderJsx.mjs refuses them by design - it only renders a file
// whose sole import is react. Rendering them properly needs the RSC
// pipeline, which no test in this repo reaches; the real evidence for item 2
// is the signed-out hand check on the deployed preview, where a reader
// genuinely has no entry.
//
// WHAT THIS STILL BUYS: the three viewer-scoped blocks are gated, and a
// future edit that ungates one fails here rather than shipping a "0 of 0 ·
// 0%" scoreline to somebody who never played - which is exactly the bug
// item 2 was raised for, and it shipped once already.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// [file, the guard expression that must precede each viewer-scoped block]
const GAMES = [
  ['components/weekly/WeeklyGrade.js', 'v.you'],
  ['components/draft/DraftGrade.js', 'v.you'],
  ['components/pickem/PickemGrade.js', 'entered'],
];

for (const [file, guard] of GAMES) {
  test(`${file}: the grade card is gated on an entry`, () => {
    const s = src(file);
    const card = s.indexOf('className="gg-grade"');
    assert.ok(card > 0, 'the grade card exists');
    // The guard must appear in the JSX expression immediately opening the
    // block - i.e. within the short window before the element itself.
    const window = s.slice(Math.max(0, card - 220), card);
    assert.match(window, new RegExp(`\\{[^}]*${guard.replace('.', '\\.')}`),
      `the grade card must be gated on ${guard}`);
  });

  test(`${file}: the share module is gated on an entry`, () => {
    const s = src(file);
    const share = s.indexOf('<ShareGrade');
    assert.ok(share > 0, 'ShareGrade is used');
    const window = s.slice(Math.max(0, share - 120), share);
    assert.match(window, new RegExp(`\\{[^}]*${guard.replace('.', '\\.')}`),
      `Share must be gated on ${guard}`);
  });
}

test("the Weekly's and the Draft's result box and leaderboard are NOT gated", () => {
  // The other half of item 2: with no entry these three still render, so the
  // page is a real page rather than a header over a ghost line.
  for (const file of ['components/weekly/WeeklyGrade.js', 'components/draft/DraftGrade.js']) {
    const s = src(file);
    assert.ok(s.includes('className="gg-perf"'), `${file} keeps a result box`);
    assert.ok(s.includes('className="gg-lb"'), `${file} keeps a leaderboard`);
  }
});

test("Pick'em swaps in a board-level result box when there is no entry", () => {
  const s = src('components/pickem/PickemGrade.js');
  assert.match(s, /\{!entered && \(\s*<div className="gg-perf">/, 'a no-entry result box exists');
  assert.match(s, /How this board went/, 'and it states the board, not a score');
  assert.ok(s.includes('className="gg-lb"'), "Pick'em keeps its leaderboard");
});
