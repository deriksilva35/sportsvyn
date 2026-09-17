// components/daily/season/seasonBoardV2.test.mjs - the v2.0 board screen, in
// every state it has: the empty panel, a team open, a player held with its
// lit slots, a filled slot cleared, and a complete board with the lock live.
//
// SAME PRESS-THE-BUTTON HARNESS as the other four SeasonBoard tests - jsdom, a
// real React root, and the component compiled through babel because a client
// component cannot be imported by node --test as written.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { install } from '../../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let React; let createRoot; let act; let SeasonBoard; let dom; let tmp;
const roots = new Set();

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K'];
// Twelve teams, each with a full card, so every slot is fillable from several.
const TEAMS = Array.from({ length: 12 }, (_, i) => ({
  key: `T${i}`,
  abbr: `T${i}`,
  card: [
    { position: 'QB', name: `QB ${i}`, points: 300 - i, meta: '4,000 yds · 30 TD' },
    { position: 'RB', name: `RB ${i}`, points: 250 - i, meta: '1,200 yds · 10 TD' },
    { position: 'WR', name: `WR ${i}`, points: 240 - i, meta: '100 rec · 1,400' },
    { position: 'TE', name: `TE ${i}`, points: 200 - i, meta: '80 rec · 850' },
    { position: 'PK', name: `PK ${i}`, points: 140 - i, meta: '30/33 FG · 45 XP' },
    { position: 'RB', name: `RB2 ${i}`, points: 120 - i, meta: '700 yds · 4 TD' },
  ],
}));

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/daily/board' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async () => { throw new Error('no fetch in these states'); };
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'SeasonBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), {
    filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false,
  }).code;
  tmp = path.join(__dirname, `__v2_test_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  SeasonBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { try { unlinkSync(tmp); } catch { /* gone */ } });

/** Render straight onto the BOARD screen, past the rules card. */
function board(props = {}) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(SeasonBoard, {
    edition: 'The Daily · No. 031', year: '2021', teams: TEAMS, slots: SLOTS,
    ranked: true, userId: 1, boardId: 3,
    initialScreen: 'board', initialStartedAt: new Date().toISOString(),
    ...props,
  })));
  return c;
}
const click = (node) => act(() => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
const slots = (c) => [...c.querySelectorAll('.sbd-slot')];
const rows = (c) => [...c.querySelectorAll('.sbd-prow')];
const chips = (c) => [...c.querySelectorAll('.sbd-tc2')];
const noteText = (c) => c.querySelector('.sbd-note').textContent;

// ---------------------------------------------------------------------------
// STATE 1: NOTHING CHOSEN - the empty panel
// ---------------------------------------------------------------------------

test('the empty panel says what to do, and the board is all empty slots', () => {
  const c = board();
  // The <br/> in the mock's empty state yields no whitespace in textContent.
  assert.match(c.querySelector('.sbd-empty').textContent, /tap a team\s*above/);
  assert.equal(c.querySelector('.sbd-panh b').textContent, 'The board');
  assert.equal(slots(c).length, 8);
  assert.equal(slots(c).filter((s) => s.className.includes('filled')).length, 0);
  assert.equal(chips(c).length, 12, 'twelve teams');
  assert.equal(c.querySelectorAll('.sbd-pip2').length, 8);
  assert.equal(c.querySelectorAll('.sbd-pip2.sbd-on').length, 0);
});

test('step 1 is lit and the line is the mock\'s first line', () => {
  const c = board();
  const on = c.querySelector('.sbd-stp.on');
  assert.equal(on.querySelector('b').textContent, 'Team');
  assert.match(noteText(c), /^Fill eight slots from twelve teams, one player each\./);
  assert.match(noteText(c), /Tap a team to see its six\.$/);
});

test('the slots are the RANKED eight, in order, with a TE', () => {
  const c = board();
  assert.deepEqual(slots(c).map((s) => s.querySelector('.sbd-spos').textContent), SLOTS);
});

test('nothing is lit before a player is held', () => {
  assert.equal(slots(board()).filter((s) => s.className.includes('elig')).length, 0);
});

test('the lock is dead until eight are in', () => {
  const c = board();
  const lock = c.querySelector('.sbd-lock');
  assert.equal(lock.disabled, true);
  assert.equal(lock.textContent, 'Lock it in');
});

// ---------------------------------------------------------------------------
// STATE 2: A TEAM IS OPEN
// ---------------------------------------------------------------------------

test('tapping a team fills the panel with its six, and step 2 lights', () => {
  const c = board();
  click(chips(c)[0]);
  assert.equal(rows(c).length, 6);
  assert.equal(c.querySelector('.sbd-panh b').textContent, 'T0');
  assert.equal(c.querySelector('.sbd-stp.on b').textContent, 'Player');
  assert.match(noteText(c), /^Six from the T0\. Dimmed ones fit no slot you have left\. Tap one\.$/);
  assert.equal(c.querySelector('.sbd-tc2.sbd-tcon').textContent.includes('T0'), true);
  assert.equal(c.querySelector('.sbd-empty'), null, 'the empty state is gone');
});

test('OPENING A TEAM SPENDS NOTHING - the old commit-on-open rule is reversed', () => {
  const c = board();
  click(chips(c)[0]);
  click(chips(c)[1]);
  assert.equal(c.querySelector('.sbd-panh b').textContent, 'T1');
  assert.equal(chips(c).filter((t) => t.className.includes('sbd-used')).length, 0);
  assert.equal(c.querySelector('.sbd-sub2').textContent.includes('12 teams left'), true);
});

// ---------------------------------------------------------------------------
// STATE 3: A PLAYER IS HELD
// ---------------------------------------------------------------------------

test('holding a TE lights exactly the TE slot and the FLEX', () => {
  const c = board();
  click(chips(c)[0]);
  const te = rows(c).find((r) => r.querySelector('.sbd-pb').textContent === 'TE');
  click(te);
  const lit = slots(c).map((s, i) => [i, s.className.includes('elig')]).filter(([, l]) => l).map(([i]) => i);
  assert.deepEqual(lit, [5, 6], 'the TE slot and the FLEX, and nothing else');
  assert.equal(c.querySelector('.sbd-stp.on b').textContent, 'Slot');
  assert.match(noteText(c), /^TE 0 fits the lit slots\. Tap one to place him - or tap another player to change your mind\.$/);
  assert.match(c.querySelector('.sbd-panh small').className, /go/);
});

test('holding a WR never lights the TE slot', () => {
  const c = board();
  click(chips(c)[0]);
  click(rows(c).find((r) => r.querySelector('.sbd-pb').textContent === 'WR'));
  const lit = slots(c).map((s, i) => [i, s.className.includes('elig')]).filter(([, l]) => l).map(([i]) => i);
  assert.deepEqual(lit, [3, 4, 6]);
});

test('tapping another player moves the hold rather than placing anyone', () => {
  const c = board();
  click(chips(c)[0]);
  click(rows(c)[0]);                       // the QB
  click(rows(c)[3]);                       // the TE
  assert.equal(rows(c).filter((r) => r.className.includes('sel')).length, 1);
  assert.equal(slots(c).filter((s) => s.className.includes('filled')).length, 0);
});

test('an unfillable player row is dimmed and inert', () => {
  // Fill the only QB slot, then open a team: its QB can go nowhere.
  const c = board();
  click(chips(c)[0]);
  click(rows(c)[0]);
  click(slots(c)[0]);
  click(chips(c)[1]);
  const qbRow = rows(c)[0];
  assert.match(qbRow.className, /gone/);
  assert.equal(qbRow.disabled, true);
});

// ---------------------------------------------------------------------------
// STATE 4: A FILLED BOARD
// ---------------------------------------------------------------------------

/** Fill all eight slots, one team each, taking whatever fits. */
function fillBoard(c) {
  for (let placed = 0; placed < 8; placed += 1) {
    const chip = chips(c).find((t) => !t.disabled && !t.className.includes('sbd-used'));
    click(chip);
    const row = rows(c).find((r) => !r.disabled);
    click(row);
    const slot = slots(c).find((s) => s.className.includes('elig'));
    click(slot);
  }
  return c;
}

test('a filled board: eight picks, eight pips, four teams left, the lock live', () => {
  const c = fillBoard(board());
  assert.equal(slots(c).filter((s) => s.className.includes('filled')).length, 8);
  assert.equal(c.querySelectorAll('.sbd-pip2.sbd-on').length, 8);
  assert.equal(c.querySelector('.sbd-sub2').textContent.includes('8 of 8 slots'), true);
  assert.equal(c.querySelector('.sbd-sub2').textContent.includes('4 teams left'), true);
  assert.equal(c.querySelector('.sbd-lock').disabled, false);
  assert.match(noteText(c), /^All eight in\. Lock it in before the clock runs out, or keep swapping - tap any filled slot to clear it\.$/);
  assert.equal(c.querySelectorAll('.sbd-stp.done').length, 3, 'every step reads done');
});

test('a filled slot carries the LAST NAME, the team and the points - no jersey', () => {
  const c = fillBoard(board());
  const filled = slots(c).find((s) => s.className.includes('filled'));
  assert.ok(filled.querySelector('.sbd-nm').textContent.length > 0);
  assert.ok(filled.querySelector('.sbd-tm').textContent.startsWith('T'));
  assert.match(filled.querySelector('.sbd-pts').textContent, /^\d+\.\d$/);
  assert.equal(filled.querySelector('img'), null, 'no jersey, no image');
});

test('the points total is the sum of what is on the board', () => {
  const c = fillBoard(board());
  const sum = slots(c).filter((s) => s.className.includes('filled'))
    .reduce((a, s) => a + Number(s.querySelector('.sbd-pts').textContent), 0);
  assert.equal(c.querySelector('.sbd-tot b').textContent, sum.toFixed(1));
});

test('TAPPING A FILLED SLOT CLEARS IT AND GIVES THE TEAM BACK', () => {
  const c = fillBoard(board());
  // THE TICK IS THE SPEND, not the dimming: on a full board every chip is
  // disabled, but only the eight that gave a player wear a tick.
  const used = chips(c).filter((t) => t.className.includes('sbd-used')).length;
  assert.equal(used, 8, 'eight teams spent, four merely dead');
  const before = Number(c.querySelector('.sbd-tot b').textContent);
  const filled = slots(c).find((s) => s.className.includes('filled'));
  const points = Number(filled.querySelector('.sbd-pts').textContent);
  click(filled);
  assert.equal(slots(c).filter((s) => s.className.includes('filled')).length, 7);
  assert.equal(chips(c).filter((t) => t.className.includes('sbd-used')).length, used - 1);
  assert.equal(Number(c.querySelector('.sbd-tot b').textContent), Number((before - points).toFixed(1)));
  assert.equal(c.querySelector('.sbd-lock').disabled, true, 'seven is not eight');
});

// ---------------------------------------------------------------------------
// A BOARD FROM BEFORE THE RANKED SHAPE
// ---------------------------------------------------------------------------

test('a LEGACY board renders its own two FLEX slots, not a TE', () => {
  // The whole point of storing the shape: an edition played under the old
  // eight keeps rendering under them.
  const c = board({ slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'] });
  assert.deepEqual(
    slots(c).map((s) => s.querySelector('.sbd-spos').textContent),
    ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'],
  );
  click(chips(c)[0]);
  click(rows(c).find((r) => r.querySelector('.sbd-pb').textContent === 'TE'));
  const lit = slots(c).map((s, i) => [i, s.className.includes('elig')]).filter(([, l]) => l).map(([i]) => i);
  assert.deepEqual(lit, [5, 6], 'both FLEX slots take the tight end');
});
