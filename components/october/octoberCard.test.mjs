// components/october/octoberCard.test.mjs - frames 1 and 2 of the mock,
// MOUNTED. The picking card and the live card are the same component at two
// moments, which is the claim this file actually tests.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACTION = path.join(__dirname, '__oct_action_stub.mjs');
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
    'export function setReply(r) { reply = r; }',
    'export async function saveOctoberPickAction(c, s, p) { calls.push({ c, s, p }); return reply; }',
    'export async function clearOctoberPickAction(c, s) { calls.push({ c, s, clear: true }); return reply; }',
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
  nextLock: { matchId: 2, slug: 'phi-atl', kickoffAt: '2026-09-29T18:08:00Z', msAway: 68 * 60000 },
  used: { 94: '2026-09-27' },
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
  // THE CLOCK COUNTS TO THE NEXT LOCK, never to midnight.
  assert.match(h, /next lock<b>PHI-ATL · /);
  // THE CLOCK IS A SERVER READING, shipped as a number: 68 minutes is 01:08.
  assert.match(h, /aria-label="01 hours 08 minutes to the next lock"/);
  // THE RULES ARE ON THE CARD, in full, and the DNF sentence with them.
  assert.match(h, /1B 3 · 2B 5 · 3B 8 · HR 10 · RBI 2 · R 2 · BB 2 · SB 5/);
  assert.match(h, /IP 2\.25 · K 2 · W 4 · ER -2 · H -0\.6 · BB -0\.6/);
  assert.match(h, /An empty slot at first pitch is a DNF for the day\./);
  assert.match(h, /A player you use is gone for the rest of October\./);
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
  assert.match(h, /<span class="oc-lk">LOCKED<\/span>/);
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

test('A SPENT PLAYER IS DIMMED AND SAYS WHEN, and one on the card says so', () => {
  const h = html({ view: PICKING(), signedIn: true });
  // The mock's own three sub-lines.
  assert.match(h, /<b>A\. Riley<\/b><small>ATL · used Sep 27<\/small>/);
  assert.match(h, /<b>B\. Harper<\/b><small>PHI · on your card<\/small>/);
  assert.match(h, /<b>K\. Schwarber<\/b><small>PHI · DH<\/small>/);
  // Both are DIMMED, never hidden - the reader has to see where October went.
  assert.equal([...h.matchAll(/class="oc-prow gone"/g)].length, 2);
  assert.match(h, /class="oc-prow gone" disabled="" data-player="94"/);
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

  // A refusal repaints it back and names the rule.
  action.setReply({ ok: false, reason: 'used', usedOn: '2026-09-27' });
  await act(async () => { el.querySelector('[data-player="91"]').click(); });
  assert.equal(el.querySelector('[data-slot="bat4"]').dataset.state, 'open');
  assert.match(el.textContent, /You used that player on Sep 27\./);
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
