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
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK = path.join(__dirname, '__rs_link.mjs');
const CSS = path.join(__dirname, '__rs_css.mjs');
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
const html = (v, href = '/results/weekly/10') =>
  renderToStaticMarkup(React.createElement(Results, { v, href })).replace(/<!-- -->/g, '');

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

test('EVERY FRAME SURVIVES A SIGNED-OUT READER, with no `mine` at all', () => {
  // THE FIELD AND THE CEILING ARE PUBLIC on a settled contest, so the screen
  // still says something true rather than 404ing or printing zeros.
  const v = DAILY();
  v.mine = []; v.ceiling = []; v.lostIt = []; v.matched = 0; v.toCeiling = null;
  v.header = { ...v.header, rank: null, rankLabel: null, score: null, pctOfCeiling: null };
  const h = html(v);
  assert.match(h, /Field<b>-<\/b>/);
  assert.match(h, /<b class="n">-<\/b><span>Points<\/span>/);
  assert.match(h, /Of perfect<b class="v">-<\/b>/);
  // NO "where you lost it" LINE WITH NOTHING IN IT.
  assert.doesNotMatch(h, /Where you lost it/);
  // The field still draws.
  assert.match(h, /<b>The field<\/b>/);
  assert.match(h, /median 1,488/);
});
