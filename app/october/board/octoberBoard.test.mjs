// app/october/board/octoberBoard.test.mjs - frame 3 of the mock, RENDERED.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../../lib/testing/stubDir.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const F = (n) => stubPath(`__ob_${n}.mjs`);
const STUBS = ['link', 'auth', 'hdr', 'foot', 'create', 'board', 'pool', 'series', 'css'];

registerHooks({ resolve(spec, ctx, next) {
  const m = {
    'next/link': 'link',
    '@/auth': 'auth',
    '@/components/GlobalHeaderServer': 'hdr',
    '@/components/SiteFooter': 'foot',
    '@/lib/october/create': 'create',
    '@/lib/october/board': 'board',
    '@/lib/mlb/series': 'series',
  };
  if (m[spec]) return { url: pathToFileURL(F(m[spec])).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(F('css')).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, Page, boardStub, seriesStub, authStub;
before(async () => {
  writeFileSync(F('link'), "import React from 'react'; export default function Link({href,children,...r}){return React.createElement('a',{...r,href:String(href)},children);}\n");
  writeFileSync(F('auth'), 'export let uid = null;\nexport function setUid(v) { uid = v; }\nexport async function auth() { return uid == null ? null : { user: { id: uid } }; }\n');
  writeFileSync(F('hdr'), 'export default function H() { return null; }\n');
  writeFileSync(F('foot'), 'export default function F() { return null; }\n');
  writeFileSync(F('create'), "export async function currentOctoberDay() { return { season_year: 2025 }; }\n");
  // NO poolSplit AND NO usedPlayers IN THE STUBS. Both are deleted with the
  // burn; a stub that still exported them would let this test pass over a page
  // that had gone back to importing them.
  writeFileSync(F('board'), 'export let rows = [];\nexport function setRows(v) { rows = v; }\nexport async function octoberBoard() { return rows; }\n');
  writeFileSync(F('series'), 'export let series = [];\nexport function setSeries(v) { series = v; }\nexport async function seriesFor() { return series; }\n');
  writeFileSync(F('css'), 'export default {};\n');
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  boardStub = await import(pathToFileURL(F('board')).href);
  seriesStub = await import(pathToFileURL(F('series')).href);
  authStub = await import(pathToFileURL(F('auth')).href);
  Page = (await import('./page.js')).default;
});
after(() => { for (const n of STUBS) { try { unlinkSync(F(n)); } catch { /* gone */ } } });

const ROWS = [
  { userId: 1, handle: 'the Closer', house: true, total: 229.5, rank: 1, back: 0, todayPoints: 4.5, todayState: 'complete' },
  { userId: 2, handle: 'dsilva35', house: false, total: 221.0, rank: 2, back: 8.5, todayPoints: 31.0, todayState: 'complete' },
  { userId: 9, handle: 'you', house: false, total: 188.5, rank: 9, back: 41.0, todayPoints: 31.5, todayState: 'complete' },
  { userId: 10, handle: 'the Homer', house: true, total: 187.0, rank: 10, back: 42.5, todayPoints: 0, todayState: 'dnf' },
];
const render = async () => renderToStaticMarkup(await Page());

test('FRAME 3 - THE BOARD: one October total, today beside it', async () => {
  authStub.setUid(9);
  boardStub.setRows(ROWS);
  seriesStub.setSeries([
    { winner: 7, teams: [{ id: 7, abbreviation: 'LAD' }, { id: 8, abbreviation: 'MIL' }] },
    { winner: null, teams: [{ id: 9, abbreviation: 'TOR' }, { id: 10, abbreviation: 'SEA' }] },
  ]);
  const h = await render();
  assert.match(h, /<span class="oc-eb">October<\/span>/);
  assert.match(h, /4 playing · the World Series decides it/);
  // THE READER'S OWN LINE: rank and how far back, and their total in volt.
  assert.match(h, /you<b>9th · 41 back<\/b>/);
  assert.match(h, /<b>188\.5<\/b><span>October<\/span>/);
  // Four rows, ranked, and the reader's own is highlighted and says "you".
  assert.deepEqual([...h.matchAll(/data-rank="(\d+)"/g)].map((m) => m[1]), ['1', '2', '9', '10']);
  assert.match(h, /class="ob-lr you" data-rank="9"><span class="rk">9<\/span><span>you<\/span>/);
});

test('OPENLY THE HOUSE, and a DNF says DNF rather than +0', async () => {
  authStub.setUid(9);
  boardStub.setRows(ROWS);
  const h = await render();
  // lib/house/personas.js's first law: a house row carries its marker.
  assert.equal([...h.matchAll(/<span class="h"> · house<\/span>/g)].length, 2);
  assert.match(h, /the Closer<span class="h"> · house<\/span>/);
  // A DAY YOU DID NOT FIELD A CARD IS A DIFFERENT FACT from a day you played
  // badly - "+0" would collapse the two.
  assert.match(h, /<span class="d">DNF<\/span>/);
  assert.match(h, /<span class="d">\+31\.5<\/span>/);
  assert.doesNotMatch(h, /<span class="d">\+0<\/span>/);
});

test('THE BRACKET LINE names who is left - and there is no burn bar any more', async () => {
  authStub.setUid(9);
  boardStub.setRows(ROWS);
  seriesStub.setSeries([
    { winner: 7, teams: [{ id: 7, abbreviation: 'LAD' }, { id: 8, abbreviation: 'MIL' }] },
    { winner: null, teams: [{ id: 9, abbreviation: 'TOR' }, { id: 10, abbreviation: 'SEA' }] },
  ]);
  const h = await render();
  // MILWAUKEE WENT OUT - they lost a series, so they are eliminated and LAD,
  // TOR and SEA are not. Still true, and still worth a line.
  assert.match(h, /clubs eliminated<\/span><b>MIL<\/b>/);
  assert.match(h, /clubs still alive<\/span><b>LAD SEA TOR<\/b>/);
  assert.match(h, /<div class="oc-eb">The bracket<\/div>/);
  // THE BURN IS GONE FROM THIS PAGE: no spent count, and no bar to draw it in.
  assert.doesNotMatch(h, /used · gone for October/);
  assert.doesNotMatch(h, /class="ob-bar"/);
  assert.doesNotMatch(h, /Your pool/);
});

test('AN EMPTY BOARD SAYS SO, and a stranger sees it without a "you" row', async () => {
  authStub.setUid(null);
  boardStub.setRows([]);
  seriesStub.setSeries([]);
  const h = await render();
  assert.match(h, /Nobody has played a day yet\./);
  assert.match(h, /you<b>not entered<\/b>/);
  assert.doesNotMatch(h, /class="ob-lr you"/);
  assert.match(h, /clubs still alive<\/span><b>—<\/b>/);
});
