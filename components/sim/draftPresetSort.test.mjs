// components/sim/draftPresetSort.test.mjs - the bots draft the BOARD, whatever
// the reader is looking at.
//
// THE FEAR THIS TEST EXISTS FOR. "The Draft" preset opens its room on PPG
// rather than on the board's own order, and a room whose visible list is in a
// different order from the engine's is exactly the shape of a bug where the
// auto-pick follows the screen. If expiring a clock ever took the top row
// instead of the best available, the reader would lose a pick to their own
// sort choice - silently, and only sometimes.
//
// WHY IT CANNOT HAPPEN, PROVED TWO WAYS. Structurally: timerAutoPick is handed
// the DRAFT ID and nothing else, so there is no channel through which a client
// sort could reach the engine. And behaviourally: with the list sorted so that
// the top row is the WORST player on the board, expiry still lands the best one.
//
// PRESSED, NOT READ. A source-pin would have passed on every version of this
// file that ever shipped, including ones that took the top rendered row.

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
const STUB = stubPath(`__dps_sim_${process.pid}.mjs`);
const NAV = stubPath(`__dps_nav_${process.pid}.mjs`);
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/app/actions/sim') return { url: pathToFileURL(STUB).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let createRoot; let act; let Room; let dom; let tmp; let stub;
const roots = new Set();

const TEAMS = 12;
const ROUNDS = 8;
// The preset's own row, as the seed writes it - default_sort and all.
const CONFIG = {
  id: 77, user_id: null, name: 'The Draft', teams_count: TEAMS, scoring_format: 'ppr',
  roster_slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 }, pick_timer_seconds: 30,
  is_preset: true, default_sort: 'ppg',
};
const ORDER = (() => {
  const o = [];
  for (let r = 1; r <= ROUNDS; r++) {
    const row = Array.from({ length: TEAMS }, (_, i) => i);
    if (r % 2 === 0) row.reverse();
    o.push(...row);
  }
  return o;
})();

// THE BOARD ORDER AND THE PPG ORDER ARE DELIBERATE OPPOSITES. Rank 1 has the
// WORST season and rank 5 the best, so "top of the screen" and "best available"
// can never be confused for one another by accident.
const P = (n, pos, name, adp, ppg) => ({
  row: { ffcPlayerId: String(n), name, position: pos, team: 'KC', adp, adpHigh: null, adpLow: null,
    timesDrafted: null, stdev: null, bye: 7, league: 'nfl', rookie: false, vor: null, ppg },
  ppg,
});
const BOARD = [
  P(1, 'RB', 'Board First', 1, 4.0),
  P(2, 'WR', 'Board Second', 2, 8.0),
  P(3, 'WR', 'Board Third', 3, 12.0),
  P(4, 'RB', 'Board Fourth', 4, 16.0),
  P(5, 'WR', 'Board Fifth', 5, 20.0),
];
const AVAILABLE = BOARD.map((p) => p.row);
const SUMMARIES = Object.fromEntries(BOARD.map((p) => [p.row.ffcPlayerId,
  { ppg: p.ppg, points: p.ppg * 2, games: 2, totals: { rec: 1, recYds: 10, recTd: 0 } }]));
const BEST_BY_RANK = BOARD[0].row;   // adp 1, ppg 4.0  - the engine's pick
const BEST_BY_PPG = BOARD[4].row;    // adp 5, ppg 20.0 - the top row on screen

before(async () => {
  // THE SERVER'S AUTO-PICK, honestly stubbed: it takes the best available by
  // BOARD RANK, which is what engine.autoPick does (legalCandidates walks
  // state.available, and createDraftState sorts that by adp). The stub records
  // every argument it was handed so the test can assert what it was NOT given.
  writeFileSync(STUB, `
    export const calls = [];
    const BEST = ${JSON.stringify(BEST_BY_RANK)};
    export async function makePick(...a) { calls.push(['makePick', ...a]); return { ok: true, picksMade: [], aiPicksMade: 0, nextOverall: null }; }
    export async function timerAutoPick(...a) {
      calls.push(['timerAutoPick', ...a]);
      return { ok: true, aiPicksMade: 0, nextOverall: null, picksMade: [{
        overallPick: 1, round: 1, rosterSlot: BEST.position, ffcPlayerId: BEST.ffcPlayerId,
        position: BEST.position, playerName: BEST.name, slotPos: BEST.position, team: BEST.team,
        bye: BEST.bye, adpAtPick: BEST.adp, pickedBy: 'ai', rookie: false, isUser: true,
        synthetic: false, isKeeper: false,
      }] };
    }
    export async function setAutoDraft(...a) { calls.push(['setAutoDraft', ...a]); return { ok: true }; }
    export async function fetchPlayerStats() { return null; }
    export async function fetchPlayerSummaries(...a) {
      calls.push(['fetchPlayerSummaries', ...a]);
      return { ok: true, summaries: ${JSON.stringify(SUMMARIES)} };
    }
  `);
  writeFileSync(NAV, `
    export function useRouter() { return { push: () => {}, replace: () => {}, refresh: () => {} }; }
    export function useSearchParams() { return new URLSearchParams(); }
    export function usePathname() { return '/sim/draft/77'; }
  `);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/sim/draft/77' });
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
  tmp = stubPath(`__dps_room_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  Room = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); stub.calls.length = 0;
});
after(() => { for (const f of [tmp, STUB, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

async function room(props = {}) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  await act(async () => {
    root.render(React.createElement(Room, {
      draftId: 77, config: CONFIG, order: ORDER, userTeamIndex: 0,
      initialPicks: [], initialAvailable: AVAILABLE, timerSeconds: 30, initialAuto: false,
      poolMapping: { configScoring: 'ppr', configTeams: 12, poolScoring: 'ppr', poolTeams: 12,
        exact: true, snapshotDate: '2026-09-17', source: 'sportsvyn', boardLabel: 'Sportsvyn board · 2026' },
      withheld: [], minors: [], upcomingKeepers: [], franchise: null,
      ...props,
    }));
  });
  return c;
}
const names = (c) => [...c.querySelectorAll('.pg-pick .p-item .nm')].map((n) => n.textContent.replace(/\s+/g, ' ').trim());

// ---------------------------------------------------------------------------
test('THE ROOM OPENS ON THE PRESET\'S SORT, not on the board order', async () => {
  const c = await room();
  const shown = names(c);
  assert.equal(shown[0], BEST_BY_PPG.name,
    `the list opens on PPG - got ${shown.join(' | ')}`);
  assert.deepEqual(shown, ['Board Fifth', 'Board Fourth', 'Board Third', 'Board Second', 'Board First'],
    'which is the exact reverse of the board here, by construction');
  // And the control shows PPG as the live sort.
  const on = c.querySelector('.avail-sort .on, .avail-sort [aria-pressed="true"]');
  if (on) assert.match(on.textContent, /PPG/);
});

// THU-25: EVERY ROOM OPENS ON PPG NOW. Before, a config that named nothing
// opened on the board order; the ranked room's reader asked for this season's
// points per game first, so the default moved and the board order is a tap away.
test('A CONFIG THAT NAMES NO SORT OPENS ON PPG (thu-25)', async () => {
  const c = await room({ config: { ...CONFIG, default_sort: null } });
  assert.deepEqual(names(c), ['Board Fifth', 'Board Fourth', 'Board Third', 'Board Second', 'Board First']);
});

test('A CONFIG THAT NAMES ADP STILL OPENS ON THE BOARD, and ADP stays a sort', async () => {
  const c = await room({ config: { ...CONFIG, default_sort: 'adp' } });
  assert.deepEqual(names(c), ['Board First', 'Board Second', 'Board Third', 'Board Fourth', 'Board Fifth']);
  const c2 = await room({ config: { ...CONFIG, default_sort: null } });
  const adp = [...c2.querySelectorAll('.avail-sort button')].find((b) => b.textContent.trim() === 'ADP');
  assert.ok(adp, 'ADP is offered');
  await act(async () => { adp.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  assert.equal(names(c2)[0], 'Board First', 'and choosing it orders by the board');
});

test('A PLAYER WITH NO SEASON SORTS AFTER THE ONES WITH DATA, never as a zero above them', async () => {
  const extra = { ffcPlayerId: '99', name: 'No Season Yet', position: 'WR', team: 'KC', adp: 0.5, adpHigh: null,
    adpLow: null, timesDrafted: null, stdev: null, bye: 7, league: 'nfl', rookie: false, vor: null };
  const c = await room({ initialAvailable: [extra, ...AVAILABLE] });
  const shown = names(c);
  assert.equal(shown[shown.length - 1], 'No Season Yet', `got ${shown.join(' | ')}`);
});

test('THE FLEX CHIP sits after TE and narrows to RB + WR + TE', async () => {
  const qb = { ...AVAILABLE[0], ffcPlayerId: '50', name: 'A Quarterback', position: 'QB', adp: 6 };
  const c = await room({ initialAvailable: [...AVAILABLE, qb] });
  const chips = [...c.querySelectorAll('.pg-pick .avail-chips:not(.avail-class) button')].map((b) => b.textContent);
  assert.deepEqual(chips, ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST']);
  assert.ok(names(c).includes('A Quarterback'));
  const flex = [...c.querySelectorAll('.pg-pick .avail-chips button')].find((b) => b.textContent === 'FLEX');
  await act(async () => { flex.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  const shown = names(c);
  assert.ok(!shown.includes('A Quarterback'), 'the QB leaves under FLEX');
  assert.equal(shown.length, AVAILABLE.length, 'every RB and WR stays');
});

const opps = (c) => [...c.querySelectorAll('.pg-pick .p-item .nopp')].map((n) => n.textContent.trim());
test('A RANKED ROOM NAMES THIS WEEK\'S GAME ON EACH ROW: "@KC" / "vs KC" and the kickoff', async () => {
  const LV = { ...AVAILABLE[0], ffcPlayerId: '60', name: 'A Raider', team: 'LV', adp: 7 };
  const c = await room({
    config: { ...CONFIG, default_sort: 'adp' },
    initialAvailable: [...AVAILABLE, LV],
    matchups: {
      KC: { opp: 'LV', home: true, kickoffAt: '2026-10-11T17:00:00.000Z' },
      LV: { opp: 'KC', home: false, kickoffAt: '2026-10-11T17:00:00.000Z' },
    },
  });
  const o = opps(c);
  assert.equal(o.length, AVAILABLE.length + 1, 'one per row');
  assert.match(o[0], /^vs LV · Sun \d{1,2}:00 [AP]M$/, `home row: ${o[0]}`);
  assert.match(o[o.length - 1], /^@KC · Sun \d{1,2}:00 [AP]M$/, `away row: ${o[o.length - 1]}`);
});

test('A PRACTICE MOCK (no week) OMITS THE OPPONENT CLEANLY - no tag, no dash', async () => {
  const c = await room();
  assert.equal(opps(c).length, 0);
  assert.equal(c.querySelectorAll('.pg-pick .nopp').length, 0);
});

test('RANK IS STILL A COLUMN under the PPG sort', async () => {
  const c = await room();
  const head = c.querySelector('.pg-pick .nhead');
  assert.match(head.textContent, /RANK/, 'the board rank keeps its column on a Sportsvyn board');
  assert.match(head.textContent, /PPG/);
  assert.match(head.textContent, /VAL/);
});

test('EXPIRY UNDER THE PPG SORT DRAFTS THE TOP RANK, NOT THE TOP ROW', async () => {
  const c = await room({ timerSeconds: 1 });
  assert.equal(names(c)[0], BEST_BY_PPG.name, 'the top row is the PPG leader');

  await act(async () => { await new Promise((r) => setTimeout(r, 1300)); });

  const fired = stub.calls.filter((x) => x[0] === 'timerAutoPick');
  assert.equal(fired.length, 1, 'once per turn');
  // THE STRUCTURAL HALF: the draft id, and nothing else. No player, no sort
  // key, no visible order - there is no channel for the screen to reach the
  // engine through.
  assert.deepEqual(fired[0], ['timerAutoPick', 77],
    'timerAutoPick is handed the draft id alone');

  // THE BEHAVIOURAL HALF: the pick that landed is the board's best.
  const feed = c.textContent;
  assert.match(feed, new RegExp(BEST_BY_RANK.name), 'the engine took the best available by rank');
  // ...and he is gone from the list, while the PPG leader is still there.
  const after = names(c);
  assert.ok(!after.includes(BEST_BY_RANK.name), 'the drafted man leaves the board');
  assert.ok(after.includes(BEST_BY_PPG.name), 'the man at the top of the screen was not taken');
});

test('AND THE ENGINE ITSELF RANKS BY THE BOARD - the other end of the same claim', () => {
  const eng = readFileSync(new URL('../../lib/fantasy/engine.js', import.meta.url), 'utf8');
  // autoPick takes the FIRST legal candidate...
  const auto = eng.slice(eng.indexOf('export function autoPick'), eng.indexOf('// applyPick'));
  assert.match(auto, /const cands = legalCandidates\(state, team, round\)/);
  assert.match(auto, /return commit\(state, team, cands\[0\]/);
  // ...legalCandidates walks state.available in order...
  const legal = eng.slice(eng.indexOf('export function legalCandidates'), eng.indexOf('function commit('));
  assert.match(legal, /for \(const pl of state\.available\)/);
  // ...and state.available is sorted by the board number, once, at creation.
  assert.match(eng, /available = fillable\.slice\(\)\.sort\(\(a, b\) => Number\(a\.adp\) - Number\(b\.adp\)\)/);
  // No sort key of the room's ever reaches this module.
  for (const key of ['ppg', 'points', 'myteam', 'sortsFor', 'sortPlayers']) {
    assert.ok(!eng.includes(key), `engine.js must not know about the room's "${key}"`);
  }
});
