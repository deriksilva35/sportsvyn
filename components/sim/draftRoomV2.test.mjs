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
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = stubPath(`__dvr_sim_${process.pid}.mjs`);
const NAV = stubPath(`__dvr_nav_${process.pid}.mjs`);
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
  tmp = stubPath(`__dvr_room_${process.pid}.mjs`);
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

test('THE CLOCK IS THE SERVER DEADLINE, and the label no longer calls it advisory (ruling D6)', () => {
  const c = room();
  assert.equal(t(c, '.dv-sub'), 'auto-picks at 0 · runs while you are away');
  assert.doesNotMatch(t(c, '.dv-sub'), /advisory/);
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

// ---------------------------------------------------------------------------
// THE CLOCK HYDRATES: the first paint is computed from the server's render time
// ---------------------------------------------------------------------------

test('THE FIRST CLOCK IS THE SERVER\'S: renderedAt, not each side\'s own now', async () => {
  // The deadline is 20 s after the render stamp, both long past in real time.
  // Computed from the real clock the server would print 0 and the browser 0 a
  // second later, or 32 and 31 - the mismatch. From renderedAt both print 20.
  const { renderToString } = await import('react-dom/server');
  const renderedAt = '2026-09-16T18:00:00.000Z';
  const turnDeadlineAt = '2026-09-16T18:00:20.000Z';
  const props = {
    draftId: 1, config: CONFIG, order: ORDER, userTeamIndex: 0,
    initialPicks: [], initialAvailable: AVAILABLE, timerSeconds: 30, initialAuto: false,
    poolMapping: { configScoring: 'ppr', configTeams: 12, poolScoring: 'ppr', poolTeams: 12, exact: true, snapshotDate: '2026-09-16' },
    withheld: [], minors: [], upcomingKeepers: [], franchise: null, turnDeadlineAt, renderedAt,
  };
  const a = renderToString(React.createElement(Room, props));
  const b = renderToString(React.createElement(Room, props));
  assert.match(a, /<b class="n">20<\/b><span>seconds<\/span>/, 'the server prints the remainder at render time');
  assert.equal(a.match(/<b class="n[^"]*">[^<]*<\/b>/)[0], b.match(/<b class="n[^"]*">[^<]*<\/b>/)[0],
    'two renders of the same props print the same clock, whenever they run');
  // MOUNTED, the real clock takes over. A live deadline 12 s out, stamped by a
  // render ten minutes ago: the first paint is the render's (capped at the 30 s
  // timer), and one task later the room reads the real remainder.
  const live = new Date(Date.now() + 12_000).toISOString();
  const old = new Date(Date.now() - 600_000).toISOString();
  const c = room({ turnDeadlineAt: live, renderedAt: old });
  assert.equal(t(c, 'b.n, b.n.dv-hot'), '30', 'the first paint is the server render\'s');
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const after = Number(t(c, 'b.n, b.n.dv-hot'));
  assert.ok(after >= 10 && after <= 12, `after hydration the room reads the real clock (got ${after})`);
});

// ---------------------------------------------------------------------------
// ONE SCROLL (thu-7, arcade): the pager's pages are sections of the page's own
// scroll, the tabs swap them, each tab keeps its scroll, the sticky stack
// starts under the web's sticky header, AUTO lives in the clock bar and the
// class / team / sort rows fold into one row. The CSS half is in
// draftOneScroll.test.mjs; this half is what jsdom CAN see - the DOM and the
// scroll calls. Every action is the stub above: nothing here reaches a draft.
// ---------------------------------------------------------------------------

/** Swap window scroll + rect reads for the length of one test. */
function scrollRig() {
  const w = dom.window;
  const calls = [];
  const saved = { scrollTo: w.scrollTo, scrollBy: w.scrollBy, rect: w.HTMLElement.prototype.getBoundingClientRect };
  let y = 0;
  Object.defineProperty(w, 'scrollY', { configurable: true, get: () => y });
  w.scrollTo = (x, top) => { calls.push(['to', top]); y = top; };
  w.scrollBy = (x, dy) => { calls.push(['by', dy]); y += dy; };
  const rects = new Map(); // className fragment -> {top, bottom, height}
  w.HTMLElement.prototype.getBoundingClientRect = function rect() {
    for (const [k, r] of rects) if (String(this.className).includes(k)) return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, ...r };
    return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 };
  };
  return {
    calls, rects, setY: (v) => { y = v; },
    restore: () => {
      w.scrollTo = saved.scrollTo; w.scrollBy = saved.scrollBy;
      w.HTMLElement.prototype.getBoundingClientRect = saved.rect;
      delete w.scrollY;
    },
  };
}
const seg = (c, label) => [...c.querySelectorAll('.room-seg .rseg')].find((b) => b.textContent === label);

test('ONE SCROLL: the room names the page it shows, PICK first, and a tab swaps it', () => {
  const c = room({ arcade: true });
  const r = c.querySelector('.room');
  assert.equal(r.getAttribute('data-page'), 'PICK', 'PICK is the landing page');
  click(seg(c, 'BOARD'));
  assert.equal(r.getAttribute('data-page'), 'BOARD');
  assert.equal(c.querySelector('.room-seg .rseg.on').textContent, 'BOARD');
  click(seg(c, 'ROSTER'));
  assert.equal(r.getAttribute('data-page'), 'ROSTER');
  // all three sections stay in the DOM - CSS shows the one data-page names
  assert.ok(c.querySelector('.pg-board') && c.querySelector('.pg-pick') && c.querySelector('.pg-roster'));
});

test('ONE SCROLL: each tab keeps its scroll; a new tab opens at its top, under the stack', () => {
  const rig = scrollRig();
  try {
    const c = room({ arcade: true });
    rig.setY(900); // forty rows into PICK
    // ROSTER is unvisited: its top has scrolled 500 px up, the tabs' bottom is at 104.
    rig.rects.set('room-seg', { top: 64, bottom: 104 });
    rig.rects.set('pg-roster', { top: -500 });
    click(seg(c, 'ROSTER'));
    assert.deepEqual(rig.calls.at(-1), ['by', -604], 'the new tab\'s top lands just under the tabs');
    rig.setY(40);
    click(seg(c, 'PICK'));
    assert.deepEqual(rig.calls.at(-1), ['to', 900], 'PICK comes back to the row it was left on');
    // a section already under the stack is left alone
    rig.calls.length = 0;
    rig.rects.set('pg-board', { top: 104 });
    click(seg(c, 'BOARD'));
    assert.equal(rig.calls.length, 0, 'no scroll when the top is already in view');
  } finally { rig.restore(); }
});

test('ONE SCROLL IS ARCADE ONLY: the dark room never touches the window scroll', () => {
  const rig = scrollRig();
  try {
    const c = room();
    rig.setY(900);
    rig.rects.set('room-seg', { bottom: 104 });
    rig.rects.set('pg-roster', { top: -500 });
    click(seg(c, 'ROSTER'));
    assert.equal(rig.calls.length, 0);
    assert.equal(c.querySelector('.dv-auto'), null, 'no AUTO in the clock bar');
    assert.equal(c.querySelector('details.dv-filt'), null, 'no fold');
    assert.ok(c.querySelector('.avail-tools > .avail-sort'), 'the dark page keeps its three rows unfolded');
  } finally { rig.restore(); }
});

test('THE STACK STARTS UNDER THE WEB\'S STICKY HEADER, measured; not in the app', () => {
  const rig = scrollRig();
  const head = document.createElement('header');
  head.className = 'sim-head'; head.style.position = 'sticky';
  document.body.prepend(head);
  try {
    rig.rects.set('sim-head', { height: 57.4 });
    let c = room({ arcade: true });
    assert.equal(c.querySelector('.room').style.getPropertyValue('--dv-stick'), '57px');
    act(() => { for (const r of roots) r.unmount(); }); roots.clear();
    head.style.position = 'static';
    c = room({ arcade: true });
    assert.equal(c.querySelector('.room').style.getPropertyValue('--dv-stick'), '', 'a header that does not stick adds nothing');
    act(() => { for (const r of roots) r.unmount(); }); roots.clear();
    head.style.position = 'sticky';
    document.cookie = 'sv_shell=sim-app; path=/';
    c = room({ arcade: true });
    assert.equal(c.querySelector('.room').style.getPropertyValue('--dv-stick'), '', 'in the app the header is about to go: not measured');
  } finally {
    head.remove(); rig.restore();
    document.cookie = 'sv_shell=; path=/; max-age=0';
  }
});

test('AUTO IN THE CLOCK BAR: tapping it is the room\'s own toggle - confirm on, then setAutoDraft', async () => {
  const w = dom.window;
  const confirmWas = w.confirm;
  let asked = 0;
  w.confirm = () => { asked += 1; return true; };
  try {
    // Somebody else's turn: with AUTO on during the reader's OWN turn the room
    // would drive timerAutoPick, and this stub (which returns no picks) would
    // never let that turn end.
    const c = room({ arcade: true, userTeamIndex: 3 });
    const b = c.querySelector('.dv-clk .dv-auto');
    assert.ok(b, 'the switch is in the clock bar');
    assert.equal(b.getAttribute('aria-pressed'), 'false');
    assert.equal(b.querySelector('b').textContent, 'off');
    await act(async () => { b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
    assert.equal(asked, 1, 'turning it ON asks first, exactly like the room-head switch');
    assert.deepEqual(stub.calls.find((x) => x[0] === 'setAutoDraft'), ['setAutoDraft', 1, true]);
    assert.equal(b.getAttribute('aria-pressed'), 'true');
    assert.equal(b.querySelector('b').textContent, 'on');
    assert.ok(c.querySelector('.room-head .auto-toggle.on'), 'one state: the room-head switch reads on too');
    stub.calls.length = 0;
    await act(async () => { b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
    assert.equal(asked, 1, 'turning it OFF does not ask');
    assert.deepEqual(stub.calls.find((x) => x[0] === 'setAutoDraft'), ['setAutoDraft', 1, false]);
  } finally { w.confirm = confirmWas; }
});

test('THE FILTERS FOLD INTO ONE ROW whose summary names the sort, and counts what is on', () => {
  const c = room({ arcade: true });
  const d = c.querySelector('.avail-tools > details.dv-filt');
  assert.ok(d, 'the fold is in the tools');
  assert.equal(d.open, false, 'closed on a phone');
  assert.equal(d.querySelector('summary').textContent, 'Filters · Sort: ADP');
  for (const sel of ['.avail-class', '.avail-team', '.avail-sort']) assert.ok(d.querySelector(sel), `${sel} is inside the fold`);
  // search and the position chips stay out of it
  assert.ok(c.querySelector('.avail-tools > .avail-search'));
  assert.ok(c.querySelector('.avail-tools > .avail-chips:not(.avail-class)'));
  // the summary is the sort the list is ACTUALLY on: My Team needs no stats
  click([...d.querySelectorAll('.avail-sort button')].find((b) => b.textContent === 'My Team'));
  assert.equal(d.querySelector('summary').textContent, 'Filters · Sort: My Team');
  // a folded filter that narrows the list is counted, so a short list says why
  click(d.querySelector('.ncaa-toggle'));
  assert.match(d.querySelector('summary').textContent, /^Filters \(1\) · Sort: /);
});
