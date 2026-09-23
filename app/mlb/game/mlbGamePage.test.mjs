// app/mlb/game/mlbGamePage.test.mjs - the MLB game page, RENDERED.
//
// IT RENDERS RATHER THAN GREPS. A source assertion about this page would be a
// route literal duplicated in the source and the test, which is how a 404 once
// shipped past a green suite here: the test agreed with the code because it
// WAS the code. So the reader is stubbed and the page is run, and what is
// asserted is markup.
//
// THE MOCK IS THE SPEC: docs/design/mocks/mlb-scores-v0_1.html, second frame.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../../lib/testing/nextResolve.mjs';
install();
import { lineScoreGrid } from '../../../lib/mlb/gameDetail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK = path.join(__dirname, '__link_stub.mjs');
const NAV = path.join(__dirname, '__nav_stub.mjs');
const READER = path.join(__dirname, '__reader_stub.mjs');
const HEADER = path.join(__dirname, '__header_stub.mjs');

registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  if (spec.endsWith('lib/mlb/gameDetail')) return { url: pathToFileURL(READER).href, shortCircuit: true };
  if (spec.endsWith('components/GlobalHeaderServer')) return { url: pathToFileURL(HEADER).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(path.join(__dirname, '__css_stub.mjs')).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, Page, reader;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  writeFileSync(NAV, "export function notFound() { throw new Error('notFound'); }\n");
  writeFileSync(HEADER, "export default function GlobalHeaderServer() { return null; }\n");
  writeFileSync(path.join(__dirname, '__css_stub.mjs'), 'export default {};\n');
  writeFileSync(READER, "export let next = null; export function set(v) { next = v; } export async function getMlbGame() { return next; }\n");
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  reader = await import(pathToFileURL(READER).href);
  Page = (await import('./[slug]/page.js')).default;
});
after(() => {
  for (const f of [LINK, NAV, HEADER, READER, path.join(__dirname, '__css_stub.mjs')]) {
    try { unlinkSync(f); } catch { /* gone */ }
  }
});

const team = (ab, name) => ({ id: ab, name, shortName: name, abbreviation: ab, colors: { primary: '#0C2340', secondary: '#C4CED3' } });

// The mock's own game: Rays at Yankees, top 7th, 2 out, 3-2, 1st and 3rd.
const LIVE = () => ({
  id: 1, slug: 'mlb-2026-09-22-tb-nyy', status: 'live', kickoffAt: '2026-09-22T17:05:00Z',
  seasonYear: 2026, seasonPhase: 'POST', venue: 'Yankee Stadium',
  home: team('NYY', 'Yankees'), away: team('TB', 'Rays'),
  homeScore: 2, awayScore: 3,
  liveState: { period: 7, half: 'Top', outs: 2, balls: 3, strikes: 2,
    bases: { first: true, second: false, third: true },
    batter: 'J. Caminero', pitcher: 'L. Weaver' },
  chip: 'Top 7th',
  lineScore: {
    columns: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    away: { innings: [0, 1, 0, 0, 2, 0, 0, null, null], runs: 3, hits: 7, errors: 0 },
    home: { innings: [0, 0, 0, 2, 0, 0, null, null, null], runs: 2, hits: 5, errors: 1 },
  },
  scoringPlays: [
    { text: 'Judge homered to left (412 feet), Soto scored.', half: 'bottom', inning: '4th', homeScore: 2, awayScore: 0 },
    { text: 'Paredes doubled to left center, Arozarena and Franco scored.', half: 'top', inning: '5th', homeScore: 2, awayScore: 2 },
    { text: 'Díaz singled to right, Lowe scored.', half: 'top', inning: '7th', homeScore: 2, awayScore: 3 },
  ],
  lastPlay: null,
  probables: null,
  box: {
    hitters: [{ bdl_player_id: 'h1', team_id: 'TB', player_name: 'Yandy Díaz', position: '1B', at_bats: 4, runs: 1, hits: 2, rbi: 1, walks: 0, strikeouts: 1 }],
    pitchers: [{ bdl_player_id: 'p1', team_id: 'NYY', player_name: 'Luke Weaver', outs_recorded: 4, hits_allowed: 1, runs_allowed: 1, earned_runs: 1, walks_allowed: 1, strikeouts_pitched: 2 }],
  },
});

const render = async (g, q = {}) => {
  reader.set(g);
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: g.slug }), searchParams: Promise.resolve(q) }));
};

test('THE LINE SCORE CARRIES R/H/E AND THE CURRENT HALF IN VOLT', async () => {
  const h = await render(LIVE());
  // The header cell of the inning being played.
  assert.match(h, /<th scope="col" class="now">7<\/th>/);
  // AND THE CELL OF THE SIDE ACTUALLY BATTING - the other side has not played
  // the 7th and a volt blank would claim it had. TB is batting (Top).
  const rows = [...h.matchAll(/<tr><th class="t"[^>]*>(TB|NYY)<\/th>(.*?)<\/tr>/gs)];
  const [tb, nyy] = rows.map((m) => m[2]);
  assert.equal((tb.match(/class="now"/g) ?? []).length, 1, 'the batting side has one now cell');
  assert.equal((nyy.match(/class="now"/g) ?? []).length, 0, 'and the fielding side has none');
  // A BLANK CELL, NOT A ZERO, where a side has not batted.
  assert.match(nyy, /<td><\/td><td><\/td><td><\/td><td class="tot r">/, 'innings 7-9 are blank for NYY');
  // R/H/E, and R is ruled off from the innings.
  assert.match(tb, /<td class="tot r">3<\/td><td class="tot">7<\/td><td class="tot">0<\/td>/);
  assert.match(nyy, /<td class="tot r">2<\/td><td class="tot">5<\/td><td class="tot">1<\/td>/);
});

test('THE AT BAT MODULE is the count, the diamond and who is in the box', async () => {
  const h = await render(LIVE());
  assert.match(h, /<div class="mg-eb">AT BAT<\/div>/);
  assert.match(h, /<div class="big">2 out<small>Top 7th<\/small><\/div>/);
  assert.match(h, /<div class="big cnt">3-2<small>count<\/small><\/div>/);
  assert.match(h, /<span class="mg-dia" role="img" aria-label="1st, 3rd">/);
  assert.match(h, /<b>J\. Caminero<\/b> batting · <b>L\. Weaver<\/b> pitching/);
  // NO CLOCK ANYWHERE, which the mock says twice.
  assert.doesNotMatch(h, /\d:\d\d/);
});

test('THE DIAMOND IS ABSENT, NOT EMPTY, ON THE GAME PAGE TOO', async () => {
  const g = LIVE(); delete g.liveState.bases;
  const h = await render(g);
  assert.doesNotMatch(h, /mg-dia/, 'with MLB_STATSAPI off this is EVERY game');
  // The rest of the module survives - the count and the outs come from the
  // scores feed, not from the second provider.
  assert.match(h, /<div class="big">2 out<small>Top 7th<\/small><\/div>/);
});

test('SCORING PLAYS RUN OLDEST FIRST WITH THE SCORE AFTER EACH', async () => {
  const h = await render(LIVE());
  const plays = [...h.matchAll(/<div class="mg-play">(.*?)<\/div>/gs)].map((m) => m[1]);
  assert.equal(plays.length, 3);
  // The mock's own order: Bot 4th, Top 5th, Top 7th. A game read backwards
  // shows a 3-2 above a 0-2 and reads as a correction.
  assert.match(plays[0], /Bot 4th<\/span><span class="sc">0-2<\/span>/);
  assert.match(plays[1], /Top 5th<\/span><span class="sc">2-2<\/span>/);
  assert.match(plays[2], /Top 7th<\/span><span class="sc">3-2<\/span>/);
  assert.match(plays[2], /Díaz singled to right, Lowe scored\./);
});

test('HITTING AND PITCHING ARE TABS, and they are LINKS', async () => {
  const hit = await render(LIVE());
  assert.match(hit, /<a class="on" aria-current="page" href="\/mlb\/game\/mlb-2026-09-22-tb-nyy\?box=hitting">Hitting<\/a>/);
  assert.match(hit, /href="\/mlb\/game\/mlb-2026-09-22-tb-nyy\?box=pitching">Pitching<\/a>/);
  assert.match(hit, /<th class="n">Batting<\/th>/);
  assert.doesNotMatch(hit, /<th class="n">Pitching<\/th>/, 'one table at a time');
  assert.match(hit, /Yandy Díaz/);
  assert.doesNotMatch(hit, /Luke Weaver/);

  const pit = await render(LIVE(), { box: 'pitching' });
  assert.match(pit, /<th class="n">Pitching<\/th>/);
  assert.match(pit, /Luke Weaver/);
  assert.doesNotMatch(pit, /Yandy Díaz/);
  // OUTS BACK TO INNINGS AT THE VERY LAST MOMENT: 4 outs is 1.1, not 4 and not
  // 1.33. This column is the one place "6.2" is the right rendering.
  assert.match(pit, /<td>1\.1<\/td>/);

  // AN UNKNOWN TAB FALLS BACK, it does not empty the page.
  const junk = await render(LIVE(), { box: 'fielding' });
  assert.match(junk, /<th class="n">Batting<\/th>/);
});

test('PRE-GAME IS THE PROBABLES; FINAL IS THE DECISION', async () => {
  const pre = { ...LIVE(), status: 'scheduled', chip: null, liveState: null,
    probables: { away: { name: 'Tarik Skubal' }, home: { name: 'Luis Castillo' } } };
  const h = await render(pre);
  assert.match(h, /<div class="mg-eb">PROBABLES<\/div>/);
  assert.match(h, /TB <b>T\. Skubal<\/b>/);
  assert.match(h, /NYY <b>L\. Castillo<\/b>/);
  assert.doesNotMatch(h, /AT BAT/);
  // NO SCORE COLUMN BEFORE FIRST PITCH. A 0 next to a team that has not
  // played is not a low score, it is a wrong one.
  assert.doesNotMatch(h, /<b class="sc">0<\/b>/);

  const fin = { ...LIVE(), status: 'final', chip: 'Final', liveState: null };
  fin.box.pitchers = [
    { bdl_player_id: 'p1', team_id: 'TB', player_name: 'Drew Rasmussen', outs_recorded: 21, strikeouts_pitched: 9, earned_runs: 1, wins: 1 },
    { bdl_player_id: 'p2', team_id: 'NYY', player_name: 'Max Fried', outs_recorded: 18, strikeouts_pitched: 4, earned_runs: 3, losses: 1 },
  ];
  const f = await render(fin);
  assert.match(f, /<div class="mg-eb">DECISION<\/div>/);
  assert.match(f, /<em>W<\/em> D\. Rasmussen 7 IP · 9 K · 1 ER/);
  assert.match(f, /<em>L<\/em> M\. Fried 6 IP · 4 K · 3 ER/);
  // MOST GAMES HAVE NO SAVE, and the row is absent rather than dashed.
  assert.doesNotMatch(f, /SV/);
  // AND NO "NOW" COLUMN ON A FINAL.
  assert.doesNotMatch(f, /class="now"/);
});

// --- EIGHT INNINGS, EIGHT COLUMNS ------------------------------------------

test('A ROW WITH EIGHT INNINGS RENDERS EIGHT COLUMNS PLUS R/H/E', async () => {
  // The real MIL @ PHI grid, off the day feed the poller reads: the home side
  // won in the bottom of the 8th and never batted a 9th, so the grid is EIGHT
  // columns wide and the away row's 9th is the ragged edge.
  const g = LIVE();
  g.slug = 'mlb-2026-09-22-mil-phi';
  g.status = 'final'; g.chip = 'Final'; g.liveState = null;
  g.home = team('PHI', 'Phillies'); g.away = team('MIL', 'Brewers');
  g.homeScore = 6; g.awayScore = 4;
  g.lineScore = lineScoreGrid({
    home: { innings: [0, 2, 1, 0, 0, 0, 0, 3], runs: 6, hits: 8, errors: 0 },
    away: { innings: [0, 0, 0, 1, 0, 2, 0, 0, 1], runs: 4, hits: 6, errors: 2 },
  });
  const h = await render(g);

  // EIGHT is what the grid is padded to... except the away side played a 9th,
  // so the real width is NINE and the eight-inning home row keeps its ragged
  // edge. Both numbers are asserted rather than assumed.
  assert.equal(g.lineScore.columns.length, 9);
  const heads = [...h.matchAll(/<th scope="col"[^>]*>(\d+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['1', '2', '3', '4', '5', '6', '7', '8', '9']);

  const rows = [...h.matchAll(/<tr><th class="t"[^>]*>(MIL|PHI)<\/th>(.*?)<\/tr>/gs)];
  const [mil, phi] = rows.map((m) => m[2]);
  // NINE inning cells on each row - the home side's ninth is BLANK, not a 0.
  assert.equal((mil.match(/<td[^>]*>/g) ?? []).length, 9 + 3, 'nine innings plus R/H/E');
  assert.equal((phi.match(/<td[^>]*>/g) ?? []).length, 9 + 3);
  assert.match(phi, /<td><\/td><td class="tot r">6<\/td>/, "the home side's unplayed 9th is blank");
  // AND R/H/E ARE THE LAST THREE, in that order, on both rows.
  assert.match(mil, /<td class="tot r">4<\/td><td class="tot">6<\/td><td class="tot">2<\/td>/);
  assert.match(phi, /<td class="tot r">6<\/td><td class="tot">8<\/td><td class="tot">0<\/td>/);

  // AN EIGHT-INNING GAME BOTH SIDES PLAYED IS EXACTLY EIGHT COLUMNS - the rule
  // the relay asked for, with no ragged edge to hide behind.
  const even = LIVE();
  even.liveState = null; even.status = 'final'; even.chip = 'Final';
  even.lineScore = lineScoreGrid({
    home: { innings: [0, 1, 0, 0, 2, 0, 0, 1], runs: 4, hits: 9, errors: 0 },
    away: { innings: [0, 0, 1, 0, 0, 1, 0, 0], runs: 2, hits: 5, errors: 1 },
  });
  const h2 = await render(even);
  assert.deepEqual([...h2.matchAll(/<th scope="col"[^>]*>(\d+)<\/th>/g)].map((m) => m[1]),
    ['1', '2', '3', '4', '5', '6', '7', '8']);
  const r2 = [...h2.matchAll(/<tr><th class="t"[^>]*>(TB|NYY)<\/th>(.*?)<\/tr>/gs)].map((m) => m[2]);
  for (const row of r2) assert.equal((row.match(/<td[^>]*>/g) ?? []).length, 8 + 3);
});

test('THE GRID IS ABSENT ONLY WHEN THERE IS NO INNING AT ALL', async () => {
  // This is what was served on every MLB game tonight: a well-formed line score
  // of NOTHING, written from a pre-game row. lineScoreGrid says null for it, and
  // the page then has no LINE SCORE section - which is correct behaviour on a
  // wrong input, and is why the recon went to the writer and not to the grid.
  assert.equal(lineScoreGrid({
    home: { innings: [], runs: 0, hits: 0, errors: 0 },
    away: { innings: [], runs: 0, hits: 0, errors: 0 },
  }), null);
  const g = LIVE();
  g.lineScore = null;
  const h = await render(g);
  assert.doesNotMatch(h, /LINE SCORE/);
});
