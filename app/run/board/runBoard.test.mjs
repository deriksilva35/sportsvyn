// app/run/board/runBoard.test.mjs - frame 3 of the mock, RENDERED.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const F = (n) => path.join(__dirname, `__rb_${n}.mjs`);
const NAMES = ['link', 'auth', 'hdr', 'foot', 'create', 'board', 'pool', 'rules', 'leagues', 'series', 'css'];
const MAP = {
  'next/link': 'link', '@/auth': 'auth',
  '@/components/GlobalHeaderServer': 'hdr', '@/components/SiteFooter': 'foot',
  '@/lib/run/create': 'create', '@/lib/run/board': 'board', '@/lib/run/pool': 'pool',
  '@/lib/run/rules': 'rules', '@/lib/leagues/core': 'leagues', '@/lib/mlb/series': 'series',
};
registerHooks({ resolve(spec, ctx, next) {
  if (MAP[spec]) return { url: pathToFileURL(F(MAP[spec])).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(F('css')).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, Page, boardStub, authStub, leaguesStub;
before(async () => {
  writeFileSync(F('link'), "import React from 'react'; export default function Link({href,children,...r}){return React.createElement('a',{...r,href:String(href)},children);}\n");
  writeFileSync(F('auth'), 'export let uid = null;\nexport function setUid(v){uid=v;}\nexport async function auth(){return uid==null?null:{user:{id:uid}};}\n');
  writeFileSync(F('hdr'), 'export default function H(){return null;}\n');
  writeFileSync(F('foot'), 'export default function F(){return null;}\n');
  writeFileSync(F('css'), 'export default {};\n');
  writeFileSync(F('create'), "export async function currentRunRound(){return {season_year:2026, board:{round:'division'}};}\nexport async function settledRounds(){return ['wild_card'];}\n");
  writeFileSync(F('board'), [
    'export let rows = [];',
    'export function setRows(v){rows=v;}',
    'export async function runBoard(){return rows;}',
    "export const ROUND_COLUMNS = [{round:'wild_card',short:'WC'},{round:'division',short:'DIV'},{round:'championship',short:'LCS'},{round:'world_series',short:'WS'}];",
    // The stub SORTS, because lib/run/board.js poolSplit() sorts - a stub
    // that behaves differently from the module it stands in for is testing
    // something the product does not do.
    'export function poolSplit(a){return {used:a.used?.size??0, aliveClubs:[...(a.aliveClubs??[])].sort(), deadClubs:[...(a.deadClubs??[])].sort(), unusedAlive:0, pct:{used:23,alive:48}};}',
  ].join('\n') + '\n');
  writeFileSync(F('pool'), 'export async function usedPlayers(){return new Map([["1","wild_card"],["2","wild_card"]]);}\n');
  writeFileSync(F('rules'), "export function roundPips(cur, done){const R=[['wild_card','Wild Card'],['division','Division'],['championship','LCS'],['world_series','World Series']];return R.map(([r,l])=>({round:r,label:l,state:done.includes(r)?'done':r===cur?'on':'ahead'}));}\n");
  writeFileSync(F('leagues'), [
    'export let mine = [];', 'export function setMine(v){mine=v;}',
    'export async function myLeagues(){return mine;}',
    'export async function leagueMemberIds(){return [1,2,3];}',
    "export async function leagueDetail(){return {id:1,name:'Silva Family',join_code:'HTR4MK'};}",
  ].join('\n') + '\n');
  writeFileSync(F('series'), "export async function seriesFor(){return [{winner:7,teams:[{id:7,abbreviation:'LAD'},{id:8,abbreviation:'MIL'}]},{winner:null,teams:[{id:9,abbreviation:'TOR'},{id:10,abbreviation:'SEA'}]}];}\n");
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  boardStub = await import(pathToFileURL(F('board')).href);
  authStub = await import(pathToFileURL(F('auth')).href);
  leaguesStub = await import(pathToFileURL(F('leagues')).href);
  Page = (await import('./page.js')).default;
});
after(() => { for (const n of NAMES) { try { unlinkSync(F(n)); } catch { /* gone */ } } });

const r = (userId, handle, total, rank, back, rounds, house = false) =>
  ({ userId, handle, house, total, rank, back, rounds });
const ROWS = [
  r(1, 'dsilva35', 118.0, 1, 0, { wild_card: { kind: 'points', points: 118.0 }, division: null, championship: null, world_series: null }),
  r(2, 'camilli_k', 101.5, 2, 16.5, { wild_card: { kind: 'points', points: 101.5 }, division: { kind: 'set' }, championship: null, world_series: null }),
  r(9, 'you', 94.5, 3, 23.5, { wild_card: { kind: 'points', points: 94.5 }, division: null, championship: null, world_series: null }),
  r(4, 'the Closer', 90.0, 4, 28.0, { wild_card: { kind: 'points', points: 90.0 }, division: { kind: 'set' }, championship: null, world_series: null }, true),
  r(10, 'the Homer', 0.0, 10, 118.0, { wild_card: { kind: 'dnf' }, division: { kind: 'set' }, championship: null, world_series: null }, true),
];
const render = async (q = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(q) }));

test('FRAME 3 - THE BOARD: four round columns and a total', async () => {
  authStub.setUid(9);
  boardStub.setRows(ROWS);
  leaguesStub.setMine([{ id: 1, name: 'Silva Family' }, { id: 2, name: 'CSM Office' }]);
  const h = await render({ league: '1' });
  assert.match(h, /Silva Family · 5 playing/);
  assert.match(h, /you<b>3rd · 23\.5 back<\/b>/);
  assert.match(h, /<b>94\.5<\/b><span>Total<\/span>/);
  // ONE COLUMN PER ROUND, in bracket order.
  assert.match(h, /<span class="r">WC<\/span><span class="r">DIV<\/span><span class="r">LCS<\/span><span class="r">WS<\/span>/);
  assert.deepEqual([...h.matchAll(/data-rank="(\d+)"/g)].map((m) => m[1]), ['1', '2', '3', '4', '10']);
  assert.match(h, /class="rb-lr you" data-rank="3"><span class="rk">3<\/span><span>you<\/span>/);
});

test('A ROUND CELL HAS THREE STATES, and the mock draws all three', async () => {
  authStub.setUid(9);
  boardStub.setRows(ROWS);
  leaguesStub.setMine([{ id: 1, name: 'Silva Family' }]);
  const h = await render({ league: '1' });
  // A NUMBER once settled, "set" while committed but unplayed, "DNF" where
  // the nine were never set, and a dash where the round has not opened.
  assert.match(h, /<span class="r">118<\/span>/);
  assert.match(h, /<span class="r set">set<\/span>/);
  assert.match(h, /<span class="r">DNF<\/span>/);
  assert.match(h, /<span class="r">–<\/span>/);
  // A DNF ROUND IS 0 IN THE TOTAL AND STILL SAYS DNF.
  assert.match(h, /the Homer<span class="h"> · house<\/span>/);
  // OPENLY THE HOUSE - lib/house/personas.js's first law.
  assert.equal([...h.matchAll(/<span class="h"> · house<\/span>/g)].length, 2);
});

test('LEAGUE CHIPS, including Everyone, and the invite link', async () => {
  authStub.setUid(9);
  boardStub.setRows(ROWS);
  leaguesStub.setMine([{ id: 1, name: 'Silva Family' }, { id: 2, name: 'CSM Office' }]);
  const picked = await render({ league: '1' });
  assert.match(picked, /class="rn-lg on" href="\/run\/board\?league=1">Silva Family<\/a>/);
  assert.match(picked, /class="rn-lg" href="\/run\/board\?league=2">CSM Office<\/a>/);
  assert.match(picked, /class="rn-lg" href="\/run\/board">Everyone<\/a>/);
  // THE INVITE IS THE SPINE'S OWN JOIN CODE - no second notion of a league.
  assert.match(picked, /sportsvyn\.com\/leagues\/join\/HTR4MK/);

  // EVERYONE is the same board without the member filter, and has no invite.
  const everyone = await render({});
  assert.match(everyone, /Everyone · 5 playing/);
  assert.match(everyone, /class="rn-lg on" href="\/run\/board">Everyone<\/a>/);
  assert.match(everyone, /Create a league from \/leagues/);
});

test('THE POOL BAR splits used, alive and eliminated', async () => {
  authStub.setUid(9);
  boardStub.setRows(ROWS);
  leaguesStub.setMine([]);
  const h = await render({});
  assert.match(h, /used · gone for October<\/span><b>2<\/b>/);
  // MILWAUKEE LOST THEIR SERIES, so they are out and the rest are alive.
  assert.match(h, /clubs eliminated<\/span><b>MIL<\/b>/);
  assert.match(h, /clubs alive<\/span><b>LAD SEA TOR<\/b>/);
  assert.match(h, /class="g" style="width:23%"/);
  // The four pips ride the board too, with the Wild Card done.
  assert.match(h, /class="rn-rd done" data-round="wild_card"/);
  assert.match(h, /class="rn-rd on" data-round="division"/);
});

test('AN EMPTY BOARD SAYS SO, and a stranger has no "you" row', async () => {
  authStub.setUid(null);
  boardStub.setRows([]);
  leaguesStub.setMine([]);
  const h = await render({});
  assert.match(h, /Nobody has set a nine yet\./);
  assert.match(h, /you<b>not entered<\/b>/);
  assert.doesNotMatch(h, /class="rb-lr you"/);
});
