// components/october/octoberCard.test.mjs - frames 1 and 2 of the mock,
// MOUNTED. The picking card and the live card are the same component at two
// moments, which is the claim this file actually tests.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACTION = stubPath('__oct_action_stub.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec.endsWith('app/actions/october')) return { url: pathToFileURL(ACTION).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, OctoberCard, createRoot, act, dom, action;
const roots = new Set();
before(async () => {
  writeFileSync(ACTION, [
    'export const calls = [];',
    'export let reply = { ok: true };',
    'export let boom = false;',
    'export function setReply(r) { reply = r; }',
    "export function setThrow(b) { boom = b; }",
    "export async function saveOctoberPickAction(c, s, p) { calls.push({ c, s, p }); if (boom) throw new Error('network'); return reply; }",
    "export async function clearOctoberPickAction(c, s) { calls.push({ c, s, clear: true }); if (boom) throw new Error('network'); return reply; }",
  ].join('\n') + '\n');
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/october' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react'); ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  OctoberCard = (await import('./OctoberCard.js')).default;
  action = await import(pathToFileURL(ACTION).href);
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { try { unlinkSync(ACTION); } catch { /* gone */ } });

const t = (abbr, c1, c2) => ({ abbr, name: abbr, c1, c2 });
const BOARD = [
  { matchId: 1, slug: 'tb-nyy', kickoffAt: '2026-09-29T17:08:00Z', away: t('TB', '#092C5C', '#8FBCE6'), home: t('NYY', '#0C2340', '#C4CED3'), status: 'live', pickable: false, probables: null },
  { matchId: 2, slug: 'phi-atl', kickoffAt: '2026-09-29T18:08:00Z', away: t('PHI', '#E81828', '#002D72'), home: t('ATL', '#CE1141', '#13274F'), status: 'scheduled', pickable: true, probables: { away: { id: '90' } } },
  { matchId: 3, slug: 'det-sea', kickoffAt: '2026-09-29T22:08:00Z', away: t('DET', '#0C2340', '#E31937'), home: t('SEA', '#0C2C56', '#005C5C'), status: 'scheduled', pickable: true, probables: null },
];
const POOL = {
  byGame: {
    2: [
      { playerId: '90', short: 'Z. Wheeler', name: 'Zack Wheeler', kind: 'arm', team: 'PHI', position: 'SP', matchId: 2, ppg: 18.4, probable: true },
      { playerId: '91', short: 'R. Acuña Jr.', name: 'Ronald Acuña Jr.', kind: 'bat', team: 'ATL', position: 'CF', matchId: 2, ppg: 9.8 },
      { playerId: '92', short: 'K. Schwarber', name: 'Kyle Schwarber', kind: 'bat', team: 'PHI', position: 'DH', matchId: 2, ppg: 9.1 },
      { playerId: '93', short: 'B. Harper', name: 'Bryce Harper', kind: 'bat', team: 'PHI', position: '1B', matchId: 2, ppg: 8.6 },
      { playerId: '94', short: 'A. Riley', name: 'Austin Riley', kind: 'bat', team: 'ATL', position: '3B', matchId: 2, ppg: 7.4 },
    ],
  },
};
const RULES = {
  bats: '1B 3 · 2B 5 · 3B 8 · HR 10 · RBI 2 · R 2 · BB 2 · SB 5',
  arms: 'IP 2.25 · K 2 · W 4 · ER -2 · H -0.6 · BB -0.6',
};

const slot = (s, o = {}) => ({ slot: s, state: 'pending', points: null, line: null, pip: 'open', name: null, ...o });

/** Frame 1: three picked, one locked, two open. */
const PICKING = () => ({
  phase: 'open',
  contest: { id: 5, day: '2026-09-29', season: 2026, stage: 'wild_card', games: 3, locksAt: '2026-09-29T22:08:00Z', settled: false, rules: RULES },
  board: BOARD,
  slots: [
    slot('arm', { pip: 'picked', name: 'Skubal', playerId: '50', matchId: 3, team: 'DET' }),
    slot('bat1', { pip: 'locked', name: 'Díaz', playerId: '51', matchId: 1, team: 'TB' }),
    slot('bat2', { pip: 'picked', name: 'Harper', playerId: '93', matchId: 2, team: 'PHI' }),
    slot('bat3'), slot('bat4'),
  ],
  progress: { pips: ['picked', 'locked', 'picked', 'open', 'open'], filled: 3, locked: 1, picked: 2, open: 2, total: 5 },
  dayState: 'open', isDnf: false, total: 13,
  // THE LABEL IS WHAT THE HEADER PRINTS - gameLabel()'s "PHI @ ATL", never the
  // slug. The slug rides along because the view still ships it; nothing renders it.
  nextLock: {
    matchId: 2, slug: 'phi-atl', label: 'PHI @ ATL',
    kickoffAt: '2026-09-29T18:08:00Z', msAway: 68 * 60000,
  },
  // NO `used` MAP. October has no burn, so the view does not ship one.
  todaysBest: null,
  pool: POOL, score: null,
});

const html = (props) => renderToStaticMarkup(React.createElement(OctoberCard, props));

test("FRAME 1 - PICKING: the header, the pips and the mock's own counts", () => {
  const h = html({ view: PICKING(), signedIn: true });
  assert.match(h, /<span class="oc-eb">October<\/span>/);
  assert.match(h, /Wild Card · 3 games/);
  // A PREVIEW NAMES ITSELF IN THE EYEBROW. stageLabel() falls back to
  // "Postseason" on the null stage a regular-season day has, so without the
  // contest's own label the card would call six days of September the
  // postseason - which it did, on the first served page.
  const prev = PICKING();
  prev.contest.stage = null;
  prev.contest.seasonLabel = 'PREVIEW · regular season';
  assert.match(html({ view: prev, signedIn: true }), /PREVIEW · regular season · 3 games/);
  assert.doesNotMatch(html({ view: prev, signedIn: true }), /Postseason/);
  // AND IT COUNTS IN ENGLISH. A World Series night is one game, not "1 games".
  const oneGame = PICKING(); oneGame.contest.games = 1;
  assert.match(html({ view: oneGame, signedIn: true }), /World Series · 1 game<|Wild Card · 1 game</);
  // FIVE PIPS, ONE PER SLOT: jade locked, volt picked, empty open.
  assert.deepEqual([...h.matchAll(/class="oc-pip( lk| on)?"/g)].map((m) => (m[1] ?? '').trim()),
    ['on', 'lk', 'on', '', '']);
  assert.match(h, /<b>3<\/b><span>of 5<\/span>/);
  assert.match(h, /1 locked · 2 picked · 2 open/);
  // THE CLOCK COUNTS TO THE NEXT LOCK, never to midnight - AND THE LABEL IS A
  // MATCH-UP, NOT A SLUG. This line read next.slug.toUpperCase(), which put
  // MLB-2026-09-23-MIN-SF-G2 in the header of the served card.
  assert.match(h, /next lock<b>PHI @ ATL · /);
  assert.doesNotMatch(h, /PHI-ATL/, 'no slug anywhere on the card');
  // THE RIGHT-HAND STAT IS BLANK UNTIL A SLOT SETTLES - not "0", which would
  // read as a card that scored nothing. It used to be the burn count.
  assert.match(h, /1 locked · 2 picked · 2 open<\/span><span><\/span>/);
  assert.doesNotMatch(h, /used in October/);
  // THE CLOCK IS A SERVER READING, shipped as a number: 68 minutes is 01:08.
  assert.match(h, /aria-label="01 hours 08 minutes to the next lock"/);
  // THE RULES ARE ON THE CARD, in full, and the DNF sentence with them.
  assert.match(h, /1B 3 · 2B 5 · 3B 8 · HR 10 · RBI 2 · R 2 · BB 2 · SB 5/);
  assert.match(h, /IP 2\.25 · K 2 · W 4 · ER -2 · H -0\.6 · BB -0\.6/);
  assert.match(h, /An empty slot at first pitch is a DNF for the day\./);
  // THE RULE THAT REPLACED THE BURN, in the one place the card states its rules.
  assert.match(h, /<b>Tomorrow is a new five\.<\/b>/);
  assert.doesNotMatch(h, /gone for the rest of October/);
  assert.match(h, /2 to go/);
});

test('THE ARM IS THE WIDE SLOT AND THE BATS ARE FOUR', () => {
  const h = html({ view: PICKING(), signedIn: true });
  const slots = [...h.matchAll(/data-slot="(\w+)" data-state="(\w+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(slots, [['arm', 'filled'], ['bat1', 'locked'], ['bat2', 'filled'], ['bat3', 'open'], ['bat4', 'open']]);
  // The arm carries the mock's own p class; the bats carry b.
  assert.match(h, /class="oc-slot p filled"/);
  assert.equal([...h.matchAll(/class="oc-slot b[^"]*"/g)].length, 4);
  // A LOCKED SLOT SAYS LOCKED AND HAS NO CLEAR BUTTON.
  assert.match(h, /<span class="oc-lk" aria-label="locked"[^>]*>.*?<b>LOCKED<\/b><\/span>/);
  assert.equal([...h.matchAll(/class="oc-x"/g)].length, 2, 'only the two unlocked picks can be cleared');
  // An open slot is the volt eligible target.
  assert.equal([...h.matchAll(/class="oc-slot b elig"/g)].length, 2);
});

test('A LIVE GAME IS DIMMED AND UNPICKABLE, not removed', () => {
  const h = html({ view: PICKING(), signedIn: true });
  // The reader may have a locked slot in it - Díaz is in the live TB @ NYY.
  assert.match(h, /class="oc-gc live lk"/);
  assert.match(h, /<button[^>]*class="oc-gc live lk"[^>]*disabled/);
  assert.match(h, /TB @ NYY/);
  assert.equal([...h.matchAll(/data-game="/g)].length, 3);
});

test('ONLY A PLAYER ON YOUR OWN CARD IS SPENT - there is no "used <date>" row', () => {
  const h = html({ view: PICKING(), signedIn: true });
  assert.match(h, /<b>B\. Harper<\/b><small>PHI · on your card<\/small>/);
  assert.match(h, /<b>K\. Schwarber<\/b><small>PHI · DH<\/small>/);
  // A. RILEY WAS THE BURN'S OWN ROW - spent on Sep 27, dimmed, unpickable. With
  // no burn he is an ordinary row: his position, and tappable.
  assert.match(h, /<b>A\. Riley<\/b><small>ATL · 3B<\/small>/);
  assert.doesNotMatch(h, /used Sep 27/);
  assert.doesNotMatch(h, /class="oc-prow gone" disabled="" data-player="94"/);
  // EXACTLY ONE DIMMED ROW, and it is the one already on the card.
  assert.equal([...h.matchAll(/class="oc-prow gone"/g)].length, 1);
  assert.match(h, /class="oc-prow gone" disabled="" data-player="93"/);
  // The arm is offered first and marked as the probable.
  const rows = [...h.matchAll(/data-player="(\d+)"/g)].map((m) => m[1]);
  assert.equal(rows[0], '90');
});

test('FRAME 2 - LIVE: points land as the box score does', () => {
  const v = PICKING();
  v.slots = [
    slot('arm', { pip: 'locked', playerId: '50', name: 'Skubal', state: 'pending', points: null, matchId: 3, team: 'DET' }),
    slot('bat1', { pip: 'locked', playerId: '51', name: 'Díaz', state: 'final', points: 13, line: '2-4 · 2B · 2 RBI', matchId: 1, team: 'TB' }),
    slot('bat2', { pip: 'locked', playerId: '93', name: 'Harper', state: 'live', points: 14, line: '1-3 · HR', matchId: 2, team: 'PHI' }),
    slot('bat3', { pip: 'locked', playerId: '91', name: 'Acuña', state: 'live', points: 4.5, matchId: 2, team: 'ATL' }),
    slot('bat4', { pip: 'locked', playerId: '52', name: 'Tatis', state: 'pending', points: null, matchId: 3, team: 'SD' }),
  ];
  v.progress = { pips: ['locked', 'locked', 'locked', 'locked', 'locked'], filled: 5, locked: 5, picked: 0, open: 0, total: 5 };
  v.total = 31.5;
  const h = html({ view: v, signedIn: true });
  // A FINAL IS PAPER, A LIVE ONE IS VOLT, A PENDING ONE IS AN EM-DASH.
  assert.match(h, /<span class="oc-pts fin">13<\/span>/);
  assert.match(h, /<span class="oc-pts">14<\/span>/);
  assert.match(h, /<span class="oc-pts">4\.5<\/span>/);
  assert.equal([...h.matchAll(/class="oc-pts wait">–</g)].length, 2);
  assert.match(h, /<b>31\.5<\/b>/);
  // FIVE OF FIVE IS A RECEIPT, not a button.
  assert.match(h, /✓ RECEIPT · 5 OF 5/);
  assert.doesNotMatch(h, /to go<\/button>/);
});

test('A DNF DAY SAYS DNF ON THE CARD', () => {
  const v = PICKING();
  v.isDnf = true; v.dayState = 'dnf';
  const h = html({ view: v, signedIn: true });
  assert.match(h, /This day is a <b>DNF<\/b>/);
  assert.match(h, /an empty slot passed its first pitch/);
});

test('SIGNED OUT THE CARD IS READ-ONLY and says how to change that', () => {
  const h = html({ view: PICKING(), signedIn: false, signinHref: '/signin?next=x' });
  assert.match(h, /<a class="oc-lock" href="\/signin\?next=x">Sign in to play<\/a>/);
  // Every player row disabled - no pick leaves or arrives without a session.
  assert.equal([...h.matchAll(/<button[^>]*class="oc-prow[^"]*"[^>]*disabled/g)].length, 5);
});

test("THE SERVER'S ANSWER WINS: a refused pick is repainted with its reason", async () => {
  const el = document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  action.calls.length = 0; action.setReply({ ok: true });
  await act(async () => { root.render(React.createElement(OctoberCard, { view: PICKING(), signedIn: true })); });

  // A tap fills the first OPEN slot of that player's kind.
  await act(async () => { el.querySelector('[data-player="92"]').click(); });
  assert.equal(action.calls.at(-1).s, 'bat3');
  assert.equal(action.calls.at(-1).p.playerId, '92');
  assert.equal(el.querySelector('[data-slot="bat3"]').dataset.state, 'filled');

  // A refusal repaints it back and names the rule. 'used' is no longer one of
  // them - October has no burn - so this drives the cap, which is.
  action.setReply({ ok: false, reason: 'max_from_game' });
  await act(async () => { el.querySelector('[data-player="91"]').click(); });
  assert.equal(el.querySelector('[data-slot="bat4"]').dataset.state, 'open');
  assert.match(el.textContent, /That is the most this slate allows from one game\./);
  assert.doesNotMatch(el.textContent, /already used that player/);
});

test('THE CARD PRINTS THE DAY\'S OWN CAP, because it is the one rule that moves', () => {
  // Three games: ceil(5/3) = 2, so the phrase names two.
  const three = PICKING();
  three.contest.maxPerGame = 2;
  assert.match(html({ view: three, signedIn: true }), /only from today&#x27;s games, at most 2 from any one game\. Each slot/);

  // Two games: ceil(5/2) = 3.
  const two = PICKING();
  two.contest.maxPerGame = 3;
  two.board = BOARD.slice(0, 2);
  assert.match(html({ view: two, signedIn: true }), /at most 3 from any one game/);

  // A ONE-GAME DAY HAS NO CAP WORTH NAMING - all five come from it, and
  // "at most 5 from any one game" would be noise on a card that has exactly
  // one game to pick from.
  const one = PICKING();
  one.contest.maxPerGame = 5;
  one.board = BOARD.slice(0, 1);
  const h = html({ view: one, signedIn: true });
  assert.match(h, /only from today&#x27;s games\. Each slot/);
  assert.doesNotMatch(h, /from any one game/);

  // AND THE CARD IS STILL FIVE, whatever the slate.
  for (const v of [one, two, three]) {
    assert.equal([...html({ view: v, signedIn: true }).matchAll(/data-slot="/g)].length, 5);
    // /class="oc-pip/ also matches the container's own class="oc-pips".
    assert.equal([...html({ view: v, signedIn: true }).matchAll(/<i class="oc-pip/g)].length, 5);
  }
});

// --- STARTERS ONLY ---------------------------------------------------------

test('STARTERS: a picker row carries its batting order, and an unannounced arm says so', () => {
  const v = PICKING();
  v.board = v.board.map((g) => (g.matchId === 2 ? { ...g, lineupPosted: { away: true, home: true } } : g));
  v.pool = { byGame: { 2: [
    { playerId: '90', short: 'Z. Wheeler', name: 'Zack Wheeler', kind: 'arm', team: 'PHI', position: 'SP', matchId: 2, ppg: 18.4, probable: true, order: null },
    { playerId: '92', short: 'K. Schwarber', name: 'Kyle Schwarber', kind: 'bat', team: 'PHI', position: 'DH', matchId: 2, ppg: 9.1, order: 1 },
    { playerId: '97', short: 'B. Marsh', name: 'Brandon Marsh', kind: 'bat', team: 'PHI', position: 'LF', matchId: 2, ppg: 8.6, order: 3 },
    { playerId: '93', short: 'B. Harper', name: 'Bryce Harper', kind: 'bat', team: 'PHI', position: '1B', matchId: 2, ppg: 8.5, order: 4 },
    { playerId: '95', short: 'T. Turner', name: 'Trea Turner', kind: 'bat', team: 'PHI', position: 'SS', matchId: 2, ppg: 7.9, order: 11 },
    { playerId: '96', short: 'A. Nola', name: 'Aaron Nola', kind: 'arm', team: 'PHI', position: 'SP', matchId: 2, ppg: 12.0, probable: false, probablePending: true, order: null },
  ] } };
  const h = html({ view: v, signedIn: true });
  assert.match(h, /PHI · bats 1st/);
  assert.match(h, /PHI · bats 3rd/);
  // A BAT ALREADY ON THE CARD KEEPS "on your card" - the reader's own state
  // outranks the batting order, which is what every other row already did.
  assert.match(h, /B\. Harper<\/b><small>PHI · on your card/);
  // 11th, not "11st" - the teens are the case every ordinal helper gets wrong.
  assert.match(h, /PHI · bats 11th/);
  assert.match(h, /PHI · starter not announced/);
  // AND THE ANNOUNCED ONE SAYS "probable starter", NOT ITS BDL POSITION. That
  // position is a season-long role: the served CHW @ KC panel labelled the
  // announced starter "RP", which reads as a reliever left in by mistake.
  assert.match(h, /Z\. Wheeler<\/b><small>PHI · probable starter<\/small>/);
  // THE PROBABLE IS NOT LABELLED WITH A BATTING ORDER. An arm has none.
  assert.doesNotMatch(h, /Z\. Wheeler<\/b><small>PHI · bats/);
  // AND THE PANEL SAYS WHOSE CARD IS UP, off the board and not off the
  // probables - which are a pitcher and not a lineup at all.
  assert.match(h, /lineups posted/);
});

test('STARTERS: the panel says "lineup not posted yet" before either club posts', () => {
  const v = PICKING();
  v.board = v.board.map((g) => (g.matchId === 2 ? { ...g, lineupPosted: { away: false, home: false } } : g));
  assert.match(html({ view: v, signedIn: true }), /lineup not posted yet/);
  const one = PICKING();
  one.board = one.board.map((g) => (g.matchId === 2 ? { ...g, lineupPosted: { away: true, home: false } } : g));
  assert.match(html({ view: one, signedIn: true }), /one lineup posted/);
});

test('STARTERS: a picked bat off the posted card reads "not starting · swap"', () => {
  const v = PICKING();
  // bat2 is Harper, in an OPEN game (2): the reader can still act.
  v.slots = v.slots.map((s) => (s.slot === 'bat2' ? { ...s, notStarting: true } : s));
  const h = html({ view: v, signedIn: true });
  assert.match(h, /<span class="oc-tm swap">not starting · swap<\/span>/);
  // ONE SENTENCE, NOT TWO: it replaces the club-and-time line rather than
  // crowding in beside it.
  assert.equal([...h.matchAll(/class="oc-tm swap"/g)].length, 1);
});

test('STARTERS: a LOCKED slot never shows a swap it cannot act on', () => {
  const v = PICKING();
  // bat1 is locked (game 1 is live). Even flagged, the card must not say swap.
  v.slots = v.slots.map((s) => (s.slot === 'bat1' ? { ...s, notStarting: true } : s));
  const h = html({ view: v, signedIn: true });
  assert.doesNotMatch(h, /not starting · swap/);
  assert.match(h, /LOCKED/);
});

// --- POSTPONED, AND THE HOUSE CLOCK ----------------------------------------

test('POSTPONED: the tile reads PPD, is dimmed, and cannot be tapped', () => {
  const v = PICKING();
  v.board = v.board.map((g) => (g.matchId === 3
    ? { ...g, status: 'postponed', pickable: false } : g));
  const h = html({ view: v, signedIn: true });
  const tile = h.slice(h.indexOf('data-game="det-sea"') - 240, h.indexOf('data-game="det-sea"') + 420);
  assert.match(tile, /<small>PPD<\/small>/);
  assert.match(tile, /class="oc-gc[^"]* ppd[^"]*"/);
  assert.match(tile, /disabled=""/);
  // AND THE TIME IS GONE FROM IT. Printing the original first pitch is printing
  // a time nothing will happen at.
  assert.doesNotMatch(tile, /6:08 PM|3:08 PM/);
});

test('POSTPONED: a slot in a called-off game says PPD, not a kickoff time', () => {
  const v = PICKING();
  v.board = v.board.map((g) => (g.matchId === 3
    ? { ...g, status: 'postponed', pickable: false } : g));
  // The arm is picked out of game 3.
  const h = html({ view: v, signedIn: true });
  assert.match(h, /<span class="oc-tm">DET · PPD<\/span>/);
});

test('TIMES: every time on this card is Pacific, and says so', () => {
  const h = html({ view: PICKING(), signedIn: true });
  // 2026-09-29T18:08:00Z is 2:08 PM Eastern and 11:08 AM Pacific. The card
  // printed the Eastern one, unlabelled, for its whole life.
  assert.match(h, /11:08 AM PT/);
  assert.doesNotMatch(h, /2:08 PM(?! PT)/);
  // The next-lock label, the game tile and the slot sub-line all agree.
  assert.match(h, /next lock<b>PHI @ ATL · 11:08 AM PT<\/b>/);
  assert.match(h, /<small>11:08 AM PT<\/small>/);
  assert.match(h, /<span class="oc-tm">PHI · 11:08 AM PT<\/span>/);
});

// --- THE PANEL: SCROLL, SORT, AND THE FOURTH BAT ---------------------------

/** A card with THREE bats set and the fourth slot open - item 3's state. */
const THREE_BATS = () => {
  const v = PICKING();
  v.board = v.board.map((g) => (g.matchId === 2
    ? { ...g, lineupPosted: { away: true, home: true } } : g));
  v.slots = [
    slot('arm', { pip: 'picked', name: 'Skubal', playerId: '50', matchId: 3, team: 'DET' }),
    slot('bat1', { pip: 'picked', name: 'Schwarber', playerId: '92', matchId: 2, team: 'PHI' }),
    slot('bat2', { pip: 'picked', name: 'Marsh', playerId: '97', matchId: 2, team: 'PHI' }),
    slot('bat3', { pip: 'picked', name: 'Riley', playerId: '94', matchId: 2, team: 'ATL' }),
    slot('bat4'),
  ];
  v.progress = { pips: ['picked', 'picked', 'picked', 'picked', 'open'], filled: 4, locked: 0, picked: 4, open: 1, total: 5 };
  // NO v.used - October ships no burn map; the fixture must not invent one.
  v.pool = { byGame: { 2: [
    { playerId: '90', short: 'Z. Wheeler', name: 'Zack Wheeler', kind: 'arm', team: 'PHI', position: 'SP', matchId: 2, ppg: 18.4, probable: true },
    { playerId: '92', short: 'K. Schwarber', name: 'Kyle Schwarber', kind: 'bat', team: 'PHI', position: 'DH', matchId: 2, ppg: 9.1, order: 1 },
    { playerId: '97', short: 'B. Marsh', name: 'Brandon Marsh', kind: 'bat', team: 'PHI', position: 'LF', matchId: 2, ppg: 8.6, order: 3 },
    { playerId: '94', short: 'A. Riley', name: 'Austin Riley', kind: 'bat', team: 'ATL', position: '3B', matchId: 2, ppg: 7.4, order: 4 },
    { playerId: '95', short: 'T. Turner', name: 'Trea Turner', kind: 'bat', team: 'PHI', position: 'SS', matchId: 2, ppg: 7.9, order: 2 },
  ] } };
  return v;
};

test('THE FOURTH BAT: three bats and an open slot accepts a fourth', async () => {
  const el = dom.window.document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  const v = THREE_BATS();
  act(() => root.render(React.createElement(OctoberCard, { view: v, signedIn: true })));
  action.calls.length = 0;
  action.setReply({ ok: true });

  // Trea Turner: a bat, not on the card, not used, in an open game.
  const row = el.querySelector('[data-player="95"]');
  assert.ok(row, 'the fourth bat is offered at all');
  assert.equal(row.disabled, false, 'and is tappable');
  await act(async () => { row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

  // IT MUST REACH THE SERVER. "All four bat slots are filled" with an open slot
  // is the component refusing a pick the card is showing as available.
  assert.doesNotMatch(el.innerHTML, /All four bat slots are filled/);
  assert.equal(action.calls.length, 1, 'the save was attempted');
  assert.equal(action.calls[0].s, 'bat4', 'into the open slot, not into a filled one');
  assert.equal(action.calls[0].p.playerId, '95');
});

test('THE FOURTH BAT: four filled bats DO refuse, and say so', async () => {
  const el = dom.window.document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  const v = THREE_BATS();
  v.slots = v.slots.map((s) => (s.slot === 'bat4'
    ? slot('bat4', { pip: 'picked', name: 'Olson', playerId: '96', matchId: 2, team: 'ATL' }) : s));
  act(() => root.render(React.createElement(OctoberCard, { view: v, signedIn: true })));
  action.calls.length = 0;
  const row = el.querySelector('[data-player="95"]');
  await act(async () => { row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.match(el.innerHTML, /All four bat slots are filled/);
  assert.equal(action.calls.length, 0, 'and nothing is sent');
});

test('THE PANEL: every posted bat of BOTH clubs is rendered', () => {
  const v = PICKING();
  v.board = v.board.map((g) => (g.matchId === 2
    ? { ...g, lineupPosted: { away: true, home: true } } : g));
  // Two full posted cards - nine and nine - plus both starters: twenty rows.
  const phi = Array.from({ length: 9 }, (_, i) => ({
    playerId: `p${i}`, short: `P. Bat${i + 1}`, name: `Phi Bat ${i + 1}`, kind: 'bat',
    team: 'PHI', position: 'LF', matchId: 2, ppg: 9 - i * 0.1, order: i + 1,
  }));
  const atl = Array.from({ length: 9 }, (_, i) => ({
    playerId: `a${i}`, short: `A. Bat${i + 1}`, name: `Atl Bat ${i + 1}`, kind: 'bat',
    team: 'ATL', position: 'RF', matchId: 2, ppg: 8 - i * 0.1, order: i + 1,
  }));
  v.pool = { byGame: { 2: [
    { playerId: '90', short: 'Z. Wheeler', name: 'Zack Wheeler', kind: 'arm', team: 'PHI', position: 'SP', matchId: 2, ppg: 18.4, probable: true },
    { playerId: '91', short: 'S. Strider', name: 'Spencer Strider', kind: 'arm', team: 'ATL', position: 'SP', matchId: 2, ppg: 17.1, probable: true },
    ...phi, ...atl,
  ] } };
  const h = html({ view: v, signedIn: true });
  // TWENTY ROWS. It rendered the first TWELVE - one club's nine plus three of
  // the other's - and the rest were unreachable and unmentioned.
  assert.equal([...h.matchAll(/class="oc-prow/g)].length, 20);
  for (const p of [...phi, ...atl]) {
    assert.ok(h.includes(`data-player="${p.playerId}"`), `${p.short} is missing from the panel`);
    assert.match(h, new RegExp(`<b>${p.short.replace('.', '\\.')}</b><small>${p.team} · bats `));
  }
});

test('THE PANEL: arms first, then bats by PPG across both clubs', () => {
  const v = PICKING();
  v.board = v.board.map((g) => (g.matchId === 2
    ? { ...g, lineupPosted: { away: true, home: true } } : g));
  v.pool = { byGame: { 2: [
    { playerId: '90', short: 'Z. Wheeler', name: 'Zack Wheeler', kind: 'arm', team: 'PHI', position: 'SP', matchId: 2, ppg: 18.4, probable: true },
    { playerId: 'a', short: 'A. Riley', name: 'Austin Riley', kind: 'bat', team: 'ATL', position: '3B', matchId: 2, ppg: 9.9, order: 4 },
    { playerId: 'b', short: 'K. Schwarber', name: 'Kyle Schwarber', kind: 'bat', team: 'PHI', position: 'DH', matchId: 2, ppg: 9.1, order: 1 },
    { playerId: 'c', short: 'T. Turner', name: 'Trea Turner', kind: 'bat', team: 'PHI', position: 'SS', matchId: 2, ppg: 7.9, order: 2 },
  ] } };
  const h = html({ view: v, signedIn: true });
  const order = [...h.matchAll(/data-player="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['90', 'a', 'b', 'c'],
    'the arm, then 9.9, 9.1, 7.9 - the ATL bat ahead of both PHI bats');
  // AND THE SUB-LINE STILL CARRIES THE ORDER: "CLUB · bats Nth".
  assert.match(h, /A\. Riley<\/b><small>ATL · bats 4th<\/small>/);
  assert.match(h, /K\. Schwarber<\/b><small>PHI · bats 1st<\/small>/);
});

test('THE FOURTH BAT, THE CAUSE: a save that THROWS must repaint the slot', async () => {
  // THIS IS WHAT PRODUCED "All four bat slots are filled" OVER A CARD WITH
  // THREE. `await action()` rejects on a network drop or a redeploy mid-flight,
  // and the rollback used to be reached only on `ok: false` - so the throw left
  // the optimistic paint standing. The card believed a pick the server never
  // took, and the reader's next tap found no free slot.
  const el = dom.window.document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  act(() => root.render(React.createElement(OctoberCard, { view: THREE_BATS(), signedIn: true })));
  action.calls.length = 0;
  action.setThrow(true);
  try {
    // First tap: the save throws.
    await act(async () => {
      el.querySelector('[data-player="95"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    // THE SLOT IS OPEN AGAIN, and the reader is told why in words they can act on.
    assert.match(el.innerHTML, /did not reach the server/);
    assert.equal(el.querySelector('[data-slot="bat4"]').dataset.state, 'open');

    // AND THE NEXT TAP STILL HAS A SLOT TO GO IN. This is the assertion the bug
    // failed: before the fix bat4 stayed painted and this said "All four bat
    // slots are filled".
    action.setThrow(false);
    action.calls.length = 0;
    await act(async () => {
      el.querySelector('[data-player="95"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert.doesNotMatch(el.innerHTML, /All four bat slots are filled/);
    assert.equal(action.calls.length, 1);
    assert.equal(action.calls[0].s, 'bat4');
  } finally { action.setThrow(false); }
});

// --- THE FIELD COLUMN AT PHONE WIDTH ---------------------------------------
//
// JSDOM HAS NO LAYOUT ENGINE, so these do not measure a rendered box - they
// read the geometry the STYLESHEET specifies and do the arithmetic, and they
// read every number out of the CSS rather than restating it here. A test that
// hard-coded 172 and compared it to 172 would pass on a stylesheet that said
// 400.

const CSS = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
/**
 * The block of the rule whose selector is EXACTLY `rule`. Anchored, because
 * `.rn-slot.out .rn-nm { color: ... }` sits above `.rn-nm` in the stylesheet and
 * an unanchored match reads the wrong four declarations - which it did, and the
 * test "passed" against a rule that says nothing about text.
 */
const ruleOf = (src, rule) => {
  const re = new RegExp(`(?:^|\\})\\s*\\${rule}\\s*\\{([^}]*)\\}`, 'm');
  const m = re.exec(src);
  assert.ok(m, `${rule} is not in the stylesheet as a rule of its own`);
  return m[1];
};
const px = (src, rule, prop) => {
  const block = [ruleOf(src, rule)];
  assert.ok(block, `${rule} is not in the stylesheet`);
  const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(block[0]);
  assert.ok(m, `${rule} has no ${prop}`);
  const n = /(-?[\d.]+)px/.exec(m[1]);
  assert.ok(n, `${rule}'s ${prop} is not in px: ${m[1]}`);
  return Number(n[1]);
};

test('LAYOUT: the field and the panel cannot overlap at 390px', () => {
  const css = CSS('../../app/october/october.css');
  // .oc-duo is `margin: 10px 10px 0` and `gap: 8px`; .oc-field is a hard basis.
  const duo = /\.oc-duo\s*\{([^}]*)\}/.exec(css)[1];
  const margin = Number(/margin:\s*[\d.]+px\s+([\d.]+)px/.exec(duo)[1]);
  const gap = Number(/gap:\s*([\d.]+)px/.exec(duo)[1]);
  const field = px(css, '.oc-field', 'flex').valueOf();

  const VIEWPORT = 390;
  const fieldLeft = margin;
  const fieldRight = fieldLeft + field;
  const panelLeft = fieldRight + gap;
  const panelRight = VIEWPORT - margin;

  assert.ok(fieldRight <= panelLeft, `field right ${fieldRight} > panel left ${panelLeft}`);
  assert.ok(panelLeft < panelRight,
    `the panel has no width left at 390px: ${panelLeft} >= ${panelRight}`);
  // AND THE FIELD IS A HARD WIDTH, not a basis it can grow past: `flex: 0 0`.
  assert.match(/\.oc-field\s*\{([^}]*)\}/.exec(css)[1], /flex:\s*0\s+0\s+[\d.]+px/);

  // THE SPILL WAS NEVER THE BASIS, IT WAS THE CONTENT. A grid item's automatic
  // minimum size is its content, so without these the column overflows its own
  // basis and slides under the panel - which is what a 390px screen showed.
  assert.match(/\.oc-form\s*\{([^}]*)\}/.exec(css)[1], /min-width:\s*0/);
  assert.match(css, /\.oc-form\s*>\s*\*\s*\{[^}]*min-width:\s*0/);
  assert.match(/\.oc-slot\s*\{([^}]*)\}/.exec(css)[1], /overflow:\s*hidden/);
  assert.match(/\.oc-nm\s*\{([^}]*)\}/.exec(css)[1], /text-overflow:\s*ellipsis/);
  assert.match(/\.oc-nm\s*\{([^}]*)\}/.exec(css)[1], /white-space:\s*nowrap/);
});

test('LAYOUT: a bat tile at phone width is under 90px, so the badge is a dot', () => {
  const css = CSS('../../app/october/october.css');
  const field = px(css, '.oc-field', 'flex');
  const pad = Number(/padding:\s*[\d.]+px\s+([\d.]+)px/.exec(/\.oc-field\s*\{([^}]*)\}/.exec(css)[1])[1]);
  const border = 1;
  const gap = Number(/gap:\s*([\d.]+)px/.exec(/\.oc-form\s*\{([^}]*)\}/.exec(css)[1])[1]);
  // Two columns inside the field's content box.
  const inner = field - 2 * pad - 2 * border;
  const tile = (inner - gap) / 2;
  assert.ok(tile < 90, `a bat tile is ${tile}px, which is not under 90`);
  // The arm spans both columns and IS over 90, so it keeps the word - one
  // component, two widths, which is why this is a container query and not a
  // media query.
  assert.ok(inner > 90, `the arm tile is ${inner}px`);
  assert.match(css, /@container \(max-width: 89px\)/);
});

test('LOCKED: the badge is top-right, the position label top-left, never stacked', () => {
  const h = html({ view: PICKING(), signedIn: true });
  // bat1 is the locked slot in this fixture.
  const tile = h.slice(h.indexOf('data-slot="bat1"'), h.indexOf('data-slot="bat2"'));
  // THE LABEL AND THE BADGE ARE BOTH OUT OF THE FLOW, in opposite corners.
  const css = CSS('../../app/october/october.css');
  for (const [rule, side] of [['.oc-pos', 'left'], ['.oc-lk', 'right']]) {
    const block = ruleOf(css, rule);
    assert.match(block, /position:\s*absolute/, `${rule} is still in the flex flow`);
    assert.match(block, new RegExp(`${side}:\\s*[\\d.]+px`), `${rule} is not in the ${side} corner`);
    assert.match(block, /top:\s*[\d.]+px/, `${rule} is not at the top`);
  }
  // THE BADGE CARRIES ITS OWN LABEL, so the dot and the word say the same thing.
  assert.match(tile, /<span class="oc-lk" aria-label="locked" role="img"><i aria-hidden="true"><\/i><b>LOCKED<\/b><\/span>/);
  assert.match(tile, /<span class="oc-pos">BAT<\/span>/);
  // And the dot exists only as the narrow-tile form of that one badge.
  assert.match(css, /\.oc-lk i \{ display: none; \}/);
});

test('LOCKED: the Run 3x3 wears the same badge, and every tile there is a dot', () => {
  const css = CSS('../../app/run/run.css');
  const field = px(css, '.rn-field', 'flex');
  const pad = Number(/padding:\s*[\d.]+px\s+([\d.]+)px/.exec(/\.rn-field\s*\{([^}]*)\}/.exec(css)[1])[1]);
  const gap = Number(/gap:\s*([\d.]+)px/.exec(/\.rn-form\s*\{([^}]*)\}/.exec(css)[1])[1]);
  const tile = (field - 2 * pad - 2 - 2 * gap) / 3;
  assert.ok(tile < 90, `a Run tile is ${tile}px`);
  assert.match(css, /@container \(max-width: 89px\)/);
  for (const [rule, side] of [['.rn-pos', 'left'], ['.rn-lk', 'right']]) {
    const block = ruleOf(css, rule);
    assert.match(block, /position:\s*absolute/);
    assert.match(block, new RegExp(`${side}:\\s*[\\d.]+px`));
  }
  assert.match(ruleOf(css, '.rn-nm'), /text-overflow:\s*ellipsis/);
  assert.match(/\.rn-form\s*\{([^}]*)\}/.exec(css)[1], /min-width:\s*0/);
  // The two fields are the SAME WIDTH - one number for both cards.
  assert.equal(field, px(CSS('../../app/october/october.css'), '.oc-field', 'flex'));
});

// ---------------------------------------- the header's counts, and their source

/** Five bats-and-an-arm set, nothing locked yet - item 3's own card. */
const FIVE_PICKED = () => {
  const v = PICKING();
  v.slots = [
    slot('arm', { pip: 'picked', playerId: '90', name: 'Wheeler', matchId: 2, team: 'PHI' }),
    slot('bat1', { pip: 'picked', playerId: '91', name: 'Acuña', matchId: 2, team: 'ATL' }),
    slot('bat2', { pip: 'picked', playerId: '92', name: 'Schwarber', matchId: 2, team: 'PHI' }),
    slot('bat3', { pip: 'picked', playerId: '94', name: 'Riley', matchId: 2, team: 'ATL' }),
    slot('bat4', { pip: 'picked', playerId: '95', name: 'Turner', matchId: 3, team: 'DET' }),
  ];
  v.progress = { pips: ['picked', 'picked', 'picked', 'picked', 'picked'], filled: 5, locked: 0, picked: 5, open: 0, total: 5 };
  return v;
};

test('THE HEADER COUNTS: picked is a FILLED UNLOCKED slot, so a full card reads 0 · 5 · 0', () => {
  const h = html({ view: FIVE_PICKED(), signedIn: true });
  assert.match(h, /<span>0 locked · 5 picked · 0 open<\/span>/);
  // AND THE TWO READINGS AGREE. "of 5" above and this line both come off the
  // same pips now; they used to come from different places - the live ones and
  // the server's snapshot - so one could say "5 of 5" over "0 picked · 5 open".
  assert.match(h, /<b>5<\/b><span>of 5<\/span>/);
  // A LOCKED SLOT IS NOT PICKED. Lock two and the three counts move together.
  const two = FIVE_PICKED();
  two.slots[0].pip = 'locked'; two.slots[1].pip = 'locked';
  assert.match(html({ view: two, signedIn: true }), /<span>2 locked · 3 picked · 0 open<\/span>/);
  // AN EMPTY CARD IS ALL OPEN, and still not a zero-picked lie about a full one.
  assert.match(html({ view: PICKING(), signedIn: true }), /<span>1 locked · 2 picked · 2 open<\/span>/);
});

test('THE COUNTS FOLLOW THE TAP, not the server snapshot', async () => {
  // THE BUG THIS PINS: the sub-line read view.progress (the server's reading at
  // render) while "of 5" read the live pips. A reader who filled their last slot
  // saw "5 of 5" over "0 picked · 1 open" until something revalidated.
  const el = document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  action.calls.length = 0; action.setReply({ ok: true });
  const v = PICKING();           // 1 locked, 2 picked, 2 open
  await act(async () => { root.render(React.createElement(OctoberCard, { view: v, signedIn: true })); });
  assert.match(el.textContent, /1 locked · 2 picked · 2 open/);
  // Fill one open bat slot. The server's view object is UNCHANGED.
  await act(async () => { el.querySelector('[data-player="92"]').click(); });
  assert.equal(v.progress.picked, 2, 'the snapshot handed in is untouched');
  assert.match(el.textContent, /1 locked · 3 picked · 1 open/);
});
