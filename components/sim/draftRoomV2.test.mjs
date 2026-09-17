// components/sim/draftRoomV2.test.mjs - the draft room's v2 chrome, pressed.
//
// THIS COMPONENT HAD NO RENDER TEST AT ALL - fourteen files read its source
// and none of them mounted it, which is exactly the gap that let
// /api/daily/board/run sit dead at every commit it existed for. The states
// below are the ones a reader actually meets: your pick, somebody else's,
// the clock running out, arm-then-confirm, a player whose game has kicked,
// and an untimed practice mock.
//
// SHARED BY BOTH ENTRANCES. The Mock draft and the ranked Draft render this
// same component, so every assertion here is about both.

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
const STUB = path.join(__dirname, `__dvr_sim_${process.pid}.mjs`);
const NAV = path.join(__dirname, `__dvr_nav_${process.pid}.mjs`);
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/app/actions/sim') return { url: pathToFileURL(STUB).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let createRoot; let act; let Room; let dom; let tmp; let stub;
const roots = new Set();

const TEAMS = 12;
const ROUNDS = 8;
const CONFIG = {
  id: 1, user_id: 1, name: 'Weekly Six', teams_count: TEAMS, scoring_format: 'ppr',
  roster_slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 }, pick_timer_seconds: 30, is_preset: true,
};
/** The snake, computed here so the fixture cannot drift from the real one. */
const ORDER = (() => {
  const o = [];
  for (let r = 1; r <= ROUNDS; r++) {
    const row = Array.from({ length: TEAMS }, (_, i) => i);
    if (r % 2 === 0) row.reverse();
    o.push(...row);
  }
  return o;
})();
const pool = (n, pos, name, team, adp) => ({
  ffcPlayerId: String(n), name, position: pos, team, adp, adpHigh: adp - 3, adpLow: adp + 3,
  timesDrafted: 100, stdev: 2, bye: 7, league: 'nfl', rookie: false,
});
const AVAILABLE = [
  pool(1, 'RB', 'Bijan Robinson', 'ATL', 1.4),
  pool(2, 'WR', 'Puka Nacua', 'LAR', 3.8),
  pool(3, 'QB', 'Josh Allen', 'BUF', 19.2),
  pool(4, 'TE', 'George Kittle', 'SF', 28.8),
  pool(5, 'RB', 'Kenneth Walker III', 'KC', 31.0),
];
// A player whose game has kicked: the writer refuses him ('player_kicked_off')
// and the room now says so before the tap.
const WITHHELD = [pool(9, 'WR', 'Amon-Ra St. Brown', 'DET', 14.1)];
const PICK = (overall, round, seatIdx, name, pos) => ({
  overallPick: overall, round, rosterSlot: pos, ffcPlayerId: `p${overall}`, position: pos,
  playerName: name, slotPos: pos, team: 'KC', bye: 7, adpAtPick: overall, pickedBy: 'ai',
  rookie: false, isUser: ORDER[overall - 1] === 0, synthetic: false, isKeeper: false,
});

before(async () => {
  writeFileSync(STUB, `
    export const calls = [];
    export async function makePick(...a) { calls.push(['makePick', ...a]); return { ok: true, picksMade: [], aiPicksMade: 0, nextOverall: null }; }
    export async function timerAutoPick(...a) { calls.push(['timerAutoPick', ...a]); return { ok: true, picksMade: [], aiPicksMade: 0, nextOverall: null }; }
    export async function setAutoDraft(...a) { calls.push(['setAutoDraft', ...a]); return { ok: true }; }
    export async function fetchPlayerStats() { return null; }
    export async function fetchPlayerSummaries() { return {}; }
  `);
  writeFileSync(NAV, `
    export const pushes = [];
    export function useRouter() { return { push: (h) => pushes.push(h), replace: () => {}, refresh: () => {} }; }
    export function useSearchParams() { return new URLSearchParams(); }
    export function usePathname() { return '/sim/draft/1'; }
  `);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/sim/draft/1' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  stub = await import(pathToFileURL(STUB).href);
  const src = path.join(__dirname, 'DraftRoom.js');
  const out = transformSync(readFileSync(src, 'utf8'), {
    filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false,
  }).code;
  tmp = path.join(__dirname, `__dvr_room_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  Room = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); stub.calls.length = 0;
});
after(() => { for (const f of [tmp, STUB, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

function room(props = {}) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(Room, {
    draftId: 1, config: CONFIG, order: ORDER, userTeamIndex: 0,
    initialPicks: [], initialAvailable: AVAILABLE, timerSeconds: 30, initialAuto: false,
    poolMapping: { configScoring: 'ppr', configTeams: 12, poolScoring: 'ppr', poolTeams: 12, exact: true, snapshotDate: '2026-09-16' },
    withheld: [], minors: [], upcomingKeepers: [], franchise: null,
    ...props,
  })));
  return c;
}
const t = (c, s) => c.querySelector(s)?.textContent ?? null;
const click = (n) => act(() => n.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));

// ---------------------------------------------------------------------------
// THE WHOLE ROOM RENDERS - the guard a source-pin test cannot give you
// ---------------------------------------------------------------------------

test('THE BOARD PAGE RENDERS, WITH ITS GRID AND ITS CELLS', () => {
  // WHY THIS EXISTS. A footer edit on this file once spliced at the first
  // `</div></div>);}` and truncated four local components - TINTED, posClass,
  // BoardGrid, BoardCell, StatStrip. `next build` compiled successfully,
  // because an undefined identifier is a RUNTIME ReferenceError, and the
  // fourteen files that read this component's source all passed. Mounting it
  // is the only thing that catches that, so this asserts the Board page
  // actually produces its grid rather than throwing on render.
  const c = room({ initialPicks: [PICK(1, 1, 0, 'Bijan Robinson', 'RB')] });
  const board = c.querySelector('.pg-board');
  assert.ok(board, 'the Board page is in the pager');
  const cells = board.querySelectorAll('.bcell, .bc, [class*="bcell"]');
  assert.ok(board.textContent.includes('The Board'), 'and it is labelled');
  // 12 seats x 8 rounds of cells, however the grid names them.
  assert.ok(cells.length >= 96 || board.querySelectorAll('div').length >= 96,
    `the grid rendered ${cells.length} cells / ${board.querySelectorAll('div').length} nodes`);
  // The drafted player is on it. The cells carry the SURNAME - the grid is
  // twelve columns wide on a phone - so this asserts what the cell shows.
  assert.match(board.textContent, /Robinson/);
  // And the 96 pick numbers are all there, snaked: row 2 runs 24 down to 13.
  assert.match(board.textContent, /24·23·22·21·20·19·18·17·16·15·14·13/);
});

test('EVERY LOCAL COMPONENT THIS FILE REFERENCES IS DEFINED IN IT', () => {
  // The static half of the same guard: a JSX tag that is neither imported nor
  // defined compiles clean and throws on render.
  const src = readFileSync(new URL('./DraftRoom.js', import.meta.url), 'utf8');
  const imported = new Set([...src.matchAll(/^import\s+([A-Za-z0-9_$]+)|\{([^}]*)\}\s+from/gm)]
    .flatMap((m) => (m[1] ? [m[1]] : (m[2] ?? '').split(',').map((x) => x.trim().split(' ')[0])))
    .filter(Boolean));
  const defined = new Set([...src.matchAll(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]));
  for (const m of src.matchAll(/^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=/gm)) defined.add(m[1]);
  const used = new Set([...src.matchAll(/<([A-Z][A-Za-z0-9_$]*)/g)].map((m) => m[1]));
  const orphans = [...used].filter((t) => !imported.has(t) && !defined.has(t) && t !== 'Fragment');
  assert.deepEqual(orphans, [], `these JSX tags are neither imported nor defined: ${orphans.join(', ')}`);
  // And the four that were truncated are named explicitly, so a future splice
  // has to delete a named assertion rather than pass quietly.
  for (const n of ['BoardGrid', 'BoardCell', 'StatStrip', 'posClass']) {
    assert.ok(defined.has(n), `${n} is defined in this file`);
  }
});

// ---------------------------------------------------------------------------
// YOUR PICK
// ---------------------------------------------------------------------------

test('YOUR PICK: the hero names you, the pick, your seat and your next', () => {
  const c = room();
  assert.equal(t(c, '.dv-lab'), 'On the clock · pick 1.01');
  assert.equal(t(c, '.dv-who b'), 'You');
  assert.ok(c.querySelector('.dv-who b').className.includes('dv-you'));
  // Seat 1 in a 12-team snake picks 1.01 and then 2.12 - 23 picks away.
  assert.match(t(c, '.dv-who small'), /^seat 1 · next pick 2\.12 · 23 picks away$/);
  assert.equal(t(c, '.dv-t b'), '30');
  assert.equal(t(c, '.dv-t span'), 'seconds');
});

test('THE CLOCK SAYS IT IS ADVISORY, because it is', () => {
  const c = room();
  assert.equal(t(c, '.dv-sub'), 'advisory · auto-picks at 0');
  assert.ok(c.querySelector('.dv-drain'), 'and the drain bar is there while there is a clock');
  assert.equal(c.querySelector('.dv-drain i').style.width, '100%');
});

test('THE SEAT STRIP: twelve seats, yours marked, every other one "auto"', () => {
  const c = room();
  const seats = [...c.querySelectorAll('.dv-seat')];
  assert.equal(seats.length, 12);
  assert.equal(seats[0].querySelector('small').textContent, 'you');
  assert.ok(seats[0].className.includes('you'));
  assert.ok(seats[0].className.includes('on'), 'and it is on the clock at 1.01');
  for (const s of seats.slice(1)) assert.equal(s.querySelector('small').textContent, 'auto');
  // NO HOUSE MARKS IN THE ROOM.
  assert.doesNotMatch(c.textContent, /HOUSE|The Chalk|The Fade|The Gut|The Homer/);
});

test('THE SNAKE LINE names this round and where the next one comes from', () => {
  const c = room();
  const line = [...c.querySelectorAll('.dv-snake span')].map((s) => s.textContent);
  assert.deepEqual(line, ['ROUND 1 →', '← ROUND 2 COMES BACK']);
});

// ---------------------------------------------------------------------------
// SOMEBODY ELSE'S PICK
// ---------------------------------------------------------------------------

test('NOT YOUR PICK: the hero names the seat, and no clock runs for you', () => {
  // Seat 1 has picked; 1.02 belongs to seat 2.
  const c = room({ initialPicks: [PICK(1, 1, 0, 'Bijan Robinson', 'RB')] });
  assert.equal(t(c, '.dv-lab'), 'On the clock · pick 1.02');
  assert.equal(t(c, '.dv-who b'), 'Seat 2');
  assert.equal(c.querySelector('.dv-who b').className, '');
  assert.match(t(c, '.dv-who small'), /^auto seat · you pick again at 2\.12$/);
  const seats = [...c.querySelectorAll('.dv-seat')];
  assert.ok(seats[0].className.includes('done'), 'your seat has picked');
  assert.ok(seats[1].className.includes('on'));
});

test('THE TICKER carries the last picks and then the cell on the clock', () => {
  const c = room({ initialPicks: [PICK(1, 1, 0, 'Bijan Robinson', 'RB'), PICK(2, 1, 1, 'Puka Nacua', 'WR')] });
  const cells = [...c.querySelectorAll('.dv-tk')].map((x) => ({
    head: x.querySelector('small').textContent, name: x.querySelector('b').textContent,
  }));
  assert.equal(cells.length, 3, 'two made plus the one on the clock');
  assert.equal(cells[0].head, '1.01 · YOU');
  assert.equal(cells[0].name, 'Bijan Robinson');
  assert.equal(cells[1].head, '1.02 · seat 2');
  assert.match(cells[2].head, /^1\.03 · seat 3$/);
  assert.match(cells[2].name, /·/, 'the live cell is an ellipsis, not a name');
});

// ---------------------------------------------------------------------------
// ARM, THEN CONFIRM
// ---------------------------------------------------------------------------

test('ARM THEN CONFIRM: the first tap arms, the second commits', () => {
  const c = room();
  const draftBtn = [...c.querySelectorAll('button.draft')][0];
  assert.ok(draftBtn, 'a draft button on the first row');
  click(draftBtn);
  assert.equal(stub.calls.length, 0, 'ARMING WRITES NOTHING');
  assert.ok(c.querySelector('.p-row.armed'), 'the row is armed');
  const confirm = c.querySelector('button.confirm');
  assert.ok(confirm, 'and now offers Confirm');
  click(confirm);
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0][0], 'makePick');
  assert.equal(stub.calls[0][1], 1, 'the draft id');
});

test('THE FOOTER ARMS THE BEST AVAILABLE, and then confirms that one', () => {
  const c = room();
  assert.equal(t(c, '.dv-btn'), 'Best available');
  click(c.querySelector('.dv-btn'));
  assert.equal(stub.calls.length, 0, 'still two taps to commit');
  // Bijan is the top ADP row, so that is who is armed and who the button names.
  assert.equal(t(c, '.dv-btn'), 'Draft Bijan Robinson');
  click(c.querySelector('.dv-btn'));
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0][0], 'makePick');
});

test('NO STAR AND NO QUEUE anywhere in the room', () => {
  const c = room();
  assert.doesNotMatch(c.innerHTML, /☆|★/);
  assert.doesNotMatch(c.textContent, /queue/i);
});

// ---------------------------------------------------------------------------
// A KICKED PLAYER
// ---------------------------------------------------------------------------

test('A KICKED PLAYER IS ON THE BOARD, GREYED, AND HAS NO BUTTON', () => {
  const c = room({ withheld: WITHHELD });
  const rows = [...c.querySelectorAll('.p-item')];
  const gone = rows.find((r) => r.textContent.includes('Amon-Ra St. Brown'));
  assert.ok(gone, 'he is listed - the room used to drop him and let the server refuse');
  assert.ok(gone.className.includes('dv-gone'));
  assert.equal(gone.querySelector('button.draft'), null, 'and offers nothing to press');
  assert.equal(t(gone, '.dv-out'), 'out of the pool');
  // The label counts him separately from what can be taken.
  assert.match(t(c, '.pg-pick .plabel'), /1 out of the pool/);
});

test('THE POOL LABEL NAMES THE SNAPSHOT AND THE REAL COUNT', () => {
  const c = room();
  assert.match(t(c, '.pg-pick .plabel'), /^ADP · FFC snapshot 2026-09-16 · 5$/);
  // NO "Wk" POINTS COLUMN: a week's points do not exist while you draft it.
  assert.doesNotMatch(c.textContent, /\bWk \d/);
});

// ---------------------------------------------------------------------------
// THE CLOCK RUNNING OUT
// ---------------------------------------------------------------------------

test('EXPIRY ASKS THE SERVER TO AUTO-PICK, exactly once', async () => {
  const c = room({ timerSeconds: 1 });
  assert.equal(t(c, '.dv-t b'), '1');
  // One tick takes it to 0, and the effect fires timerAutoPick.
  await act(async () => { await new Promise((r) => setTimeout(r, 1300)); });
  const fired = stub.calls.filter((x) => x[0] === 'timerAutoPick');
  assert.equal(fired.length, 1, 'once per turn, never twice');
  assert.equal(fired[0][1], 1, 'for this draft');
});

// ---------------------------------------------------------------------------
// AN UNTIMED PRACTICE MOCK
// ---------------------------------------------------------------------------

test('UNTIMED: the hero reads "no clock" and there is no drain bar', () => {
  const c = room({ timerSeconds: null });
  assert.equal(t(c, '.dv-t b'), 'no');
  assert.equal(t(c, '.dv-t span'), 'clock');
  assert.equal(c.querySelector('.dv-drain'), null);
  assert.equal(t(c, '.dv-sub'), 'untimed · take as long as you like');
  assert.match(t(c, '.dv-pace'), /Snake · no clock/);
  assert.match(t(c, '.dv-pace'), /Take as long as you like/);
});

// ---------------------------------------------------------------------------
// THE RAIL
// ---------------------------------------------------------------------------

test('YOUR EIGHT IS A RAIL of one cell per round, with round labels', () => {
  const c = room({ initialPicks: [PICK(1, 1, 0, 'Bijan Robinson', 'RB')] });
  const cells = [...c.querySelectorAll('.dv-e')];
  assert.equal(cells.length, 8, 'one per round, whatever the round count');
  assert.deepEqual(cells.map((x) => x.querySelector('.dv-r').textContent),
    ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
  assert.ok(cells[0].className.includes('f'), 'the filled one is solid');
  assert.equal(cells[0].querySelector('b').textContent, 'Bijan Robinson');
  assert.equal(cells[1].querySelector('b'), null, 'and an empty round holds only its label');
});
