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
const STUBS = ['link', 'auth', 'hdr', 'foot', 'create', 'board', 'pool', 'series', 'css',
  'leagues', 'lgactions', 'nav', 'shell'];

registerHooks({ resolve(spec, ctx, next) {
  const m = {
    'next/link': 'link',
    '@/auth': 'auth',
    '@/components/GlobalHeaderServer': 'hdr',
    '@/components/SiteFooter': 'foot',
    '@/lib/october/create': 'create',
    '@/lib/october/board': 'board',
    '@/lib/mlb/series': 'series',
    // THE LEAGUE SPINE AND THE CLIENT ISLAND. LeagueChipActions imports
    // app/actions/leagues (auth + DB) and calls useRouter() at the top level,
    // which throws "invariant expected app router to be mounted" under a bare
    // renderToStaticMarkup - Next supplies that context in the app, not here.
    // The CHIPS THEMSELVES STAY REAL; only what they reach is stubbed.
    '@/lib/leagues/core': 'leagues',
    '@/app/actions/leagues': 'lgactions',
    '@/lib/shell/shell': 'shell',
    'next/navigation': 'nav',
  };
  if (m[spec]) return { url: pathToFileURL(F(m[spec])).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(F('css')).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, Page, boardStub, seriesStub, authStub, leaguesStub, createStub;
before(async () => {
  writeFileSync(F('link'), "import React from 'react'; export default function Link({href,children,...r}){return React.createElement('a',{...r,href:String(href)},children);}\n");
  writeFileSync(F('auth'), 'export let uid = null;\nexport function setUid(v) { uid = v; }\nexport async function auth() { return uid == null ? null : { user: { id: uid } }; }\n');
  writeFileSync(F('hdr'), 'export default function H() { return null; }\n');
  writeFileSync(F('foot'), 'export default function F() { return null; }\n');
  writeFileSync(F('create'), [
    "export let day = { season_year: 2025, meta: {} };",
    'export function setDay(v) { day = v; }',
    'export async function currentOctoberDay() { return day; }',
  ].join('\n') + '\n');
  // NO poolSplit AND NO usedPlayers IN THE STUBS. Both are deleted with the
  // burn; a stub that still exported them would let this test pass over a page
  // that had gone back to importing them.
  // THE STUB RECORDS ITS OPTIONS, so the page's own wiring is observable: which
  // memberIds it scoped by, and WHICH TOURNAMENT it said it was asking about.
  writeFileSync(F('board'), [
    'export let rows = [];',
    'export const calls = [];',
    'export function setRows(v) { rows = v; }',
    'export async function octoberBoard(season, opts) { calls.push({ season, ...opts }); return rows; }',
  ].join('\n') + '\n');
  writeFileSync(F('leagues'), [
    'export let mine = [];',
    'export let members = [];',
    'export let detail = null;',
    'export function setMine(v) { mine = v; }',
    'export function setMembers(v) { members = v; }',
    'export function setDetail(v) { detail = v; }',
    'export async function myLeagues() { return mine; }',
    'export async function leagueMemberIds() { return members; }',
    'export async function leagueDetail() { return detail; }',
  ].join('\n') + '\n');
  writeFileSync(F('lgactions'), 'export async function joinLeagueAction() { return { ok: true, leagueId: 1 }; }\nexport async function createLeagueAction() { return { ok: true, leagueId: 2, joinCode: "ABC234" }; }\n');
  writeFileSync(F('nav'), 'export function useRouter() { return { push() {}, refresh() {} }; }\nexport function useSearchParams() { return new URLSearchParams(); }\n');
  writeFileSync(F('shell'), 'export async function resolveShellMode() { return { isShell: false }; }\n');
  writeFileSync(F('series'), 'export let series = [];\nexport function setSeries(v) { series = v; }\nexport async function seriesFor() { return series; }\n');
  writeFileSync(F('css'), 'export default {};\n');
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  boardStub = await import(pathToFileURL(F('board')).href);
  seriesStub = await import(pathToFileURL(F('series')).href);
  leaguesStub = await import(pathToFileURL(F('leagues')).href);
  createStub = await import(pathToFileURL(F('create')).href);
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
const render = async (q = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(q) }));

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

test('LEAGUE CHIPS: myLeagues, the ?league= filter, and the board scoped to members', async () => {
  authStub.setUid(9);
  boardStub.setRows(ROWS);
  leaguesStub.setMine([{ id: 1, name: 'Silva Family' }, { id: 2, name: 'CSM Office' }]);
  seriesStub.setSeries([]);

  // EVERYONE: no filter, and the board's own line is untouched.
  const everyone = await render({});
  assert.match(everyone, /class="oc-lg on" href="\/october\/board">Everyone<\/a>/);
  assert.match(everyone, /class="oc-lg" href="\/october\/board\?league=1">Silva Family<\/a>/);
  assert.match(everyone, /class="oc-lg" href="\/october\/board\?league=2">CSM Office<\/a>/);
  assert.match(everyone, /4 playing · the World Series decides it/);

  // ONE LEAGUE: the chip lights, the header names it, and the reader's OWN
  // memberships decide the filter - leagueMemberIds is what scopes the read.
  leaguesStub.setMembers([9, 5]);
  leaguesStub.setDetail({ join_code: 'HTR4MK' });
  const picked = await render({ league: '1' });
  assert.match(picked, /class="oc-lg on" href="\/october\/board\?league=1">Silva Family<\/a>/);
  assert.match(picked, /Silva Family · 4 playing/);
  assert.doesNotMatch(picked, /the World Series decides it/, 'the league line replaces it');

  // + JOIN AND + CREATE, the shared sheet, on this board too.
  assert.match(picked, /class="lgc-chip"[^>]*>\+ Join<\/button>/);
  assert.match(picked, /class="lgc-chip"[^>]*>\+ Create<\/button>/);

  // THE INVITE IS THE LEAGUE'S OWN CODE and a path that EXISTS.
  assert.match(picked, /<b>HTR4MK<\/b>/);
  assert.match(picked, /\/leagues\?join=HTR4MK/);
  assert.doesNotMatch(picked, /leagues\/join\/HTR4MK/);
  assert.doesNotMatch(picked, /sportsvyn\.com/);

  // A LEAGUE ID THE READER IS NOT IN IS NOT A BOARD. The filter is built from
  // their own memberships, so a guessed id falls back to Everyone rather than
  // showing somebody else's league.
  const guessed = await render({ league: '9999' });
  assert.match(guessed, /class="oc-lg on" href="\/october\/board">Everyone<\/a>/);
  assert.doesNotMatch(guessed, /Invite/);
});

test("THE PAGE TELLS THE READER WHICH TOURNAMENT IT IS ASKING ABOUT", async () => {
  // A PREVIEW DAY AND A REAL DAY ARE THE SAME season_year. The reader scopes by
  // meta.preview (lib/october/board.test.mjs proves the SQL); this asserts the
  // PAGE hands it the day it is actually showing, which is the half a reader test
  // cannot see. Dropping `preview` from this call used to change nothing here.
  authStub.setUid(9);
  boardStub.setRows(ROWS);
  leaguesStub.setMine([]);
  seriesStub.setSeries([]);

  createStub.setDay({ season_year: 2025, meta: { preview: true } });
  boardStub.calls.length = 0;
  await render({});
  assert.equal(boardStub.calls.at(-1).preview, true, 'a preview day asks for the preview board');

  createStub.setDay({ season_year: 2025, meta: {} });
  boardStub.calls.length = 0;
  await render({});
  assert.equal(boardStub.calls.at(-1).preview, false, 'a postseason day asks for the postseason board');

  // AND THE MEMBER SCOPE RIDES THE SAME CALL: null for Everyone.
  assert.equal(boardStub.calls.at(-1).memberIds, null);
  leaguesStub.setMine([{ id: 1, name: 'Silva Family' }]);
  leaguesStub.setMembers([9, 5]);
  boardStub.calls.length = 0;
  await render({ league: '1' });
  assert.deepEqual(boardStub.calls.at(-1).memberIds, [9, 5], 'a league scopes by its members');
});

test('ONE ENTRY, ANY NUMBER OF LEAGUES: the reader keeps one card and one number', async () => {
  // THE RULING, and it falls out of the shape: a league holds MEMBERS, not
  // entries, so the same row appears on every board its owner is a member of -
  // with the same total, because there is only one entry to read.
  authStub.setUid(9);
  boardStub.setRows(ROWS);
  leaguesStub.setMine([{ id: 1, name: 'Silva Family' }, { id: 2, name: 'CSM Office' }]);
  leaguesStub.setMembers([9, 5]);
  leaguesStub.setDetail(null);
  const one = await render({ league: '1' });
  const two = await render({ league: '2' });
  const mine = (h) => /<div class="ob-lr you" data-rank="(\d+)"><span class="rk">\d+<\/span><span>you<\/span><span class="d">([^<]*)<\/span><span class="t">([^<]*)<\/span>/.exec(h);
  assert.ok(mine(one), 'a "you" row on the first league');
  assert.deepEqual(mine(one).slice(1), mine(two).slice(1), 'same rank, same delta, same total');
  // AND THE READER'S OWN HEADER NUMBER IS THE SAME ON BOTH.
  const tot = (h) => /<div class="oc-tot"><b>([^<]*)<\/b>/.exec(h)[1];
  assert.equal(tot(one), tot(two));
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
