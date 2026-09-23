// lib/util/scoresOf.test.mjs - Number(null) is 0 and 0 is finite, and this file
// is the guard that says it may never reach an average again.
//
// TWO HALVES. The first is behaviour: the readers drop absences and keep real
// zeros. The second is a CENSUS - it walks the source and refuses the shape
// `map(Number).filter(Number.isFinite)` anywhere but here, because the defect
// has never been a wrong formula; it has always been a correct-looking idiom
// written a ninth time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { numbersOf, scoresOf, instantsOf, meanOf, medianOf, maxOf } from './scoresOf.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('AN ABSENCE LEAVES THE LIST; A REAL ZERO STAYS IN IT', () => {
  // The whole distinction, in one assertion: null is absent, 0 is a score.
  assert.deepEqual(numbersOf([1, null, 2, undefined, 3, '', 0]), [1, 2, 3, 0]);
  assert.deepEqual(numbersOf(['4', '0', 'x', NaN, Infinity, -Infinity]), [4, 0]);
  assert.deepEqual(numbersOf(null), []);
  assert.deepEqual(numbersOf([]), []);
  // A DNF ROW IS AN ABSENCE. This is the results field's own case: four entries,
  // one with score NULL, and the median must be over the THREE that played.
  const rows = [{ score: 120.7 }, { score: null }, { score: 116.9 }, { score: 153.9 }];
  assert.deepEqual(scoresOf(rows), [120.7, 116.9, 153.9]);
  assert.equal(medianOf(scoresOf(rows)), 120.7);
  // AND THE BUG IT REPLACED, spelled out: coercing first gives four numbers and
  // a median of 118.8, which is what shipped for exactly one test run.
  const wrong = rows.map((r) => Number(r.score)).filter(Number.isFinite);
  assert.deepEqual(wrong, [120.7, 0, 116.9, 153.9]);
  assert.notEqual(medianOf(wrong), 120.7);
  assert.equal(medianOf(wrong), 118.8);
});

test('the same trap wearing a date: new Date(null) is the EPOCH', () => {
  // A missing kickoff coerced to a time is 1 Jan 1970, and the Run's round lock
  // takes the EARLIEST - so one absent kickoff would have locked a whole round
  // in 1970.
  assert.equal(new Date(null).getTime(), 0, 'the trap, stated');
  const kickoffs = ['2026-09-29T18:05:00Z', null, '2026-09-29T14:05:00Z', ''];
  const got = instantsOf(kickoffs).sort((a, b) => a - b);
  assert.equal(got.length, 2);
  assert.equal(new Date(got[0]).toISOString(), '2026-09-29T14:05:00.000Z');
  // A Date object is accepted as well as a string, because callers hold both.
  assert.deepEqual(instantsOf([new Date('2026-01-01T00:00:00Z')]), [Date.parse('2026-01-01T00:00:00Z')]);
  assert.deepEqual(instantsOf(['not a date']), []);
});

test('mean, median and max all refuse to count an absence', () => {
  assert.equal(meanOf([10, null, 20]), 15, 'not 10, which a zero would make it');
  assert.equal(medianOf([10, null, 20, 30]), 20, 'not 15');
  assert.equal(maxOf([null, 1, 2]), 2);
  // A NEGATIVE COLUMN IS WHY maxOf MATTERS: a null coerced to 0 wins the max
  // outright on anything that goes below zero.
  assert.equal(maxOf([-5, null, -2]), -2, 'not 0');
  // Nothing at all is null, not 0 - "no reading" and "a reading of zero" are
  // different answers and only one of them is a number.
  assert.equal(meanOf([]), null);
  assert.equal(medianOf([null, '']), null);
  assert.equal(maxOf([]), null);
  // NO NEGATIVE ZERO reaches a screen.
  assert.equal(Object.is(meanOf([-0.01, 0.01]), -0), false);
  assert.equal(Object.is(medianOf([-0]), -0), false);
});

// --------------------------------------------------------------- the census

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'migrations', 'docs', 'public']);
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(js|mjs)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) acc.push(full);
  }
  return acc;
}
const rel = (f) => path.relative(REPO, f);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('THE COERCE-THEN-FILTER SHAPE LIVES IN ONE FILE AND NOWHERE ELSE', () => {
  // `map(Number).filter(Number.isFinite)` and its siblings read as "the numbers,
  // honestly" and mean "the numbers, plus a zero for every row that had none".
  // Nine call sites carried it before this module; the census is what stops a
  // tenth being written in six months. It cannot see every form of it - four of
  // the nine split the coercion and the filter across two functions, or counted
  // up from 0 in a loop, and no regex caught them - so the clause below ALSO
  // refuses a private median/mean/max, which is what those four had in common.
  const files = [
    ...walk(path.join(REPO, 'lib')),
    ...walk(path.join(REPO, 'app')),
    ...walk(path.join(REPO, 'components')),
    ...walk(path.join(REPO, 'services')),
  ];
  // THE ARGUED LIST, not a keyword filter - the pattern above cannot tell a row
  // list from a string being parsed, and a census that enumerates beats one that
  // greps. Each of these was read before it was allowed.
  const ALLOWED = new Map([
    ['lib/util/scoresOf.js', 'the one reader itself'],
    ['lib/daily/standings.js', "d.split('-').map(Number) - parsing a DATE STRING into y/m/d, not a row list; a malformed part is NaN and the next line refuses it"],
    ['lib/rankings/gridironDims.js', 'filters absences BEFORE coercing - the correct order, which is the order this module exists to spread'],
    ['lib/soccer/matchCenter.js', "String(formation).split('-') - parsing \"4-3-3\" into line sizes, not a row list"],
  ]);
  const offenders = [];
  for (const f of files) {
    if (ALLOWED.has(rel(f))) continue;
    const code = stripComments(readFileSync(f, 'utf8'));
    // The coercion and the finite check on one expression, in either order.
    if (/\.map\(\s*Number\s*\)[\s\S]{0,40}?Number\.isFinite/.test(code)
      || /map\([^)]*Number\([^)]*\)[^)]*\)[\s\S]{0,40}?filter\(\s*Number\.isFinite\s*\)/.test(code)
      || /getTime\(\)[\s\S]{0,60}?filter\(\s*Number\.isFinite\s*\)/.test(code)) {
      offenders.push(rel(f));
    }
  }
  assert.deepEqual(offenders, [],
    'read the list through lib/util/scoresOf.js - null is an absence, not a zero');

  // AND THE CLAUSE THAT WOULD HAVE CAUGHT lib/odds.js: a PRIVATE median, mean or
  // max. That file's copy escaped the regex above because the coercion lived in
  // the caller (`Number(x.a)`) and the filter in the helper, and each half read
  // as correct alone. A private summary function is the recurrence mode, so the
  // census names it directly rather than trying to out-regex it.
  const PRIVATE_OK = new Map([
    ['lib/util/scoresOf.js', 'the one reader itself'],
    ['lib/odds.js', 'median() stays local and UNROUNDED - a decimal price must not take the house one decimal - but its absence filter is numbersOf'],
    ['lib/fantasy/engine.js', 'same: the temperature median must not be quantized to one decimal; its absence filter is numbersOf'],
    ['lib/games/lobby.js', 'meanPct IS the house wrapper - it returns meanOf(values) and exists so the lobby keeps one name for it'],
    ['lib/mlb/seriesPickem.js', 'maxPoints is a SUM over a board, not a max over a list - the name collides, the shape does not'],
    ['lib/october/rules.js', 'maxPerGame is Math.max of two computed scalars, not a list read'],
  ]);
  const privates = [];
  for (const f of files) {
    if (PRIVATE_OK.has(rel(f))) continue;
    const code = stripComments(readFileSync(f, 'utf8'));
    if (/function\s+(median|mean|max)[A-Za-z]*\s*\(/.test(code)
      || /(const|let)\s+(median|mean|max)[A-Za-z]*\s*=\s*\(/.test(code)) {
      privates.push(rel(f));
    }
  }
  assert.deepEqual(privates, [],
    'a private median/mean/max is how the trap comes back - import it from lib/util/scoresOf.js');
  // AND EVERY ALLOWANCE IS STILL LOAD-BEARING: a file that stopped matching the
  // shape should leave the list rather than sit there granting permission for
  // something nobody is doing.
  for (const [f] of ALLOWED) {
    if (f === 'lib/util/scoresOf.js') continue;
    const code = stripComments(readFileSync(path.join(REPO, f), 'utf8'));
    assert.match(code, /Number\.isFinite/, `${f} is on the allowed list but no longer matches`);
  }
});

test('THE NINE CALL SITES ARE ALL ON THE ONE READER', () => {
  // Named, so a reader can see what was converted and a future edit cannot
  // quietly take one back off it.
  const expect = {
    'lib/results/shape.js': /numbersOf\(scores\)/,
    'lib/games/lobby.js': /return meanOf\(values\)/,
    'lib/games/leaderboard.js': /numbersOf\(seats\)/,
    'lib/gridiron/playerStats.js': /maxOf\(seasons\.map/,
    'lib/run/create.js': /instantsOf\(series\.flatMap/,
    // The two in lib/odds.js kept their own UNROUNDED median arithmetic - a price
    // is not a score and must not take the house one decimal - but the absence
    // filter is the one module's.
    'lib/odds.js': /const s = numbersOf\(values\)\.sort/,
    'lib/gridiron/oddsIngest.js': /const pa = numbersOf\(\[oa\.price\]\)/,
    'lib/fantasy/engine.js': /const a = numbersOf\(nums\)\.sort/,
    'app/stats/StatsClient.js': /maxOf\(\(rows \?\? \[\]\)\.map/,
  };
  for (const [file, rx] of Object.entries(expect)) {
    const src = readFileSync(path.join(REPO, file), 'utf8');
    assert.match(src, rx, `${file} no longer reads its list through the one module`);
    assert.match(src, /util\/scoresOf\.js'/, `${file} must import it`);
  }
});
