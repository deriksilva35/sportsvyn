// components/results/results.test.mjs - the four frames of
// docs/design/mocks/results-grammar-v0_1.html, RENDERED.
//
// IT RENDERS RATHER THAN GREPS. What is worth asserting here is markup: that a
// matched slot lights on BOTH columns, that the Draft prints two ranks and four
// facts on every pick, that a pending Pick'em square is dashed and not a loss.
// None of that can be checked by calling a function.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK = stubPath('__rs_link.mjs');
const CSS = stubPath('__rs_css.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(CSS).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let renderToStaticMarkup; let Results;
before(async () => {
  writeFileSync(LINK, [
    "import React from 'react';",
    'export default function Link({ href, children, ...rest }) {',
    "  return React.createElement('a', { href, ...rest }, children);",
    '}',
  ].join('\n') + '\n');
  writeFileSync(CSS, 'export default {};\n');
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  Results = (await import('./Results.js')).default;
});

// THE STUBS ARE DELETED. Left behind they are two untracked .mjs files inside
// components/, which eslint then lints - and a stub written to satisfy a module
// resolver has no business raising a warning about its own default export.
after(() => {
  for (const f of [LINK, CSS]) { try { unlinkSync(f); } catch { /* gone */ } }
});

// REACT'S COMMENT MARKERS ARE STRIPPED. renderToStaticMarkup separates adjacent
// text children with <!-- -->, which is invisible to a reader and noise in a
// regex - every assertion below is about markup a browser shows.
// AND THE APOSTROPHE IS DECODED for the same reason. renderToStaticMarkup writes
// "didn&#x27;t"; a browser shows "didn't", and an assertion about copy should be
// written the way the copy reads.
const html = (v, href = '/results/weekly/10') =>
  renderToStaticMarkup(React.createElement(Results, { v, href }))
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'");

const slot = (pos, name, points, hit = false) => ({
  slot: pos, pos, name, short: name, team: 'BUF', meta: null, points, hit,
});
const bar = (pct, o = {}) => ({ key: `b${pct}`, dnf: false, n: 1, pct, me: false, top: false, ...o });

/** The mock's own Daily numbers. */
const DAILY = () => ({
  game: 'daily', title: 'The Daily', subtitle: '2026', edition: 'Edition 031 · graded',
  ceilingWord: 'perfect',
  header: { rank: 41, rankLabel: '41st', of: 1204, topPct: 3.4, score: 1712, ceiling: 1868, pctOfCeiling: 91.6 },
  mine: [slot('QB', 'P. Mahomes', 412, true), slot('RB', 'J. Gibbs', 238), slot('RB', 'S. Barkley', 344, true)],
  ceiling: [slot('QB', 'P. Mahomes', 412, true), slot('RB', 'D. Henry', 371), slot('RB', 'S. Barkley', 344, true)],
  matched: 3, slotCount: 6, toCeiling: 156,
  lostIt: [{ slot: 'RB', delta: -133, you: 'J. Gibbs', best: 'D. Henry', phrase: 'Gibbs over Henry' },
    { slot: 'WR', delta: -33, you: 'J. Chase', best: 'T. Hill', phrase: 'Chase over Hill' }],
  field: {
    distribution: { bars: [bar(48), bar(100), bar(14, { me: true }), bar(6, { top: true })], median: 1488, low: 900, high: 1868, played: 1204, dnf: 0, myBucket: 2 },
    axis: ['900', '1,200', '1,500', 'you · 1,712', '1,868'],
    median: 1488, played: 1204, dnf: 0,
    rows: [
      { rank: 1, name: 'the Closer', house: true, you: false, score: 1847, pct: 98.9, sub: null, userId: 5 },
      { rank: 41, name: 'you', house: false, you: true, score: 1712, pct: 91.6, sub: null, userId: 9 },
    ],
  },
});

test('FRAME 1 - THE DAILY: three numbers, a bar, and a matched slot lit BOTH sides', () => {
  const h = html(DAILY(), '/results/daily/1735');
  // THE HEADER'S THREE NUMBERS.
  assert.match(h, /<span class="rs-eb">The Daily · 2026<\/span>/);
  assert.match(h, /Field<b>41st<\/b><small>of 1,204 · top 3.4%<\/small>/);
  assert.match(h, /Of perfect<b class="v">91.6%<\/b><small>perfect 1,868<\/small>/);
  assert.match(h, /<b class="n">1,712<\/b><span>Points<\/span>/);
  // THE BAR IS THE READER AGAINST THE CEILING, with the ceiling ticked.
  assert.match(h, /<i style="width:91.6%"><\/i><u style="left:100%"><\/u>/);
  // A MATCHED SLOT LIGHTS ON BOTH COLUMNS - three hits, so six lit rows.
  assert.equal([...h.matchAll(/class="rs-srow hit"/g)].length, 4);
  // A MISS DIMS ITS NUMBER on your side only.
  assert.match(h, /class="rs-srow miss"/);
  // WHERE YOU LOST IT: the biggest first and in BOLD, each with a terra delta.
  assert.match(h, /Where you lost it:/);
  assert.match(h, /<b>Gibbs over Henry<\/b>/);
  assert.match(h, /<span class="t">−133<\/span>/);
  assert.match(h, /Chase over Hill/);
  assert.match(h, /<span class="t">−33<\/span>/);
  // BIGGEST FIRST, and only the first is bold - it is the decision that cost
  // the most and the line is read left to right.
  assert.ok(h.indexOf('Gibbs over Henry') < h.indexOf('Chase over Hill'));
  assert.doesNotMatch(h, /<b>Chase over Hill<\/b>/);
  // THE FIELD: my bar volt, the ones above it dark, the axis as given.
  assert.match(h, /class="me" style="height:14%"/);
  assert.match(h, /class="top" style="height:6%"/);
  assert.match(h, /<div class="rs-axis"><span>900<\/span>/);
  assert.match(h, /<span>you · 1,712<\/span>/);
  // THE BOARD: rank 1 jade, my row lit, and every row a LINK to its lineup.
  // EVERY BOARD ROW IS A LINK TO ITS OWN LINEUP - the mock's "tap an entry".
  assert.match(h, /href="\/results\/daily\/1735\?who=5" class="rs-lr best"/);
  assert.match(h, /href="\/results\/daily\/1735\?who=9" class="rs-lr you"/);
  assert.match(h, /· house<\/span>/);
});

test('FRAME 2 - THE WEEKLY: the same grammar, the ceiling called optimal', () => {
  const v = DAILY();
  v.game = 'weekly'; v.title = 'The Weekly'; v.subtitle = 'NFL week 2';
  v.ceilingWord = 'optimal'; v.edition = 'Settled 2026-09-15';
  v.field.dnf = 14;
  v.field.distribution.bars = [{ key: 'dnf', dnf: true, n: 14, pct: 30, me: false, top: false }, ...v.field.distribution.bars];
  v.field.axis = ['DNF', '60', '90', 'you · 120.7', '153.9'];
  const h = html(v);
  assert.match(h, /Of optimal<b class="v">91.6%<\/b>/);
  assert.match(h, /<b>You vs optimal<\/b>/);
  assert.match(h, />Optimal <b class="n">1,868<\/b>/);
  // THE DNF BAR IS LEFTMOST AND IS NOT ON THE VOLT SCALE.
  assert.match(h, /<div class="rs-dist"><i class="dnf"/);
  assert.match(h, /median 1,488/);
  assert.match(h, /1,204 played · 14 DNF/);
  assert.match(h, /<div class="rs-axis"><span>DNF<\/span>/);
  // AND THE WEEKLY'S FOOTER SAYS WHAT A CEILING IS.
  assert.match(h, /it is the ceiling, not a person/);
});

const DRAFT = () => ({
  game: 'draft', title: 'The Draft', subtitle: 'NFL week 2',
  edition: 'Contest 11 · 304 entries · settled', ceilingWord: 'best draft',
  header: { rank: 19, rankLabel: '19th', of: 304, topPct: 6.3, score: 1912, ceiling: 2224,
    pctOfCeiling: 86, roomRank: 2, roomRankLabel: '2nd', roomOf: 8, roomName: 'Silva Family' },
  seat: 5, teams: 12,
  best: { name: 'uncle_ray', house: false, seat: 6, score: 2224, counted: 6, of: 8 },
  myPicks: [
    { at: '1.05', round: 1, overall: 5, pos: 'QB', name: 'J. Allen', short: 'J. Allen',
      adp: 18, takenLabel: 'taken 5th', gap: 13, gapLabel: '+13 value', reach: false, points: 412, counted: true },
    { at: '3.05', round: 3, overall: 29, pos: 'WR', name: 'P. Nacua', short: 'P. Nacua',
      adp: 14, takenLabel: 'taken 29th', gap: -15, gapLabel: '-15 reach', reach: true, points: 371, counted: true },
    { at: '7.05', round: 7, overall: 77, pos: 'WR', name: 'O. Beckham', short: 'O. Beckham',
      adp: 61, takenLabel: 'taken 77th', gap: -16, gapLabel: '-16 reach', reach: true, points: 94, counted: false },
  ],
  bestPicks: [
    { at: '1.06', round: 1, overall: 6, pos: 'RB', name: 'S. Barkley', short: 'S. Barkley',
      adp: 3, takenLabel: 'taken 6th', gap: -3, gapLabel: '-3 reach', reach: true, points: 344, counted: true },
  ],
  toCeiling: -312,
  field: {
    distribution: { bars: [bar(100), bar(20, { me: true })], median: 1571, low: 900, high: 2224, played: 304, dnf: 0, myBucket: 1 },
    axis: ['900', '1,341', '1,782', 'you · 1,912', '2,224'],
    median: 1571, played: 304, dnf: 0,
    rows: [{ rank: 1, name: 'uncle_ray', house: false, you: false, score: 2224, pct: 100,
      sub: 'seat 6', seat: 6, userId: 7 }],
  },
});

test('FRAME 3 - THE DRAFT: two ranks, and four facts on every pick', () => {
  const h = html(DRAFT(), '/results/draft/11');
  // TWO RANKS, BOTH TRUE, and the room leads because it is what was played in.
  assert.match(h, /Room<b>2nd<\/b><small>of 8 · Silva Family<\/small>/);
  assert.match(h, /Field<b>19th<\/b><small>of 304 · top 6.3%<\/small>/);
  assert.match(h, /<b class="n">1,912<\/b><span>Best six<\/span>/);
  // THE CEILING IS A REAL DRAFT, named, with its seat and how many counted.
  assert.match(h, /<b>The best draft<\/b>/);
  assert.match(h, /uncle_ray · seat 6/);
  assert.match(h, /2224 · 8 picks, 6 counted/);
  // AT · ADP · TAKEN Nth · VALUE, on every pick.
  assert.match(h, /<span class="rs-at">1.05<\/span>/);
  assert.match(h, /ADP 18 · taken 5th/);
  assert.match(h, /<small class="">\+13 value<\/small>/);
  // A REACH IS TERRA, which the `r` class does.
  assert.match(h, /<small class="r">-15 reach<\/small>/);
  // A PICK THAT DID NOT COUNT SAYS SO and is dimmed, not hidden.
  assert.match(h, /class="rs-pk out"/);
  assert.match(h, /not counted<\/small>/);
  // THE BOARD CARRIES THE SEAT, because a 1.06 is a different draft from a 1.01.
  assert.match(h, /<small>seat 6<\/small>/);
  assert.match(h, /a 1.06 Barkley is a\s+different draft from a 1.01/);
  // AND THERE IS NO TWO-COLUMN COMPARE ON THIS FRAME.
  assert.doesNotMatch(h, /class="rs-vs"/);
});

const PICKEM = () => ({
  game: 'pickem', title: "Pick'em", subtitle: 'NFL week 2',
  edition: '16 games · 15 final · 1 to come', ceilingWord: 'best',
  header: { rank: 12, rankLabel: '12th', of: 188, topPct: 6.4, score: 11, ceiling: 13, pctOfCeiling: 84.6 },
  record: '11-4', bestRecord: '13-2', tied: 3, hitRate: 73.3, bestHitRate: 86.7,
  scoreboard: {
    games: [
      { key: '1', away: 'WAS', home: 'PHI', slug: 'x', winner: 'away' },
      { key: '2', away: 'MIN', home: 'GB', slug: 'y', winner: 'home' },
      { key: '3', away: 'IND', home: 'KC', slug: 'z', winner: null },
    ],
    rows: [
      { rank: 1, userId: 5, name: 'the Chalk', house: true, you: false, correct: 13, played: 15, record: '13-2',
        squares: [{ key: '1', state: 'win' }, { key: '2', state: 'win' }, { key: '3', state: 'pending' }] },
      { rank: 12, userId: 9, name: 'you', house: false, you: true, correct: 11, played: 15, record: '11-4',
        squares: [{ key: '1', state: 'win' }, { key: '2', state: 'loss' }, { key: '3', state: 'pending' }] },
    ],
  },
  field: { distribution: { bars: [bar(100)], median: 9, low: 5, high: 13, played: 188, dnf: 0, myBucket: 0 },
    axis: ['5', '8', '10', 'you · 11', '13'], median: 9, played: 188, dnf: 0, rows: [] },
});

test('FRAME 4 - PICK\'EM: a scoreboard, and a pending square is not a loss', () => {
  const h = html(PICKEM(), '/results/pickem/7');
  // THE RECORD IS THE HEADLINE, not the win count.
  assert.match(h, /<b class="n">11-4<\/b><span>Record<\/span>/);
  assert.match(h, /<span>hit rate<\/span>/);
  assert.match(h, /<b>86.7%<\/b>/);
  // ONE SQUARE PER GAME, and the column header is the away side.
  assert.match(h, /<span>entry<\/span><span>WAS<\/span><span>MIN<\/span><span>IND<\/span>/);
  // WIN JADE, LOSS DARK, PENDING DASHED - three states, and the third is not
  // the second. The mock's own rule.
  assert.match(h, /<i class="w"><\/i><i class="w"><\/i><i class="p"><\/i>/);
  assert.match(h, /<i class="w"><\/i><i class="l"><\/i><i class="p"><\/i>/);
  // MY ROW IS LIT and the leader's record is jade.
  assert.match(h, /class="rs-sb you"/);
  assert.match(h, /color:var\(--jade\)">13-2<\/span>/);
  // AND NO LINEUP COLUMNS AT ALL on this frame - the mock replaces them.
  assert.doesNotMatch(h, /class="rs-vs"/);
  assert.doesNotMatch(h, /You vs/);
  assert.match(h, /A dashed\s+square is a game not yet decided/);
});

// ------------------------------------------------- the reader who did not play

/** The Daily frame as a reader with no entry gets it. */
const NO_ENTRY = () => {
  const v = DAILY();
  v.played = false;
  v.noEntryLine = "You didn't play this board";
  // What the reader hands over in this state: no lineup of their own, no misses,
  // no distance to a ceiling they never approached - and the ceiling itself kept.
  v.mine = []; v.lostIt = []; v.matched = 0; v.toCeiling = null; v.slotCount = 3;
  v.header = { ...v.header, rank: null, rankLabel: null, of: 1204, topPct: null, score: null, pctOfCeiling: null };
  v.field.rows = v.field.rows.map((r) => ({ ...r, you: false, name: r.you ? 'S. Cole' : r.name }));
  // THE FIELD AS THE READERS ACTUALLY BUILD IT with nobody to mark: no `me`
  // bucket, and FOUR axis labels rather than five - the fourth slot is the
  // reader's own mark and there is no reader. (axisFor used to fall back to the
  // high value there, printing the ceiling twice.)
  v.field.distribution = { ...v.field.distribution, myBucket: null, bars: v.field.distribution.bars.map((b) => ({ ...b, me: false })) };
  v.field.axis = ['900', '1,200', '1,500', '1,868'];
  return v;
};

test('NO ENTRY: the line replaces the rank and the points, and NOTHING reads as a zero', () => {
  const h = html(NO_ENTRY(), '/results/daily/1735');
  // THE LINE, where the rank and the percent-of-ceiling used to be.
  assert.match(h, /<div class="rs-none">You didn't play this board<small>The field and the perfect are below<\/small><\/div>/);
  // THE CEILING IS THE ONLY NUMBER IN THE HEADER, and it is labelled as the
  // ceiling rather than as this reader's points.
  assert.match(h, /<b class="n">1,868<\/b><span>perfect<\/span>/);
  // AND NONE OF THE FOUR LIES IS PRINTED.
  assert.doesNotMatch(h, /<span>Points<\/span>/, 'no "Points" total for somebody with none');
  assert.doesNotMatch(h, /Field<b>/, 'no rank cell at all - not even a dash');
  assert.doesNotMatch(h, /Of perfect<b/, 'no percent-of-ceiling');
  assert.doesNotMatch(h, /class="rs-pct"/, 'and no bar, which would be painted to 0%');
  assert.doesNotMatch(h, /width:0%/);
  assert.doesNotMatch(h, />0</, 'no bare zero anywhere in the markup');
  // THE CEILING LINEUP IS STILL THERE, in ONE column, under its own heading -
  // not "You vs perfect" with a column of em-dashes.
  assert.match(h, /<b>The perfect lineup<\/b>/);
  assert.match(h, /class="rs-vs one"/);
  assert.match(h, /<h4>Perfect <b class="n">1,868<\/b><\/h4>/);
  assert.doesNotMatch(h, /You vs perfect/);
  assert.doesNotMatch(h, /slots matched/);
  assert.equal([...h.matchAll(/class="rs-col/g)].length, 1, 'one column, not two');
  assert.doesNotMatch(h, /Where you lost it/);
  // THE FIELD IS WHOLE - it is the reason this screen is still worth serving.
  assert.match(h, /<b>The field<\/b>/);
  assert.match(h, /median 1,488/);
  assert.match(h, /<div class="rs-axis"><span>900<\/span>/);
  assert.doesNotMatch(h, /you · /, 'the axis carries no reader mark either');
  assert.equal([...h.matchAll(/<div class="rs-axis">.*?<\/div>/gs)][0][0].match(/<span>/g).length, 4);
  assert.doesNotMatch(h, /class="me"/, 'and no bucket is lit as this reader\'s');
  assert.match(h, /href="\/results\/daily\/1735\?who=5" class="rs-lr best"/);
  assert.doesNotMatch(h, /class="rs-lr you"/, 'nobody is "you" in a field this reader is not in');
});

test('NO ENTRY: every frame, and the period word is the game\'s own', () => {
  // THE WEEKLY - a week.
  const w = NO_ENTRY();
  w.game = 'weekly'; w.title = 'The Weekly'; w.ceilingWord = 'optimal';
  w.noEntryLine = "You didn't play this week";
  const hw = html(w);
  assert.match(hw, /You didn't play this week<small>The field and the optimal are below<\/small>/);
  assert.match(hw, /<b>The optimal lineup<\/b>/);
  assert.match(hw, /<span>optimal<\/span>/);
  assert.doesNotMatch(hw, /<span>Points<\/span>/);

  // THE DRAFT - a draft. The best draft stays; "Your draft" goes.
  const d = NO_ENTRY();
  d.game = 'draft'; d.title = 'The Draft'; d.ceilingWord = 'best draft';
  d.noEntryLine = "You didn't play this draft";
  d.header = { ...d.header, roomRank: null, ceiling: 1868 };
  d.best = { name: 'the Closer', house: true, seat: 4, score: 1868, of: 16, counted: 6 };
  d.bestPicks = [{ at: '1.04', pos: 'QB', name: 'P. Mahomes', short: 'P. Mahomes', points: 412, counted: true, adp: 6, takenLabel: 'taken 4th', gapLabel: '+2' }];
  d.myPicks = [];
  const hd = html(d);
  assert.match(hd, /You didn't play this draft/);
  assert.match(hd, /<b>The best draft<\/b>/);
  assert.doesNotMatch(hd, /<b>Your draft<\/b>/, 'no empty pick list under a seat nobody sat in');
  assert.doesNotMatch(hd, /seat unknown/);

  // PICK'EM - a week, and the scoreboard IS the field.
  const p = NO_ENTRY();
  p.game = 'pickem'; p.title = "Pick'em"; p.ceilingWord = 'best';
  p.noEntryLine = "You didn't play this week";
  p.record = null; p.bestHitRate = null;
  p.scoreboard = {
    games: [{ key: 'g1', away: 'BUF' }],
    rows: [{ userId: 5, rank: 1, name: 'the Closer', house: true, you: false, record: '1-0', squares: [{ key: 's1', state: 'win' }] }],
  };
  const hp = html(p);
  assert.match(hp, /You didn't play this week/);
  assert.match(hp, /class="rs-sbg"/, 'the scoreboard is still drawn');
  assert.doesNotMatch(hp, /<span>Record<\/span>/, 'no 0-0 record');
  assert.doesNotMatch(hp, /hit rate/, 'and no 0% hit rate bar');
});

test('A REAL ZERO STILL PRINTS: played with a score of 0 is not the no-entry state', () => {
  // THE DISTINCTION THE STATE EXISTS FOR, from the other side. played is true and
  // the score is 0, so the reader gets their zero, their rank and a 0% bar - all
  // three of which are TRUE of somebody who played and scored nothing.
  const v = DAILY();
  v.played = true;
  v.header = { ...v.header, rank: 1204, rankLabel: '1,204th', score: 0, pctOfCeiling: 0 };
  const h = html(v);
  assert.match(h, /<b class="n">0<\/b><span>Points<\/span>/);
  assert.match(h, /Of perfect<b class="v">0%<\/b>/);
  assert.match(h, /<i style="width:0%"><\/i>/);
  assert.doesNotMatch(h, /didn't play/);
});
