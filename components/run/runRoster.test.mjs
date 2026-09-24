// components/run/runRoster.test.mjs - frames 1 and 2 of the mock, MOUNTED.
// The setting screen and the live screen are the same component either side
// of the moment every club has started, which is the claim this file tests -
// and until then each slot seals on its own club's first pitch.

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
const ACTION = stubPath('__run_action_stub.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec.endsWith('app/actions/run')) return { url: pathToFileURL(ACTION).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, RunRoster, createRoot, act, dom, action;
const roots = new Set();
before(async () => {
  writeFileSync(ACTION, [
    'export const calls = [];',
    'export let reply = { ok: true };',
    'export function setReply(r) { reply = r; }',
    'export async function saveRunPickAction(c, s, p) { calls.push({ c, s, p }); return reply; }',
    'export async function clearRunPickAction(c, s) { calls.push({ c, s, clear: true }); return reply; }',
  ].join('\n') + '\n');
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/run' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react'); ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  RunRoster = (await import('./RunRoster.js')).default;
  action = await import(pathToFileURL(ACTION).href);
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { try { unlinkSync(ACTION); } catch { /* gone */ } });

const C = (teamId, abbr, seed, bye = false, opponent = null) => ({
  teamId, abbr, name: abbr, seed, bye, opponent, bestOf: 3,
  colors: { primary: '#111111', secondary: '#EEEEEE' }, alive: bye ? null : true, gamesPlayed: 0,
});
const CLUBS = [
  C(1, 'TB', 3, false, 'CHW'), C(2, 'CHW', 6, false, 'TB'),
  C(3, 'NYY', 4, false, 'BOS'), C(4, 'BOS', 5, false, 'NYY'),
  C(7, 'ATL', 3, false, 'PHI'), C(8, 'PHI', 6, false, 'ATL'),
  C(5, 'TEX', 1, true), C(6, 'CLE', 2, true), C(11, 'MIL', 1, true), C(12, 'LAD', 2, true),
];
const POOL = { byClub: { 1: [
  { playerId: '90', short: 'S. McClanahan', kind: 'arm', team: 'TB', teamId: 1, position: 'SP', ppg: 17.9, g1: true },
  { playerId: '91', short: 'Y. Díaz', kind: 'bat', team: 'TB', teamId: 1, position: '1B', ppg: 7.6 },
  { playerId: '92', short: 'J. Caminero', kind: 'bat', team: 'TB', teamId: 1, position: '3B', ppg: 7.9 },
  { playerId: '93', short: 'B. Lowe', kind: 'bat', team: 'TB', teamId: 1, position: '2B', ppg: 6.8 },
  { playerId: '94', short: 'R. Arozarena', kind: 'bat', team: 'TB', teamId: 1, position: 'LF', ppg: 6.1 },
] } };
const RULES = { bats: '1B 3 · 2B 5 · 3B 8 · HR 10 · RBI 2 · R 2 · BB 2 · SB 5',
  arms: 'IP 2.25 · K 2 · W 4 · ER -2 · H -0.6 · BB -0.6' };
const PIPS = [
  { round: 'wild_card', label: 'Wild Card', state: 'on' },
  { round: 'division', label: 'Division', state: 'ahead' },
  { round: 'championship', label: 'LCS', state: 'ahead' },
  { round: 'world_series', label: 'World Series', state: 'ahead' },
];
const slot = (s, o = {}) => ({ slot: s, state: 'pending', points: null, games: 0, line: null, name: null, team: null, ...o });

/** Frame 1: seven of nine set, before the lock. */
const SETTING = () => ({
  phase: 'open',
  contest: { id: 5, season: 2026, week: 1, round: 'wild_card', label: 'Wild Card',
    settled: false, rules: RULES, rosterSize: 9 },
  nextLock: { matchId: '3', label: 'MIL @ PHI', kickoffAt: '2026-09-29T22:05:00Z', msAway: 19 * 3600000 + 40 * 60000 },
  pips: PIPS,
  clubs: CLUBS,
  slots: [
    slot('arm1', { playerId: '50', name: 'Skubal', teamId: 1, team: 'DET' }),
    slot('arm2', { playerId: '51', name: 'Sale', teamId: 7, team: 'ATL' }),
    slot('bat1', { playerId: '91', name: 'Díaz', teamId: 1, team: 'TB' }),
    slot('bat2', { playerId: '92', name: 'Caminero', teamId: 1, team: 'TB' }),
    slot('bat3', { playerId: '60', name: 'Judge', teamId: 3, team: 'NYY' }),
    slot('bat4', { playerId: '61', name: 'Acuña', teamId: 7, team: 'ATL' }),
    slot('bat5', { playerId: '62', name: 'Olson', teamId: 7, team: 'ATL' }),
    slot('bat6'), slot('bat7'),
  ],
  progress: { filled: 7, total: 9, toGo: 2, locked: false, arms: 2, bats: 5 },
  rosterState: 'open', isDnf: false, total: 0, aliveCount: 7, outCount: 0,
  used: { 70: 'wild_card' }, pool: POOL, score: null,
});

const html = (props) => renderToStaticMarkup(React.createElement(RunRoster, props));

test("FRAME 1 - SETTING: nine slots, four labelled round pips, the mock's counts", () => {
  const h = html({ view: SETTING(), signedIn: true, leagueLine: 'Silva Family League · 8 of 10 set' });
  assert.match(h, /<span class="rn-eb">The Run<\/span>/);
  assert.match(h, /Silva Family League · 8 of 10 set/);
  // NINE SLOTS, two arms then seven bats - a 3x3 field, not a lineup card.
  const slots = [...h.matchAll(/data-slot="(\w+)" data-state="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(slots, ['arm1', 'arm2', 'bat1', 'bat2', 'bat3', 'bat4', 'bat5', 'bat6', 'bat7']);
  assert.equal([...h.matchAll(/class="rn-slot p/g)].length, 2, 'two arms');
  assert.equal([...h.matchAll(/class="rn-slot b/g)].length, 7, 'seven bats');
  // FOUR PIPS, LABELLED, current one volt.
  assert.deepEqual([...h.matchAll(/class="rn-rd (\w+)" data-round="(\w+)"/g)].map((m) => [m[2], m[1]]),
    [['wild_card', 'on'], ['division', 'ahead'], ['championship', 'ahead'], ['world_series', 'ahead']]);
  assert.match(h, /<b>Wild Card<\/b>/);
  assert.match(h, /<b>LCS<\/b>/, 'the pip says LCS, not Championship Series');
  assert.match(h, /<b>7<\/b><span>of 9<\/span>/);
  assert.match(h, /2 arms · 7 bats · 3 max per club/);
  assert.match(h, /6 clubs in this round/);
  assert.match(h, /2 to go/);
});

test('THE CLUB GRID: byes dimmed and labelled, a volt count where you have spent', () => {
  const h = html({ view: SETTING(), signedIn: true });
  const clubs = [...h.matchAll(/data-club="(\w+)" data-bye="([01])"/g)].map((m) => [m[1], m[2]]);
  assert.equal(clubs.length, 10);
  // A BYE CLUB IS VISIBLE AND UNPICKABLE - "The 1 and 2 seeds sit this round
  // out" - not hidden, because the reader has to see who is waiting.
  assert.equal(clubs.filter(([, b]) => b === '1').length, 4);
  assert.match(h, /class="rn-tc bye"[^>]*disabled/);
  // THE PER-CLUB COUNT is the volt corner number: three from ATL, two from TB.
  const counts = [...h.matchAll(/<span class="rn-cnt">(\d)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(counts.sort(), ['1', '3', '3']);
  assert.match(h, /3 max per club/);
});

test('A SPENT PLAYER SAYS WHICH ROUND, and one on the nine says so', () => {
  const v = SETTING();
  v.used = { 94: 'wild_card' };
  const h = html({ view: v, signedIn: true });
  assert.match(h, /<b>Y\. Díaz<\/b><small>on your nine<\/small>/);
  assert.match(h, /<b>R\. Arozarena<\/b><small>used in the Wild Card<\/small>/);
  // THE G1 STARTER IS FLAGGED, and the arm is offered first.
  assert.match(h, /<b>S\. McClanahan<\/b><small>G1 starter<\/small>/);
  assert.equal([...h.matchAll(/data-player="(\d+)"/g)].map((m) => m[1])[0], '90');
  // All three dimmed, none hidden: two are on the nine (Díaz, Caminero) and
  // one is burned (Arozarena).
  assert.equal([...h.matchAll(/class="rn-prow gone"/g)].length, 3);
});

test('FRAME 2 - LIVE: a swept club is marked OUT and KEEPS its points', () => {
  const v = SETTING();
  v.phase = 'live';
  v.progress = { ...v.progress, locked: true, filled: 9, toGo: 0 };
  v.total = 94.5; v.aliveCount = 7; v.outCount = 2;
  v.slots = [
    slot('arm1', { playerId: '50', name: 'Skubal', team: 'DET', state: 'live', points: 22.8, games: 1, line: '7.0 IP · 11 K · 1 ER · W' }),
    slot('arm2', { playerId: '51', name: 'Sale', team: 'ATL', state: 'live', points: 14.3, games: 1 }),
    slot('bat1', { playerId: '91', name: 'Díaz', team: 'TB', state: 'live', points: 13, games: 2, line: '3-7 · 2B · 2 RBI' }),
    slot('bat2', { playerId: '92', name: 'Caminero', team: 'TB', state: 'live', points: 9, games: 2 }),
    slot('bat3', { playerId: '60', name: 'Judge', team: 'NYY', state: 'out', points: 7, games: 2, line: '2-7 · 1 RBI' }),
    slot('bat4', { playerId: '61', name: 'Acuña', team: 'ATL', state: 'live', points: 16.5, games: 2 }),
    slot('bat5', { playerId: '62', name: 'Olson', team: 'ATL', state: 'live', points: 5, games: 2 }),
    slot('bat6', { playerId: '93', name: 'B. Lowe', team: 'TB', state: 'live', points: 4, games: 2 }),
    slot('bat7', { playerId: '80', name: 'Tatis', team: 'SD', state: 'out', points: 2.9, games: 2 }),
  ];
  const h = html({ view: v, signedIn: true });
  // NOTHING IS ZEROED. Judge is out and keeps 7; Tatis is out and keeps 2.9.
  assert.match(h, /data-slot="bat3" data-state="out"/);
  assert.match(h, /<span class="rn-pts out">7<\/span>/);
  assert.match(h, /<span class="rn-pts out">2\.9<\/span>/);
  assert.equal([...h.matchAll(/data-state="out"/g)].length, 2);
  assert.match(h, /<b>94\.5<\/b><span>Round<\/span>/);
  assert.match(h, /7 alive · 2 done/);
  // LOCKED IS A RECEIPT, not a button, and the club grid is gone.
  assert.match(h, /✓ LOCKED · 9 OF 9/);
  assert.doesNotMatch(h, /data-club=/);
  assert.doesNotMatch(h, /to go<\/button>/);
});

test('A DNF ROUND SAYS DNF ON THE CARD', () => {
  const v = SETTING();
  v.phase = 'live'; v.isDnf = true; v.rosterState = 'dnf';
  const h = html({ view: v, signedIn: true });
  assert.match(h, /This round is a <b>DNF<\/b>/);
  assert.match(h, /no slot was filled/);
});

test('SIGNED OUT IS READ-ONLY, and the rules are on the card', () => {
  const h = html({ view: SETTING(), signedIn: false, signinHref: '/signin?next=x' });
  assert.match(h, /<a class="rn-lock" href="\/signin\?next=x">Sign in to play<\/a>/);
  assert.equal([...h.matchAll(/<button[^>]*class="rn-prow[^"]*"[^>]*disabled/g)].length, 5);
  // The scoring table and the DNF sentence, printed.
  assert.match(h, /1B 3 · 2B 5 · 3B 8 · HR 10 · RBI 2 · R 2 · BB 2 · SB 5/);
  assert.match(h, /Each player locks when his club&#x27;s first game starts\. A slot still\s+empty when the round ends is a DNF\./);
  assert.match(h, /Anyone you use is gone for the rest of October\./);
  assert.match(h, /The 1 and 2 seeds sit this round out\./);
});

test("THE SERVER'S ANSWER WINS: a refused pick is repainted with its reason", async () => {
  const el = document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  action.calls.length = 0; action.setReply({ ok: true });
  await act(async () => { root.render(React.createElement(RunRoster, { view: SETTING(), signedIn: true })); });

  // A tap fills the first open slot of that player's kind - bat6.
  await act(async () => { el.querySelector('[data-player="93"]').click(); });
  assert.equal(action.calls.at(-1).s, 'bat6');
  assert.equal(el.querySelector('[data-slot="bat6"]').dataset.state, 'filled');

  // A refusal repaints it back and names the rule.
  action.setReply({ ok: false, reason: 'max_per_club' });
  await act(async () => { el.querySelector('[data-player="94"]').click(); });
  assert.equal(el.querySelector('[data-slot="bat7"]').dataset.state, 'open');
  assert.match(el.textContent, /Three from one club is the limit\./);

  // And a burned player names the round it went in.
  action.setReply({ ok: false, reason: 'used', usedIn: 'division' });
  await act(async () => { el.querySelector('[data-player="94"]').click(); });
  assert.match(el.textContent, /You used that player in the Division round\./);
});

// --- STARTERS ONLY ---------------------------------------------------------

test('STARTERS: a panel row carries its batting order; the G1 arm keeps its flag', () => {
  const v = SETTING();
  v.clubs = v.clubs.map((c) => (c.teamId === 1 ? { ...c, lineupPosted: true } : c));
  v.pool = { byClub: { 1: [
    { playerId: '90', short: 'S. McClanahan', kind: 'arm', team: 'TB', teamId: 1, position: 'SP', ppg: 17.9, g1: true, order: null },
    { playerId: '94', short: 'R. Arozarena', kind: 'bat', team: 'TB', teamId: 1, position: 'LF', ppg: 6.1, order: 2 },
    { playerId: '93', short: 'B. Lowe', kind: 'bat', team: 'TB', teamId: 1, position: '2B', ppg: 6.8, order: 12 },
  ] } };
  const h = html({ view: v, signedIn: true });
  assert.match(h, /S\. McClanahan<\/b><small>G1 starter<\/small>/);
  assert.match(h, /R\. Arozarena<\/b><small>bats 2nd<\/small>/);
  assert.match(h, /B\. Lowe<\/b><small>bats 12th<\/small>/);
  assert.match(h, /lineup posted/);
  // AND THE OPPONENT LINE SURVIVED THE ADDITION. It is the mock's own, and a
  // third line in that corner is not a reason to drop the second.
  assert.match(h, /vs CHW · best of 3/);
  // AND A PREVIEW ROUND IS NOT A SERIES. bestOf is null on a preview club and
  // the served panel read "vs COL · best of null" - a number printed because a
  // template did not ask whether there was one.
  const prev = SETTING();
  prev.clubs = prev.clubs.map((c) => ({ ...c, bestOf: null }));
  const ph = html({ view: prev, signedIn: true });
  assert.match(ph, /vs CHW/);
  assert.doesNotMatch(ph, /best of/);
});

test('STARTERS: before the card is up the panel says so', () => {
  const v = SETTING();
  v.clubs = v.clubs.map((c) => (c.teamId === 1 ? { ...c, lineupPosted: false } : c));
  assert.match(html({ view: v, signedIn: true }), /lineup not posted yet/);
});

test('STARTERS: a bat off the posted card reads "not starting · swap" while the round is open', () => {
  const v = SETTING();
  v.slots = v.slots.map((s) => (s.slot === 'bat1' ? { ...s, notStarting: true } : s));
  const h = html({ view: v, signedIn: true });
  assert.match(h, /<span class="rn-tm swap">not starting · swap<\/span>/);
  assert.equal([...h.matchAll(/class="rn-tm swap"/g)].length, 1);
});

test('STARTERS: a LOCKED round never shows a swap nobody can make', () => {
  // Every club has started, so nothing on the nine can move. A flagged pick
  // must still say nothing.
  const v = SETTING();
  v.phase = 'live';
  v.progress = { ...v.progress, locked: true };
  v.slots = v.slots.map((s) => (s.slot === 'bat1' ? { ...s, notStarting: true } : s));
  assert.doesNotMatch(html({ view: v, signedIn: true }), /not starting · swap/);
});

// --- THE LOCK IS THE CLUB'S (ruling of 24 Sep) -----------------------------

test('THE HEADER COUNTS DOWN TO THE NEXT CLUB LOCK, October-style', () => {
  const h = html({ view: SETTING(), signedIn: true });
  assert.match(h, /next lock<b>MIL @ PHI · 3:05 PM PT<\/b>/);
  assert.match(h, /aria-label="19 hours 40 minutes to the next lock"/);
  assert.doesNotMatch(h, /round locks/);
});

test('A STARTED CLUB SEALS ITS OWN SLOTS AND NOTHING ELSE - no LOCKED until every club has', async () => {
  const v = SETTING();
  // TB is under way. Its two bats are sealed; everything else still moves.
  v.clubs = v.clubs.map((c) => (c.teamId === 1 ? { ...c, started: true } : c));
  v.slots = v.slots.map((s) => (s.teamId === 1 ? { ...s, locked: true } : s));
  const h = html({ view: v, signedIn: true });
  assert.equal(v.phase, 'open');
  // bat1, bat2 (TB) and arm1 (a TB-filed arm) wear the badge; the rest do not.
  assert.equal([...h.matchAll(/<b>LOCKED<\/b>/g)].length, 3);
  assert.doesNotMatch(h, /aria-label="Clear bat1"/);
  assert.match(h, /aria-label="Clear bat3"/, 'Judge is NYY, still ahead - he clears');
  // The footer is a count while a club is ahead, never the LOCKED receipt.
  assert.doesNotMatch(h, /✓ LOCKED/);
  assert.match(h, /2 to go<\/button>/);
  // The grid says the club has started, and the card opens on a club still
  // ahead rather than on one nobody may pick from.
  assert.match(h, /data-club="TB" data-bye="0" data-started="1"/);
  assert.match(h, />started<\/small>/);
  assert.match(h, /class="rn-tc on" data-club="CHW"/);
  // Opened anyway, its panel is out of the pool and says why.
  const el = document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  await act(async () => { root.render(React.createElement(RunRoster, { view: v, signedIn: true })); });
  await act(async () => { el.querySelector('[data-club="TB"]').click(); });
  assert.match(el.innerHTML, /B\. Lowe<\/b><small>game started<\/small>/);
  assert.ok(el.querySelector('[data-player="93"]').disabled);
});

test('A FULL NINE WITH CLUBS STILL AHEAD SAYS SET, not LOCKED', () => {
  const v = SETTING();
  v.slots = v.slots.map((s) => (s.playerId ? s : { ...s, playerId: `x${s.slot}`, name: 'X', teamId: 3, team: 'NYY' }));
  const h = html({ view: v, signedIn: true });
  assert.match(h, /✓ SET · 9 OF 9/);
  assert.doesNotMatch(h, /✓ LOCKED/);
});

test('A REFUSED STARTED CLUB IS NAMED', async () => {
  const el = document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  action.setReply({ ok: false, reason: 'game_started' });
  await act(async () => { root.render(React.createElement(RunRoster, { view: SETTING(), signedIn: true })); });
  await act(async () => { el.querySelector('[data-player="93"]').click(); });
  assert.match(el.textContent, /That club has started this round - it is locked\./);
});

// --- THE PANEL: every row, scrolling (hotfix 24 Sep) -----------------------
//
// The served Yankees panel was twelve arms and no bat: the component cut the
// list at ten and the panel was overflow: hidden.

const NYY_ARMS = ['Schlittler', 'Cole', 'Fried', 'Rodon', 'Warren', 'Rodriguez', 'Gil', 'Schmidt',
  'Stroman', 'Cortes', 'Montas', 'Severino'].map((n, i) => ({
  playerId: `a${i}`, short: n, kind: 'arm', team: 'NYY', teamId: 3, position: 'SP', ppg: 20 - i, probable: i === 0,
}));
const NYY_BATS = ['Judge', 'Soto', 'Bellinger', 'Chisholm', 'Rice', 'Volpe', 'Wells', 'Dominguez', 'Grisham']
  .map((n, i) => ({ playerId: `b${i}`, short: n, kind: 'bat', team: 'NYY', teamId: 3, position: 'OF', ppg: 12 - i, order: i + 1 }));

test('EVERY POSTED BAT IS IN THE RENDERED PANEL, however many arms come first', async () => {
  const v = SETTING();
  v.clubs = v.clubs.map((c) => (c.teamId === 3 ? { ...c, lineupPosted: true } : c));
  v.pool = { byClub: { 3: [...NYY_ARMS, ...NYY_BATS] } };
  const el = document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  await act(async () => { root.render(React.createElement(RunRoster, { view: v, signedIn: true })); });
  await act(async () => { el.querySelector('[data-club="NYY"]').click(); });
  const panel = el.querySelector('.rn-pan-b');
  for (const b of NYY_BATS) assert.ok(panel.querySelector(`[data-player="${b.playerId}"]`), `${b.short} is in the panel`);
  assert.equal(panel.querySelectorAll('[data-kind="bat"]').length, 9);
  assert.equal(panel.querySelectorAll('[data-kind="arm"]').length, 12);
  // Today's probable leads, and says so.
  assert.equal(panel.querySelector('[data-player]').dataset.probable, '1');
  assert.match(panel.innerHTML, /Schlittler<\/b><small>today's starter<\/small>/);
  assert.match(panel.innerHTML, /Judge<\/b><small>bats 1st<\/small>/);
  // THE HEADER COUNTS, beside the line that was already there.
  const head = el.querySelector('.rn-pan-h').textContent;
  assert.match(head, /arms 12 · bats 9/);
  assert.match(head, /of 3 used/);
  assert.match(head, /lineup posted/);
});

test('THE PANEL SCROLLS - overflow-y auto, max-height to the viewport', () => {
  const css = readFileSync(new URL('../../app/run/run.css', import.meta.url), 'utf8');
  const rule = /\.rn-pan-b \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /overflow-y: auto/);
  assert.match(rule, /max-height: \d+vh/);
  assert.doesNotMatch(rule, /overflow: hidden/);
  assert.doesNotMatch(readFileSync(new URL('./RunRoster.js', import.meta.url), 'utf8'), /players\.slice\(/);
});
