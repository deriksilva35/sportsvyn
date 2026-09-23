// components/pickem/pickemBoardV2.test.mjs - the v2 board in every state the
// mock draws (docs/design/mocks/pickem-v2.html, fdd4fcc), plus the two rules
// the mock gets wrong or leaves out: no un-pick, and the footer is a counter
// before it is a confirm.
//
// Press-the-button: the real component in jsdom, the real taps, and a stub for
// the three server-action modules that RECORDS every call - so "no save fired"
// is a fact, not an inference.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(__dirname, `__v2_actions_${process.pid}.mjs`);
registerHooks({ resolve(spec, ctx, next) {
  if (/^@\/app\/actions\/(pickem|confirm|handle)$/.test(spec)) return { url: pathToFileURL(STUB).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let createRoot; let act; let PickemBoard; let dom; let tmp;
const roots = new Set();

const HOUR = 3600_000;
const future = (h = 3) => new Date(Date.now() + h * HOUR).toISOString();
const past = (h = 3) => new Date(Date.now() - h * HOUR).toISOString();

/**
 * A KICKOFF ON THE ET CALENDAR DAY `offset` DAYS FROM NOW.
 *
 * The day-group tests below used to carry typed dates - '2026-09-18', '2026-09-20'
 * - which were in the future on the day they were written (2026-09-17) and in the
 * past five days later, at which point "2 still open" became "all locked" and two
 * tests went red for nobody. A fixture that asserts something about OPEN games
 * must be written relative to now or it is a dated cheque.
 *
 * ET, NOT UTC, because the board groups by the reader's calendar day. Any UTC time
 * from 05:00Z to 23:59Z falls on the same calendar date in ET (UTC-4 or -5), so
 * staying inside that band lets a date be built without a timezone library - the
 * same trick, stated, that the CFB test's own comment relied on.
 */
const etDay = (offsetDays, hms = '20:00:00') => {
  const d = new Date(Date.now() + offsetDays * 24 * HOUR);
  return `${d.toISOString().slice(0, 10)}T${hms}.000Z`;
};

/** One board row, in lib/pickem/view.js's own gameRows() shape. */
const game = (o = {}) => ({
  match_id: 1, slug: 'a-at-b', home: 'Bills', away: 'Lions',
  kickoff_at: future(), status: 'scheduled', kicked: false, my_side: null, graded: null,
  spread_home: -4.5, home_rank: null, away_rank: null, home_record: null, away_record: null,
  home_colors: { primary: '#00338D', secondary: '#C60C30' },
  away_colors: { primary: '#0076B6', secondary: '#B0B7BC' },
  home_score: null, away_score: null, period: null, clock: null, network: null,
  ...o,
});

before(async () => {
  writeFileSync(STUB, `
    export const calls = [];
    export const confirms = [];
    export async function savePickAction(...args) { calls.push(args); return { ok: true }; }
    export async function confirmPickemEntry(...args) { confirms.push(args); return { ok: true, confirmedAt: '2026-09-20T12:00:00.000Z' }; }
    export async function checkHandle() { return { ok: true, message: 'Available' }; }
    export async function claimHandle() { return { ok: true, handle: 'x' }; }
  `);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/pickem/nfl' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'PickemBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), {
    filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false,
  }).code;
  tmp = path.join(__dirname, `__pickem_v2_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  PickemBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { for (const f of [tmp, STUB]) { try { unlinkSync(f); } catch { /* gone */ } } });

const stub = async () => import(pathToFileURL(STUB).href);

function render(games, extra = {}, sport = 'nfl') {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(PickemBoard, {
    view: { contest: { id: 1, boardNumber: 2, sport, displayWeek: 2, week: 2 }, games },
    signedIn: true, signinHref: '/signin', hasHandle: true, initialConfirmedAt: null,
    locksAt: future(), season: null, ...extra,
  })));
  return c;
}
const sides = (c) => [...c.querySelectorAll('.pkv-side')];
const rowsOf = (c) => [...c.querySelectorAll('.pkv-g')];
const nameOf = (el) => el.querySelector('.pkv-nm b')?.textContent;
const bySide = (c, name) => sides(c).find((s) => nameOf(s) === name);
const click = (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
const lock = (c) => c.querySelector('.pkv-lock');
const note = (c) => c.querySelector('.pkv-note').textContent;

// ---------------------------------------------------------------------------
// THE OPEN BOARD
// ---------------------------------------------------------------------------

test('an untouched board: two tap targets a game, no ticks, step 1 lit', () => {
  const c = render([game(), game({ match_id: 2, home: 'Chiefs', away: 'Colts' })]);
  assert.equal(rowsOf(c).length, 2);
  assert.equal(sides(c).length, 4);
  assert.equal(c.querySelectorAll('.pkv-tick').length, 0);
  assert.equal(c.querySelector('.pkv-stp.on b').textContent, 'Pick');
  assert.match(note(c), /^Pick the winner of every game, straight up\./);
  assert.match(note(c), /Each game locks at its own kickoff\.$/);
});

test('THE FOOTER IS A COUNTER, and it counts only open games', () => {
  const c = render([
    game(),
    game({ match_id: 2, home: 'Chiefs', away: 'Colts' }),
    game({ match_id: 3, home: 'Jets', away: 'Titans' }),
  ]);
  assert.equal(lock(c).textContent, '3 to go');
  assert.equal(lock(c).disabled, true);
  assert.doesNotMatch(c.textContent, /submit/i, 'the word submit appears nowhere');
});

test('a pick paints the side volt and the foot names it', async () => {
  const c = render([game()]);
  await click(bySide(c, 'Bills'));
  assert.match(bySide(c, 'Bills').className, /picked/);
  assert.equal(bySide(c, 'Bills').querySelector('.pkv-tick').textContent, '●');
  assert.equal(c.querySelector('.pkv-pick').textContent, 'Bills');
  assert.equal((await stub()).calls.length, 1);
  assert.deepEqual((await stub()).calls[0], [1, 1, 'home']);
});

test('SWITCHING SIDES SAVES THE NEW SIDE', async () => {
  const c = render([game()]);
  await click(bySide(c, 'Bills'));
  await click(bySide(c, 'Lions'));
  assert.match(bySide(c, 'Lions').className, /picked/);
  assert.doesNotMatch(bySide(c, 'Bills').className, /picked/);
  const { calls } = await stub();
  assert.equal(calls.at(-1)[2], 'away');
});

test('NO UN-PICK: tapping your own side twice keeps it, and fires no second save', async () => {
  // The mock's handler clears on a second tap. The shipped rule is pick or
  // switch, never clear - there is no un-pick path on the server, and a
  // withdrawn pick would be a new scoring state. Ruled (a): NO.
  const c = render([game()]);
  await click(bySide(c, 'Bills'));
  const after = (await stub()).calls.length;
  await click(bySide(c, 'Bills'));
  assert.match(bySide(c, 'Bills').className, /picked/, 'still picked');
  assert.equal(c.querySelector('.pkv-pick').textContent, 'Bills');
  const { calls } = await stub();
  assert.equal(calls.length, after + 1, 'the second tap re-saves the same side');
  assert.equal(calls.at(-1)[2], 'home', 'and it is the SAME side - never a clear');
});

// ---------------------------------------------------------------------------
// LIVE, FINAL, AND KICKED-WITH-NO-PICK
// ---------------------------------------------------------------------------

test('A LIVE GAME wears the red rule, its period and clock, and its score', () => {
  const c = render([game({
    status: 'live', kicked: true, kickoff_at: past(1),
    home_score: 21, away_score: 10, period: 'Q3', clock: '7:28', network: 'FOX',
  })]);
  const row = rowsOf(c)[0];
  assert.match(row.className, /live/);
  assert.equal(row.querySelector('.pkv-l').textContent, 'Q3 7:28');
  assert.equal(row.querySelector('.pkv-net').textContent, 'FOX');
  assert.deepEqual(sides(c).map((s) => s.querySelector('.pkv-sc')?.textContent), ['10', '21']);
  assert.equal(sides(c).every((s) => s.disabled), true, 'a kicked game is not tappable');
});

test('a live game with no clock yet says LIVE and invents nothing', () => {
  const c = render([game({ status: 'live', kicked: true, kickoff_at: past(1), home_score: 0, away_score: 0 })]);
  assert.equal(c.querySelector('.pkv-l').textContent, 'LIVE');
});

test('A FINAL WITH A RIGHT PICK: jade ring, jade tick, jade in the foot', () => {
  const c = render([game({
    status: 'final', kicked: true, kickoff_at: past(4),
    home_score: 31, away_score: 24, my_side: 'home', graded: 'W',
  })]);
  const won = bySide(c, 'Bills');
  assert.match(won.className, /won/);
  assert.equal(won.querySelector('.pkv-tick').textContent, '✓');
  assert.match(c.querySelector('.pkv-pick').className, /\bj\b/);
  assert.equal(c.querySelector('.pkv-pick').textContent, 'Bills ✓');
  assert.equal(c.querySelector('.pkv-big').textContent.startsWith('1-0'), true);
});

test('A FINAL WITH A WRONG PICK: terra ring, terra cross, terra in the foot', () => {
  const c = render([game({
    status: 'final', kicked: true, kickoff_at: past(4),
    home_score: 31, away_score: 24, my_side: 'away', graded: 'L',
  })]);
  const lost = bySide(c, 'Lions');
  assert.match(lost.className, /lost/);
  assert.equal(lost.querySelector('.pkv-tick').textContent, '✗');
  assert.match(c.querySelector('.pkv-pick').className, /\bt\b/);
  assert.equal(c.querySelector('.pkv-big').textContent.startsWith('0-1'), true);
});

test('AN UNPICKED KICKED GAME is greyed, untappable, and out of the counter', () => {
  const c = render([
    game({ match_id: 1, status: 'final', kicked: true, kickoff_at: past(4), home_score: 31, away_score: 24 }),
    game({ match_id: 2, home: 'Chiefs', away: 'Colts' }),
  ]);
  const dead = rowsOf(c)[0];
  assert.match(dead.className, /locked/);
  assert.equal(dead.querySelector('.pkv-pick').textContent, 'no pick');
  assert.equal([...dead.querySelectorAll('.pkv-side')].every((s) => s.disabled), true);
  // ONE open game left, so the counter says one - the kicked row is neither
  // "to go" nor a reason the board cannot be locked in.
  assert.equal(lock(c).textContent, '1 to go');
  assert.match(c.querySelector('.pkv-sub').textContent, /0 of 1 picked/);
  // Its pip is dashed, not filled.
  assert.match([...c.querySelectorAll('.pkv-pip')][0].className, /none/);
});

test('the line shows before kickoff and is gone once it kicks', () => {
  const open = render([game()]);
  assert.ok(open.querySelector('.pkv-line'), 'the line renders pre-kick');
  act(() => { for (const r of roots) r.unmount(); }); roots.clear();
  const live = render([game({ status: 'live', kicked: true, kickoff_at: past(1), home_score: 3, away_score: 0 })]);
  assert.equal(live.querySelector('.pkv-line'), null, 'a pre-kickoff line beside a live score is a number that stopped being true');
});

test('NO BROADCASTER ROW MEANS NO NETWORK ELEMENT - never a dash', () => {
  const c = render([game({ network: null })]);
  assert.equal(c.querySelector('.pkv-net'), null);
  assert.doesNotMatch(c.querySelector('.pkv-gtop').textContent, /-\s*$/);
});

// ---------------------------------------------------------------------------
// THE COUNTER'S ARITHMETIC, AND THE CONFIRM
// ---------------------------------------------------------------------------

const three = () => [
  game({ match_id: 1 }),
  game({ match_id: 2, home: 'Chiefs', away: 'Colts' }),
  game({ match_id: 3, home: 'Jets', away: 'Titans' }),
];

test('3 to go, then 1 to go, then Lock it in', async () => {
  const c = render(three());
  assert.equal(lock(c).textContent, '3 to go');
  await click(bySide(c, 'Bills'));
  await click(bySide(c, 'Chiefs'));
  assert.equal(lock(c).textContent, '1 to go');
  assert.equal(lock(c).disabled, true);
  await click(bySide(c, 'Jets'));
  assert.equal(lock(c).textContent, 'Lock it in');
  assert.equal(lock(c).disabled, false);
  assert.equal(c.querySelector('.pkv-stp.on b').textContent, 'Locked in');
  assert.match(note(c), /nothing is final until the game starts/);
});

test('EVERY ROW KICKED: no button at all, and the header still carries the record', () => {
  const c = render([
    game({ match_id: 1, status: 'final', kicked: true, kickoff_at: past(5), home_score: 31, away_score: 24, my_side: 'home', graded: 'W' }),
    game({ match_id: 2, home: 'Chiefs', away: 'Colts', status: 'final', kicked: true, kickoff_at: past(4), home_score: 10, away_score: 20, my_side: 'home', graded: 'L' }),
  ]);
  assert.equal(lock(c), null, 'nothing left to confirm');
  assert.equal(c.querySelector('.pkv-big').textContent, '1-1 · 0 pending');
});

test('pressing Lock it in confirms, and an edit after it un-confirms', async () => {
  const c = render(three());
  for (const n of ['Bills', 'Chiefs', 'Jets']) await click(bySide(c, n));
  await click(lock(c));
  assert.equal((await stub()).confirms.length, 1);
  assert.equal(lock(c).textContent, 'Locked in');
  assert.equal(lock(c).disabled, true);
  assert.match(c.querySelector('.pkv-pace').textContent, /Locked in/);
  // EDITING AFTER CONFIRMING drops the confirmation - today's behaviour.
  await click(bySide(c, 'Lions'));
  assert.equal(lock(c).textContent, 'Lock it in');
  assert.equal(lock(c).disabled, false);
});

// ---------------------------------------------------------------------------
// THE HEADER, THE DAY GROUPS, AND CFB
// ---------------------------------------------------------------------------

test('the season line renders when there is one, and vanishes when there is not', () => {
  const withIt = render([game()], { season: { correct: 36, played: 38, avg: '.947' } });
  assert.equal(withIt.querySelector('.pkv-rt b').textContent, '.947');
  act(() => { for (const r of roots) r.unmount(); }); roots.clear();
  const without = render([game()]);
  assert.equal(without.querySelector('.pkv-rt'), null, 'no settled board, no season - never an invented .000');
});

test('day groups carry their own open count, and a spent day says so', () => {
  const c = render([
    game({ match_id: 1, kickoff_at: etDay(-3, '20:15:00'), status: 'final', kicked: true, home_score: 31, away_score: 24 }),
    game({ match_id: 2, kickoff_at: etDay(2, '17:00:00'), home: 'Chiefs', away: 'Colts' }),
    game({ match_id: 3, kickoff_at: etDay(2, '20:25:00'), home: 'Jets', away: 'Titans' }),
  ]);
  const heads = [...c.querySelectorAll('.pkv-dh')];
  assert.equal(heads.length, 2, 'two calendar days');
  assert.equal(heads[0].querySelector('span').textContent, 'all locked');
  assert.match(heads[0].className, /locked/);
  assert.equal(heads[1].querySelector('span').textContent, '2 still open');
});

test('A CFB BOARD: 22 games, AP ranks on the rows, 22 pips', () => {
  const games = Array.from({ length: 22 }, (_, i) => game({
    match_id: 100 + i, home: `Home ${i}`, away: `Away ${i}`,
    // TWO ADJACENT DAYS IN ET, not in UTC: 23:30Z is 7:30pm ET the same date, so
    // these land on consecutive ET days. A UTC-midnight split would have put both
    // on the same ET day and tested nothing. Both are in the future, because the
    // footer below asserts all 22 are still to go.
    kickoff_at: i < 3 ? etDay(2, '23:30:00') : etDay(3, '23:30:00'),
    home_rank: i === 0 ? 5 : null, away_rank: i === 0 ? 2 : null,
    home_record: '2-0', away_record: '1-1',
  }));
  const c = render(games, {}, 'cfb');
  assert.equal(rowsOf(c).length, 22);
  assert.equal(c.querySelectorAll('.pkv-pip').length, 22);
  assert.equal(lock(c).textContent, '22 to go');
  // The rank and record live in the small line under the name (ruling c).
  const first = sides(c)[0];
  assert.equal(first.querySelector('.pkv-nm small').textContent, '#2 · 1-1', 'rank and record, in the small line');
  assert.equal([...c.querySelectorAll('.pkv-dh')].length, 2, 'Friday and Saturday');
});

test('signed out: the sides are links to sign in, and no counter is offered', () => {
  const c = render([game()], { signedIn: false });
  assert.equal(sides(c).every((s) => s.tagName === 'A'), true);
  assert.equal(sides(c)[0].getAttribute('href'), '/signin');
  assert.equal(lock(c), null);
  assert.ok(c.querySelector('.pk-signin'), 'the sign-in line is still there');
});
