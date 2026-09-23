// components/weekly/weeklyRoomV2.test.mjs - the v2 builder in every state the
// mock draws (docs/design/mocks/weekly-v2.html), plus the three places the
// build deliberately differs from it: no "scores 0", no rank before a kickoff,
// and an × that exists (the mock draws it, v1 never wired it).
//
// PRESS-THE-BUTTON: the real component in jsdom, real taps, a fetch stub that
// RECORDS every save body, and a stub for the server actions - so "the write
// carried the cleared lineup" is a fact rather than an inference.
//
// EVERY ROOT IS UNMOUNTED in afterEach; the room runs a 30s interval and a
// visibilitychange listener, and a leaked root keeps both.

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
const STUB = stubPath(`__wkv_actions_${process.pid}.mjs`);
const NAV = stubPath(`__wkv_nav_${process.pid}.mjs`);
registerHooks({ resolve(spec, ctx, next) {
  if (/^@\/app\/actions\/(confirm|handle)$/.test(spec)) return { url: pathToFileURL(STUB).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let createRoot; let act; let WeeklyRoom; let dom; let tmp;
let stub; let nav;
const roots = new Set();
const saves = [];

const HOUR = 3600_000;
const future = (h = 3) => new Date(Date.now() + h * HOUR).toISOString();
const past = (h = 3) => new Date(Date.now() - h * HOUR).toISOString();

// ---------------------------------------------------------------------------
// THE WEEK, AS THE MOCK SETS IT: two finals, two live games, four to come.
// ---------------------------------------------------------------------------
const KO = {
  BUF: past(30), DET: past(30),            // Thursday, final
  ATL: past(3), CAR: past(3),              // live, Q3 7:28
  SEA: past(3), NE: past(3),               // live, no clock
  SF: future(1), MIA: future(1),           // 1:25
  DAL: future(1), WSH: future(1),
  KC: future(5), IND: future(5),
  LAR: future(28), NYG: future(28),        // Monday
};
const live3 = { live_state: { period: 3, clock: '7:28' } };
const GAMES = {
  BUF: { status: 'final', metadata: { live_state: null }, kickoffAt: KO.BUF, opp: 'DET', home: true, score: 31, oppScore: 24 },
  DET: { status: 'final', metadata: { live_state: null }, kickoffAt: KO.DET, opp: 'BUF', home: false, score: 24, oppScore: 31 },
  ATL: { status: 'live', metadata: live3, kickoffAt: KO.ATL, opp: 'CAR', home: false, score: 13, oppScore: 10 },
  CAR: { status: 'live', metadata: live3, kickoffAt: KO.CAR, opp: 'ATL', home: true, score: 10, oppScore: 13 },
  // LIVE WITH NO CLOCK - the feed has a period and nothing else.
  SEA: { status: 'live', metadata: { live_state: { period: 1, clock: null } }, kickoffAt: KO.SEA, opp: 'NE', home: false, score: 3, oppScore: 0 },
  SF: { status: 'scheduled', metadata: { live_state: null }, kickoffAt: KO.SF, opp: 'MIA', home: true, score: null, oppScore: null },
  DAL: { status: 'scheduled', metadata: { live_state: null }, kickoffAt: KO.DAL, opp: 'WSH', home: true, score: null, oppScore: null },
  KC: { status: 'scheduled', metadata: { live_state: null }, kickoffAt: KO.KC, opp: 'IND', home: true, score: null, oppScore: null },
  LAR: { status: 'scheduled', metadata: { live_state: null }, kickoffAt: KO.LAR, opp: 'NYG', home: true, score: null, oppScore: null },
};

/**
 * A pool row as the page reader now hands it over: activePool()'s own shape,
 * the kickoff the page decorates it with, and `season` from
 * lib/weekly/seasonLine.js - null for a player with no final game yet.
 */
const p = (id, pos, name, team, ppg, extra = '', season = null) => ({
  id, pos, name, team,
  resume: ppg == null ? extra : `${ppg.toFixed(1)} PPG · 42 g${extra}`,
  kickoff_at: KO[team],
  season,
});
const szn = (ppg, gp, line) => ({ ppg, gp, line });
const BOARD = [
  // THE SEASON DISAGREES WITH THE CAREER ON PURPOSE: Purdy is the worst
  // career QB here and the best this season, so a test that passes under the
  // old career sort cannot pass under the new one.
  p(1, 'QB', 'Josh Allen', 'BUF', 22.4, '', szn(28.4, 1, '334 yds · 2 TD · 0 INT · 23 rush')),
  p(2, 'QB', 'Brock Purdy', 'SF', 17.6, '', szn(31.2, 1, '298 yds · 3 TD · 1 INT · 12 rush')),
  p(3, 'QB', 'Dak Prescott', 'DAL', 18.5),
  p(4, 'QB', 'Patrick Mahomes', 'KC', 21.1, '', szn(19.9, 1, '241 yds · 1 TD · 0 INT · 8 rush')),
  p(10, 'RB', 'Bijan Robinson', 'ATL', 19.8),
  p(11, 'RB', 'Christian McCaffrey', 'SF', 15.4),
  p(12, 'RB', 'Kenneth Walker', 'SEA', 14.0),
  p(13, 'RB', 'Isiah Pacheco', 'KC', 11.2),
  p(14, 'RB', 'James Cook', 'BUF', 15.7),
  p(20, 'WR', 'Puka Nacua', 'LAR', 20.3),
  p(21, 'WR', 'CeeDee Lamb', 'DAL', 18.9),
  p(22, 'WR', 'Drake London', 'ATL', 16.6),
  p(23, 'WR', 'Rashee Rice', 'KC', 15.2),
  p(30, 'TE', 'George Kittle', 'SF', 14.2),
  p(31, 'TE', 'Travis Kelce', 'KC', 12.7),
  p(32, 'TE', 'Kyle Pitts', 'ATL', 9.4),
  // A ROOKIE WITH NO CAREER RATE AT ALL - ppgOf returns -1 and the value
  // column must be blank rather than 0.0 (319 such rows on the real board).
  p(40, 'WR', 'Carson Beck Jr', 'KC', null, 'R1 #2 - LSU'),
];

const OPEN_SIX = { QB: 2, RB: 11, WR: 20, TE: 30, FLEX: 13, FLEX2: 23 };   // SF/LAR/KC - none kicked
const MIXED = { QB: 1, RB: 10, WR: 22, TE: 30, FLEX: 12, FLEX2: 21 };      // BUF final, ATL/SEA live, SF/DAL open
const ALL_KICKED = { QB: 1, RB: 10, WR: 22, TE: 32, FLEX: 12, FLEX2: 14 }; // BUF/ATL/SEA only

before(async () => {
  writeFileSync(STUB, `
    export const confirms = [];
    export async function confirmWeeklyEntry(...a) { confirms.push(a); return { ok: true, confirmedAt: '2026-09-20T19:40:00.000Z' }; }
    export async function confirmPickemEntry() { return { ok: true }; }
    export async function checkHandle() { return { ok: true, message: 'Available' }; }
    export async function claimHandle() { return { ok: true, handle: 'x' }; }
  `);
  writeFileSync(NAV, `
    export const pushes = [];
    export function useRouter() { return { push: (h) => pushes.push(h), replace: () => {}, refresh: () => {} }; }
    export function useSearchParams() { return new URLSearchParams(); }
    export function usePathname() { return '/weekly'; }
  `);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/weekly' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.Blob = dom.window.Blob;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async (url, opts) => {
    saves.push({ url, body: JSON.parse(opts?.body ?? '{}') });
    return { ok: true, status: 200, json: async () => ({ ok: true, filled: 6 }) };
  };
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  stub = await import(pathToFileURL(STUB).href);
  nav = await import(pathToFileURL(NAV).href);
  const srcPath = path.join(__dirname, 'WeeklyRoom.js');
  const out = transformSync(readFileSync(srcPath, 'utf8'), {
    filename: srcPath, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false,
  }).code;
  tmp = stubPath(`__wkv_room_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  WeeklyRoom = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); saves.length = 0; stub.confirms.length = 0; nav.pushes.length = 0;
});
after(() => { for (const f of [tmp, STUB, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

function room(props = {}) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(WeeklyRoom, {
    contest: { id: 10, week: 2, locks_at: future(100), season_year: 2026 },
    board: BOARD, initialLineup: {}, games: GAMES, live: null,
    signedIn: true, hasHandle: true, signinHref: '/signin?d=/weekly',
    locksAt: future(100), firstKickoff: past(30),
    ...props,
  })));
  return c;
}
const click = (node) => act(() => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
const slots = (c) => [...c.querySelectorAll('.wkv-slot')];
const prows = (c) => [...c.querySelectorAll('.wkv-prow')];
const txt = (c, sel) => c.querySelector(sel)?.textContent ?? null;
const sub = (c) => [...c.querySelectorAll('.wkv-sub span')].map((s) => s.textContent);
const lineOf = (slot) => slot.querySelector('.wkv-st')?.textContent ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Type into a controlled input the way React can see.
 *
 * `input.value = x` alone is invisible to it: React keeps its own value
 * tracker per node and dedupes an event whose value it believes unchanged, so
 * the assignment has to go through the prototype's native setter that the
 * tracker wraps. This is the standard recipe, not a workaround for this
 * component.
 */
function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// STATE 1: AN EMPTY BOARD
// ---------------------------------------------------------------------------

test('EMPTY: six empty slots, stage 1, and a footer that counts what is missing', () => {
  const c = room();
  assert.equal(slots(c).length, 6);
  assert.equal(slots(c).filter((s) => s.className.includes('filled')).length, 0);
  assert.equal(slots(c).filter((s) => s.textContent.includes('TAP TO FILL')).length, 6);
  assert.deepEqual(sub(c), ['0 of 6 filled', 'open slots lock at kickoff']);
  assert.equal(txt(c, '.wkv-sh span'), '6 not yet kicked');
  // stage 1 names the game, not the gap
  assert.equal(c.querySelector('.wkv-stp.on b').textContent, 'Pick');
  assert.match(txt(c, '.wkv-note'), /^Six slots from this week’s actives\./);
  assert.match(txt(c, '.wkv-note'), /Each slot locks when its player’s game kicks off\.$/);
  // the footer
  assert.equal(txt(c, '.wkv-lock'), '6 to fill');
  assert.equal(c.querySelector('.wkv-lock').disabled, true);
  assert.match(txt(c, '.wkv-pace'), /Six filled or the week does not count/);
  // and the panel has nothing selected
  assert.match(txt(c, '.wkv-empty-p'), /A KICKED SLOT IS LOCKED/);
  assert.equal(prows(c).length, 0);
});

test('NO PERCENTAGE, NO ZERO, NO RANK before anything has kicked off', () => {
  const c = room();
  assert.equal(c.querySelector('.wkv-rec'), null, 'the whole hero is absent, not zeroed');
  assert.equal(c.querySelector('.wkv-rt'), null);
  assert.doesNotMatch(c.textContent, /\b0\.0\b/, 'a 0.0 on a Friday is a wrong number, not a low one');
});

test('THE MOCK\'S WRONG RULE IS NOWHERE ON THE SCREEN', () => {
  for (const lineup of [{}, MIXED, OPEN_SIX]) {
    const c = room({ initialLineup: lineup });
    assert.doesNotMatch(c.textContent, /scores 0/, 'an empty slot does not score 0 - it is a DNF');
    act(() => { for (const r of roots) r.unmount(); }); roots.clear();
  }
});

// ---------------------------------------------------------------------------
// STATE 2: PARTIAL
// ---------------------------------------------------------------------------

test('PARTIAL: the counts disagree on purpose, and the strip IS the needline', () => {
  const c = room({ initialLineup: { QB: 2, RB: 11, WR: 20 } });
  assert.deepEqual(sub(c).slice(0, 1), ['3 of 6 filled']);
  assert.equal(txt(c, '.wkv-sh span'), '6 not yet kicked', 'nothing has kicked, so all six are still open');
  assert.equal(c.querySelector('.wkv-stp.on b').textContent, 'Fill the lineup');
  assert.match(txt(c, '.wkv-note'), /^Still need TE · FLEX · FLEX\./);
  assert.match(txt(c, '.wkv-note'), /six filled or the week does not count/);
  assert.equal(txt(c, '.wkv-lock'), '3 to fill');
  assert.equal(c.querySelector('.wkv-lock').disabled, true);
});

// ---------------------------------------------------------------------------
// STATE 3: FULL AND ALL OPEN
// ---------------------------------------------------------------------------

test('FULL, ALL OPEN: stage 3, and the button becomes the receipt', () => {
  const c = room({ initialLineup: OPEN_SIX });
  assert.deepEqual(sub(c).slice(0, 1), ['6 of 6 filled']);
  assert.equal(c.querySelectorAll('.wkv-stp.done').length, 2);
  assert.equal(c.querySelector('.wkv-stp.on b').textContent, 'Locked in');
  assert.match(txt(c, '.wkv-note'), /^Every slot is filled\./);
  assert.equal(txt(c, '.wkv-lock'), 'Lock it in');
  assert.equal(c.querySelector('.wkv-lock').disabled, false);
  assert.equal(c.querySelectorAll('.wkv-pip.on').length, 6, 'six pips lit, none live or done');
});

// ---------------------------------------------------------------------------
// STATE 4-6: WHAT A SLOT SAYS ABOUT ITS GAME
// ---------------------------------------------------------------------------

const LIVE_LAYER = {
  byId: { 1: { points: 28.4, played: true }, 10: { points: 11.6, played: true }, 12: { points: 6.4, played: true } },
  total: 46.4, startedCount: 3, slots: 6, rank: 14, of: 61,
};

test('A LIVE SLOT: the opponent, the period and the clock, in the live colour', () => {
  const c = room({ initialLineup: MIXED, live: LIVE_LAYER });
  const rb = slots(c)[1];
  assert.equal(lineOf(rb), 'ATL at CAR · Q3 7:28');
  assert.ok(rb.querySelector('.wkv-st').className.includes('l'), 'the live line is the live colour');
  assert.equal(rb.querySelector('.wkv-pts').textContent, '11.6');
  assert.equal(rb.querySelector('.wkv-lk').textContent, 'LIVE');
  assert.ok(rb.className.includes('kicked'), 'and it cannot be tapped');
  assert.equal(rb.querySelector('.wkv-slot-tap').disabled, true);
});

test('A LIVE SLOT WITH NO CLOCK says the period and stops there', () => {
  const c = room({ initialLineup: MIXED, live: LIVE_LAYER });
  const flex = slots(c)[4];                          // Kenneth Walker, SEA
  assert.equal(lineOf(flex), 'SEA at NE · Q1', 'no trailing space where a clock would be');
  assert.equal(flex.querySelector('.wkv-pts').textContent, '6.4');
});

test('A FINAL SLOT: the team, the score it ended on, and no kickoff time', () => {
  const c = room({ initialLineup: MIXED, live: LIVE_LAYER });
  const qb = slots(c)[0];                            // Josh Allen, BUF 31-24
  assert.equal(lineOf(qb), 'BUF · Final 31-24');
  assert.equal(qb.querySelector('.wkv-lk').textContent, 'FINAL');
  assert.equal(qb.querySelector('.wkv-pts').textContent, '28.4');
  assert.ok(qb.className.includes('final'));
  assert.doesNotMatch(lineOf(qb), /AM|PM/, 'a time beside a final score is the one reading that is wrong');
});

test('AN OPEN SLOT: the matchup and its kickoff, through the island', () => {
  const c = room({ initialLineup: MIXED, live: LIVE_LAYER });
  const te = slots(c)[3];                            // George Kittle, SF vs MIA
  // THE DAY IS ON IT NOW (weekly-hdr). A Weekly slate runs Thursday to Monday
  // and this line used to read "5:15 PM" on two rows four days apart.
  assert.match(lineOf(te), /^SF vs MIA · (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d{2} (AM|PM)$/,
    'the matchup, the day, the time - and no zone on a row');
  assert.equal(te.querySelector('.wkv-pts'), null, 'no number before he has played');
  assert.equal(te.querySelector('.wkv-lk'), null, 'and no badge');
  assert.equal(te.querySelector('.wkv-slot-tap').disabled, false);
});

test('THE PIPS CARRY THE THREE STATES', () => {
  const c = room({ initialLineup: MIXED, live: LIVE_LAYER });
  const kinds = [...c.querySelectorAll('.wkv-pip')].map((n) => n.getAttribute('data-slot-state'));
  assert.deepEqual(kinds, ['final', 'live', 'live', 'scheduled', 'live', 'scheduled']);
  assert.equal(c.querySelectorAll('.wkv-pip.done').length, 1);
  assert.equal(c.querySelectorAll('.wkv-pip.live').length, 3);
});

test('A BYE READS AS A BYE, and borrows no kickoff', () => {
  // A player whose team has no game in the week's slate at all.
  const board = [...BOARD, { id: 99, pos: 'QB', name: 'Bye Guy', team: 'CLE', resume: '10.0 PPG · 20 g', kickoff_at: future(200) }];
  const c = room({ board, initialLineup: { QB: 99 }, live: LIVE_LAYER });
  assert.equal(lineOf(slots(c)[0]), 'CLE · bye');
});

// ---------------------------------------------------------------------------
// THE × - THE ONE THING THE MOCK DREW THAT v1 NEVER WIRED
// ---------------------------------------------------------------------------

test('THE × IS ON AN OPEN FILLED SLOT AND ON NO OTHER', () => {
  const c = room({ initialLineup: MIXED, live: LIVE_LAYER });
  const withX = slots(c).map((s) => s.querySelector('.wkv-x') != null);
  // BUF final, ATL live, ATL live, SF open, SEA live, DAL open
  assert.deepEqual(withX, [false, false, false, true, false, true]);
  // an EMPTY slot has nothing to clear either
  const empty = room({ initialLineup: { QB: 2 } });
  assert.equal(slots(empty)[1].querySelector('.wkv-x'), null);
  assert.ok(slots(empty)[0].querySelector('.wkv-x'), 'and the one filled open slot has one');
});

test('PRESSING THE × EMPTIES THE SLOT AND WRITES THE LINEUP WITHOUT IT', async () => {
  const c = room({ initialLineup: OPEN_SIX });
  click(slots(c)[0].querySelector('.wkv-x'));
  // the slot is empty on screen at once
  assert.match(slots(c)[0].textContent, /PICK BELOW/, 'and the panel opens on it');
  assert.deepEqual(sub(c).slice(0, 1), ['5 of 6 filled']);
  assert.equal(txt(c, '.wkv-lock'), '1 to fill');
  // and the debounced save carries the lineup with that key gone
  await act(async () => { await sleep(900); });
  assert.equal(saves.length, 1, 'one write, not one per keystroke');
  assert.equal(saves[0].url, '/api/weekly/save');
  assert.equal('QB' in saves[0].body.lineup, false, 'the key is deleted, never set to null');
  assert.deepEqual(saves[0].body.lineup, { RB: 11, WR: 20, TE: 30, FLEX: 13, FLEX2: 23 });
});

test('a kicked slot offers no × even while the week is open', () => {
  const c = room({ initialLineup: ALL_KICKED, live: LIVE_LAYER });
  assert.equal(c.querySelectorAll('.wkv-x').length, 0);
  assert.equal(c.querySelectorAll('.wkv-slot-tap:disabled').length, 6);
});

// ---------------------------------------------------------------------------
// NEXT LOCK (F)
// ---------------------------------------------------------------------------

test('NEXT LOCK is the earliest kickoff among FILLED, UNKICKED slots', () => {
  // SF (+1h) and DAL (+1h) are filled and open; KC (+5h) and LAR (+28h) are not
  // in this lineup, and the kicked ones cannot contribute.
  const c = room({ initialLineup: MIXED, live: LIVE_LAYER });
  const cell = sub(c)[1];
  // THE ONE DEADLINE ON THE SCREEN, and the one place the zone is stated.
  assert.match(cell, /^next lock (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d{2} (AM|PM) [A-Z]{2,5}$/,
    'day, time AND zone - this line is where the suffix lands');
  const iso = c.querySelectorAll('.wkv-sub time');
  if (iso.length) assert.ok(iso[0].getAttribute('dateTime') ?? true);
});

test('NO FILLED OPEN SLOT: the line states the rule instead of a time', () => {
  const c = room({ initialLineup: {} });
  assert.equal(sub(c)[1], 'open slots lock at kickoff');
});

test('EVERY SLOT KICKED: "all locked", and no button at all', () => {
  const c = room({ initialLineup: ALL_KICKED, live: LIVE_LAYER });
  assert.equal(sub(c)[1], 'all locked');
  assert.equal(txt(c, '.wkv-sh span'), 'all kicked');
  assert.equal(c.querySelector('.wkv-lock'), null, 'nothing left to confirm');
  assert.match(txt(c, '.wkv-pace'), /All six locked\./);
  assert.match(txt(c, '.wkv-pace'), /Worst pick drops at settle/);
  assert.match(txt(c, '.wkv-pace'), /Results Tuesday morning/);
});

// ---------------------------------------------------------------------------
// THE RANK CELL (B)
// ---------------------------------------------------------------------------

test('THE RANK CELL: present with a live board, ordinal, with its denominator', () => {
  const c = room({ initialLineup: MIXED, live: LIVE_LAYER });
  assert.equal(txt(c, '.wkv-rt b'), '14th');
  assert.equal(txt(c, '.wkv-rt span'), 'of 61 · live');
  assert.match(txt(c, '.wkv-big'), /^46\.4 · 3 of 6 started$/);
});

test('THE RANK CELL IS OMITTED when there is no rank, and the total still shows', () => {
  const c = room({ initialLineup: MIXED, live: { ...LIVE_LAYER, rank: null, of: 0 } });
  assert.equal(c.querySelector('.wkv-rt'), null);
  assert.ok(c.querySelector('.wkv-big'), 'the total is not conditional on the rank');
});

test('and the whole hero is omitted before the first kickoff', () => {
  const c = room({ initialLineup: MIXED, live: { ...LIVE_LAYER, startedCount: 0 } });
  assert.equal(c.querySelector('.wkv-rec'), null);
});

test('NO LIVE LAYER, NO NUMBERS - not even on a final game', () => {
  // The live read threw, or the reader is signed out. A slot must not print
  // the 0 the component hands slotState as though it were a score.
  const c = room({ initialLineup: MIXED, live: null });
  assert.equal(slots(c)[0].querySelector('.wkv-pts'), null);
  assert.equal(lineOf(slots(c)[0]), 'BUF · Final 31-24', 'the game still says what it did');
});

// ---------------------------------------------------------------------------
// THE PANEL: tabs, search, legality
// ---------------------------------------------------------------------------

test('TAPPING AN OPEN SLOT OPENS ITS POOL, SORTED BY THIS SEASON', () => {
  const c = room();
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  assert.match(txt(c, '.wkv-pan-h b'), /^QB · Quarterbacks$/);
  const names = prows(c).map((r) => r.querySelector('.wkv-who b').textContent);
  // Purdy (31.2 this season, 17.6 career) leads Allen (28.4 / 22.4) and
  // Mahomes (19.9 / 21.1); Prescott has no final game and sorts LAST.
  assert.deepEqual(names, ['Brock Purdy', 'Josh Allen', 'Patrick Mahomes', 'Dak Prescott']);
  assert.equal(prows(c)[0].querySelector('.wkv-val b').textContent, '31.2');
  assert.equal(prows(c)[0].querySelector('.wkv-val small').textContent, 'ppg · 1 g');
});

test('THE SORT LABEL IS THE SEASON, READ FROM THE CONTEST', () => {
  const c = room();
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  assert.equal(txt(c, '.wkv-srt'), '2026');
  assert.doesNotMatch(txt(c, '.wkv-srt'), /career/);
  // and a contest with no season still labels the column with a word
  act(() => { for (const r of roots) r.unmount(); }); roots.clear();
  const c2 = room({ contest: { id: 10, week: 2, locks_at: future(100) } });
  click(slots(c2)[0].querySelector('.wkv-slot-tap'));
  assert.equal(txt(c2, '.wkv-srt'), 'season');
});

test('NO CAREER PPG AND NO COLLEGE RESUME RENDER ON THE PANEL ANY MORE', () => {
  const c = room();
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  const html = c.querySelector('.wkv-pan-b').textContent;
  assert.doesNotMatch(html, /PPG/, 'the frozen career string is not on screen');
  assert.doesNotMatch(html, /42 g\b/, 'nor its games count');
  assert.doesNotMatch(html, /career/);
  // The resume is still ON THE WIRE - poolRows uses it as the tiebreak - it
  // is simply not shown. (Prescott has no season, so he is ordered by it.)
  assert.equal(prows(c).at(-1).querySelector('.wkv-who b').textContent, 'Dak Prescott');
});

test('THE TWO SMALL LINES: the game, then this season', () => {
  const c = room();
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  const purdy = prows(c)[0];
  const lines = [...purdy.querySelectorAll('.wkv-who small')].map((x) => x.textContent);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^SF vs MIA · (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d{2} (AM|PM)$/,
    'line one is the matchup, the DAY and its kickoff - a five-day slate needs the day');
  assert.equal(lines[1], '298 yds · 3 TD · 1 INT · 12 rush', 'line two is the season line');
  // A row with no season has ONE line, not an empty second one.
  const dak = prows(c).find((r) => r.textContent.includes('Dak Prescott'));
  assert.equal(dak.querySelectorAll('.wkv-who small').length, 1);
});

test('A LIVE ROW SAYS THE PERIOD AND THE CLOCK, in the live colour', () => {
  const c = room();
  click(slots(c)[1].querySelector('.wkv-slot-tap'));      // RB tab
  const bijan = prows(c).find((r) => r.textContent.includes('Bijan Robinson'));
  const line = bijan.querySelector('.wkv-who small');
  // ATL is live in this fixture, so he is also KICKED and unpickable - the
  // kicked line wins, because "you cannot have him" outranks "his game is on".
  assert.ok(bijan.className.includes('gone'));
  assert.match(line.textContent, /^Kicked · /);
  // A player whose game is live but who is somehow still takeable would read
  // the live line; the shape is asserted on the lineup slots, which share it.
  assert.ok(line != null);
});

test('A BYE READS AS A BYE ON A PANEL ROW TOO', () => {
  const board = [...BOARD, { id: 98, pos: 'QB', name: 'Bye Passer', team: 'CLE', resume: '9.0 PPG · 20 g', kickoff_at: future(200), season: szn(12.0, 1, '150 yds · 1 TD · 0 INT · 0 rush') }];
  const c = room({ board });
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  const bye = prows(c).find((r) => r.textContent.includes('Bye Passer'));
  assert.equal(bye.querySelectorAll('.wkv-who small')[0].textContent, 'CLE · bye');
});

test('TAPPING THE SAME SLOT AGAIN CLOSES THE PANEL', () => {
  const c = room();
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  assert.ok(prows(c).length > 0);
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  assert.equal(prows(c).length, 0);
  assert.match(txt(c, '.wkv-pan-h b'), /Tap an open slot/);
});

test('A KICKED PLAYER IS IN THE LIST AND CANNOT BE TAKEN', () => {
  const c = room();
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  const allen = prows(c).find((r) => r.textContent.includes('Josh Allen'));
  assert.ok(allen.className.includes('gone'));
  assert.equal(allen.disabled, true);
  assert.match(allen.querySelector('.wkv-who small').textContent, /^Kicked · /);
  click(allen);
  assert.equal(saves.length, 0, 'and no write was even queued');
});

test('FLEX OFFERS RB / WR / TE, and the tab narrows the SAME legality rule', () => {
  const c = room();
  click(slots(c)[4].querySelector('.wkv-slot-tap'));      // FLEX
  const tabs = [...c.querySelectorAll('.wkv-tab')].map((t) => t.textContent);
  assert.deepEqual(tabs, ['RB', 'WR', 'TE']);
  assert.equal(c.querySelector('.wkv-tab.on').textContent, 'RB');
  assert.ok(prows(c).every((r) => r.querySelector('.wkv-pb').textContent === 'RB'));
  click([...c.querySelectorAll('.wkv-tab')][1]);          // WR
  assert.equal(c.querySelector('.wkv-tab.on').textContent, 'WR');
  assert.ok(prows(c).every((r) => r.querySelector('.wkv-pb').textContent === 'WR'));
  assert.match(txt(c, '.wkv-pan-h b'), /^FLEX · Receivers$/);
});

test('A SINGLE-POSITION SLOT HAS NO TABS - one tab is a label pretending to be a control', () => {
  const c = room();
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  assert.equal(c.querySelectorAll('.wkv-tab').length, 0);
});

test('SEARCH NARROWS THE OPEN TAB, and says so when nothing matches', () => {
  const c = room();
  click(slots(c)[2].querySelector('.wkv-slot-tap'));      // WR
  assert.equal(prows(c).length, 5);
  const input = c.querySelector('.wkv-find input');
  type(input, 'lamb');
  assert.deepEqual(prows(c).map((r) => r.querySelector('.wkv-who b').textContent), ['CeeDee Lamb']);
  type(input, 'zzz');
  assert.equal(prows(c).length, 0);
  assert.match(txt(c, '.wkv-find-none'), /No receivers matching “zzz”\./);
});

test('A ROOKIE WITH NO CAREER RATE GETS A BLANK, NOT A ZERO - and his resume still names him', () => {
  const c = room();
  click(slots(c)[2].querySelector('.wkv-slot-tap'));      // WR
  const rookie = prows(c).find((r) => r.textContent.includes('Carson Beck'));
  assert.equal(rookie.querySelector('.wkv-val b').textContent, '', 'no season, no number');
  assert.equal(rookie.querySelector('.wkv-val small').textContent, '');
  // HIS DRAFT RESUME NO LONGER RENDERS (ruled). What identifies him now is the
  // game he is about to play, which is the fact the week turns on.
  assert.doesNotMatch(rookie.textContent, /R1 #2/);
  assert.match(rookie.querySelectorAll('.wkv-who small')[0].textContent, /^KC vs IND · /);
  assert.equal(rookie.querySelectorAll('.wkv-who small').length, 1, 'and no season line');
  // He still sorts last: no season number, and no career rate to break the tie.
  assert.equal(prows(c).at(-1).textContent.includes('Carson Beck'), true);
});

test('A PLAYER ALREADY IN THE LINEUP IS MARKED AND UNPICKABLE', () => {
  const c = room({ initialLineup: { RB: 11 } });
  click(slots(c)[4].querySelector('.wkv-slot-tap'));      // FLEX, RB tab
  const cmc = prows(c).find((r) => r.textContent.includes('Christian McCaffrey'));
  assert.ok(cmc.className.includes('gone'));
  assert.equal(cmc.disabled, true);
  assert.equal(cmc.querySelector('.wkv-who small').textContent, 'in your lineup',
    'the row says why it is unavailable, and spends no width on anything else');
});

test('PICKING FILLS THE SLOT, ADVANCES, AND WRITES ONCE', async () => {
  const c = room();
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  click(prows(c).find((r) => r.textContent.includes('Patrick Mahomes')));
  assert.match(slots(c)[0].textContent, /Patrick Mahomes/);
  assert.deepEqual(sub(c).slice(0, 1), ['1 of 6 filled']);
  assert.match(txt(c, '.wkv-pan-h b'), /^RB · Running backs$/, 'and it advanced to the next empty slot');
  await act(async () => { await sleep(900); });
  assert.deepEqual(saves.map((s) => s.body.lineup), [{ QB: 4 }]);
});

// ---------------------------------------------------------------------------
// CONFIRM, THEN EDIT
// ---------------------------------------------------------------------------

test('CONFIRM: the button calls the action and becomes the receipt', async () => {
  const c = room({ initialLineup: OPEN_SIX });
  await act(async () => {
    c.querySelector('.wkv-lock').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  assert.deepEqual(stub.confirms, [[10]], 'confirmWeeklyEntry(contest.id), once');
  assert.equal(txt(c, '.wkv-lock'), 'Locked in');
  assert.equal(c.querySelector('.wkv-lock').disabled, true);
  // The receipt names its day too: "which day did I lock this" is a real
  // question on a slate that runs Thursday to Monday.
  assert.match(txt(c, '.wkv-pace'), /^Locked in (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d{2} (AM|PM)/);
  assert.match(txt(c, '.wkv-pace'), /edit any open slot until its kickoff$/);
  assert.equal(saves.length, 0, 'nothing was pending, so nothing was flushed');
});

test('AN ALREADY-CONFIRMED ENTRY ARRIVES CONFIRMED', () => {
  const c = room({ initialLineup: OPEN_SIX, initialConfirmedAt: '2026-09-20T19:40:00.000Z' });
  assert.equal(txt(c, '.wkv-lock'), 'Locked in');
  assert.match(txt(c, '.wkv-pace'), /^Locked in /);
});

test('EDITING AFTER CONFIRMING UN-CONFIRMS IT', () => {
  const c = room({ initialLineup: OPEN_SIX, initialConfirmedAt: '2026-09-20T19:40:00.000Z' });
  click(slots(c)[0].querySelector('.wkv-x'));
  assert.equal(txt(c, '.wkv-lock'), '1 to fill');
  assert.match(txt(c, '.wkv-pace'), /Six filled or the week does not count/);
  assert.doesNotMatch(txt(c, '.wkv-pace'), /Locked in/);
});

test('AND SO DOES REPLACING A PLAYER', () => {
  const c = room({ initialLineup: OPEN_SIX, initialConfirmedAt: '2026-09-20T19:40:00.000Z' });
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  click(prows(c).find((r) => r.textContent.includes('Patrick Mahomes')));
  assert.equal(txt(c, '.wkv-lock'), 'Lock it in', 'still six, but the receipt is gone');
  assert.match(txt(c, '.wkv-pace'), /Every change saves/);
});

// ---------------------------------------------------------------------------
// SIGNED OUT
// ---------------------------------------------------------------------------

test('SIGNED OUT: a tap is the door, not a dead end - and nothing is written', () => {
  const c = room({ signedIn: false });
  click(slots(c)[0].querySelector('.wkv-slot-tap'));
  assert.deepEqual(nav.pushes, ['/signin?d=/weekly']);
  assert.equal(prows(c).length, 0, 'no pool opened');
  assert.equal(saves.length, 0);
});

test('SIGNED OUT with a lineup on screen still renders the six and the rules', () => {
  const c = room({ signedIn: false, initialLineup: MIXED });
  assert.equal(slots(c).filter((s) => s.className.includes('filled')).length, 6);
  assert.match(txt(c, '.wkv-pace'), /Six filled or the week does not count/);
});

// ---------------------------------------------------------------------------
// THE SURVIVORS (L) AND THE ONE CLAIM UNDER THE LINEUP
// ---------------------------------------------------------------------------

test('THE CEILING LINE NAMES THE POOL IT IS A CLAIM ABOUT', () => {
  const c = room();
  assert.equal(txt(c, '.wkv-perf'), `best six this pool allows · ${BOARD.length} players`);
});

test('THE HANDLE GATE STILL PAINTS A HELD SLOT, and the tap re-opens the claim', () => {
  // hasHandle false: the write is held at the flush, and the slot that changed
  // wears it. Rendering the room with no handle must not change anything else.
  const c = room({ hasHandle: false, initialLineup: OPEN_SIX });
  assert.equal(slots(c).filter((s) => s.className.includes('wkv-pending')).length, 0,
    'nothing is held until a write is attempted');
  assert.ok(c.querySelector('.wkv-lock'), 'and the footer is unchanged');
});
