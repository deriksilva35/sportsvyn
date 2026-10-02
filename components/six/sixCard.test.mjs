// components/six/sixCard.test.mjs - Tonight's Six, MOUNTED: the pick room, the
// live card and the final are one component at three moments.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const ACTION = stubPath('__six_action_stub.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec.endsWith('app/actions/six')) return { url: pathToFileURL(ACTION).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, renderToStaticMarkup, SixCard, createRoot, act, dom, action;
const roots = new Set();
before(async () => {
  writeFileSync(ACTION, [
    'export const calls = [];',
    'export let reply = { ok: true };',
    'export function setReply(r) { reply = r; }',
    'export async function saveSixPickAction(c, s, p) { calls.push({ c, s, p }); return reply; }',
    'export async function clearSixPickAction(c, s) { calls.push({ c, s, clear: true }); return reply; }',
  ].join('\n') + '\n');
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/six' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react'); ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  SixCard = (await import('./SixCard.js')).default;
  action = await import(pathToFileURL(ACTION).href);
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { try { unlinkSync(ACTION); } catch { /* gone */ } });

const NOW = '2026-10-21T22:00:00.000Z';
const BOARD = [
  { matchId: 1, slug: 'dal-orl', away: { abbr: 'DAL' }, home: { abbr: 'ORL' }, awayTeamId: 12, homeTeamId: 11, tipAt: '2026-10-21T23:00:00.000Z', status: 'scheduled', void: false, chip: null, score: null, pickable: true },
  { matchId: 2, slug: 'gsw-hou', away: { abbr: 'GSW' }, home: { abbr: 'HOU' }, awayTeamId: 22, homeTeamId: 21, tipAt: '2026-10-22T00:30:00.000Z', status: 'scheduled', void: false, chip: null, score: null, pickable: true },
  { matchId: 3, slug: 'lal-den', away: { abbr: 'LAL' }, home: { abbr: 'DEN' }, awayTeamId: 32, homeTeamId: 31, tipAt: '2026-10-22T03:00:00.000Z', status: 'scheduled', void: false, chip: null, score: null, pickable: true },
];
const row = (id, short, position, matchId, teamId, team, opp, fppg, o = {}) => ({ playerId: String(id), name: short, short, position, matchId, teamId, team, opp, home: false, fppg, fppgSeason: 2025, injury: null, out: false, ...o });
const POOL = { byGame: {
  1: [row(10, 'P. Banchero', 'F', 1, 11, 'ORL', 'DAL', 44.1), row(11, 'C. Flagg', 'F', 1, 12, 'DAL', 'ORL', 40.2)],
  2: [row(20, 'S. Curry', 'G', 2, 22, 'GSW', 'HOU', 44.6), row(21, 'B. Podziemski', 'G', 2, 22, 'GSW', 'HOU', 31.0),
    row(22, 'D. Green', 'F', 2, 22, 'GSW', 'HOU', 29.9), row(79, 'J. Butler', 'G-F', 2, 22, 'GSW', 'HOU', 38.0, { injury: 'Out', out: true }),
    row(23, 'K. Durant', 'F', 2, 21, 'HOU', 'GSW', 47.3, { injury: 'Questionable' })],
  3: [row(30, 'N. Jokic', 'C', 3, 31, 'DEN', 'LAL', 63.0)],
} };
const slot = (s, o = {}) => ({ slot: s, pos: { g1: 'G', g2: 'G', f1: 'F', f2: 'F', c: 'C', util: 'UTIL' }[s], state: 'empty', points: null, chips: [], line: null, dnp: false, pip: 'open', name: null, playerId: null, ...o });

/** The pick room: two Warriors on the card (GSW is capped), Butler Out. */
const OPEN = () => ({
  phase: 'open', now: NOW,
  contest: { id: 9, day: '2026-10-21', dayLabel: 'Wed Oct 21', games: 3, settled: false, cap: 2, rules: 'PTS 1 · REB 1.25', season: 2026 },
  board: BOARD,
  slots: [
    slot('g1', { state: 'pending', pip: 'picked', playerId: '20', name: 'S. Curry', team: 'GSW', opp: 'HOU', teamId: 22, position: 'G', matchId: 2 }),
    slot('g2'), slot('f1'),
    slot('f2', { state: 'pending', pip: 'picked', playerId: '22', name: 'D. Green', team: 'GSW', opp: 'HOU', teamId: 22, position: 'F', matchId: 2 }),
    slot('c'), slot('util'),
  ],
  progress: { pips: ['picked', 'open', 'open', 'picked', 'open', 'open'], filled: 2, locked: 0, picked: 2, open: 4, total: 6 },
  nightState: 'open', total: 0,
  nextLock: { matchId: 1, label: 'DAL @ ORL', tipAt: '2026-10-21T23:00:00.000Z', msAway: 3_600_000 },
  pool: POOL, anyLive: false, me: null, rank: null, of: 0, perfect: null, boardRows: { head: [], around: [], gap: false, count: 0 }, signedIn: true,
});

const html = (props) => renderToStaticMarkup(React.createElement(SixCard, props));

test('THE PICK ROOM: header, six slots G G F F C UTIL, the cap and the Out player', () => {
  const h = html({ view: OPEN(), signedIn: true });
  assert.match(h, /<span class="sx-eb">Tonight&#x27;s Six<\/span>/);
  assert.match(h, /Wed Oct 21 · 3 games · cap 2\/team/);
  assert.match(h, /<b>2<\/b><span>of 6<\/span>/);
  assert.deepEqual([...h.matchAll(/data-slot="(\w+)" data-state="(\w+)"/g)].map((m) => [m[1], m[2]]),
    [['g1', 'filled'], ['g2', 'open'], ['f1', 'open'], ['f2', 'filled'], ['c', 'open'], ['util', 'open']]);
  assert.match(h, /aria-label="01 hours 00 minutes to the next tip"/);
  // THE CAPPED TEAM: Podziemski would be a third Warrior - dimmed, and it says why.
  assert.match(h, /data-player="21" class="sx-row dim" disabled=""/);
  assert.match(h, /2 from GSW · cap/);
  // THE OUT PLAYER: listed, dimmed, tagged OUT, at the bottom of the list.
  assert.match(h, /data-player="79" class="sx-row dim out" disabled=""/);
  assert.match(h, /<span class="sx-out">OUT<\/span>/);
  const order = [...h.matchAll(/data-player="(\d+)"/g)].map((m) => m[1]);
  assert.equal(order.at(-1), '79');
  assert.equal(order[0], '30', 'sorted by FP/G across the night');
  // Questionable is a tag, not a refusal.
  assert.match(h, /data-player="23" class="sx-row"/);
  assert.match(h, /<em class="sx-q">Q<\/em>/);
  // On your card already.
  assert.match(h, /data-player="20"[\s\S]*?on your card/);
  assert.match(h, /4 to go/);
  assert.match(h, /At most <b>2 from any one team<\/b>/);
});

test('A TAP FILLS THE RIGHT SLOT; a refused save is repainted with its reason', async () => {
  const el = document.getElementById('root');
  const root = createRoot(el); roots.add(root);
  action.calls.length = 0; action.setReply({ ok: true });
  await act(async () => { root.render(React.createElement(SixCard, { view: OPEN(), signedIn: true })); });
  // Jokic (C) goes to c, not UTIL.
  await act(async () => { el.querySelector('[data-player="30"]').click(); });
  assert.equal(action.calls.at(-1).s, 'c');
  assert.equal(el.querySelector('[data-slot="c"]').dataset.state, 'filled');
  // Durant (F) goes to f1; the server refuses (as if he went Out a minute ago).
  action.setReply({ ok: false, reason: 'player_out' });
  await act(async () => { el.querySelector('[data-player="23"]').click(); });
  assert.equal(action.calls.at(-1).s, 'f1');
  assert.equal(el.querySelector('[data-slot="f1"]').dataset.state, 'open');
  assert.match(el.textContent, /That player is listed out tonight\./);
  // A tapped open slot filters the pool to who fits it.
  await act(async () => { el.querySelector('[data-slot="util"]').click(); });
  assert.match(el.textContent, /UTIL eligible/);
});

test('THE LIVE CARD: points per slot and a chip per stat; a DNP says so', () => {
  const v = OPEN();
  v.phase = 'live'; v.anyLive = true;
  v.board = [{ ...BOARD[0], status: 'final', score: { away: 114, home: 115 }, pickable: false },
    { ...BOARD[1], status: 'live', chip: 'OT 1:12', score: { away: 109, home: 108 }, pickable: false }, BOARD[2]];
  const chips = [{ key: 'pts', label: 'PTS', count: 26, points: 26 }, { key: 'reb', label: 'REB', count: 10, points: 12.5 }, { key: 'tov', label: 'TOV', count: 2, points: -1 }, { key: 'dd', label: 'DD', count: 1, points: 1.5 }];
  v.slots = [
    slot('g1', { state: 'live', pip: 'locked', playerId: '20', name: 'S. Curry', team: 'GSW', opp: 'HOU', matchId: 2, points: 0 }),
    slot('g2'),
    slot('f1', { state: 'final', pip: 'locked', playerId: '10', name: 'P. Banchero', team: 'ORL', opp: 'DAL', matchId: 1, points: 39, chips }),
    slot('f2', { state: 'final', pip: 'locked', playerId: '11', name: 'C. Flagg', team: 'DAL', opp: 'ORL', matchId: 1, points: 0, dnp: true, line: 'DNP' }),
    slot('c', { state: 'pending', pip: 'picked', playerId: '30', name: 'N. Jokic', team: 'DEN', opp: 'LAL', matchId: 3 }),
    slot('util'),
  ];
  v.total = 39;
  const h = html({ view: v, signedIn: true });
  assert.match(h, /data-block="your-six"/);
  assert.match(h, /data-chip="pts">PTS 26<i>\+26<\/i>/);
  assert.match(h, /data-chip="tov">TOV 2<i>-1<\/i>/);
  assert.match(h, /data-chip="dd">DD<i>\+1\.5<\/i>/);
  assert.match(h, /Did not play - scores 0, the slot still counts\./);
  assert.match(h, /OT 1:12 · 109-108/);
  assert.match(h, /F 114-115/);
  assert.match(h, /<span class="sx-pts fin">39<\/span>/);
  assert.match(h, /waiting on the tip/);
});

test('THE FINAL: total, rank, the perfect six and the national board', () => {
  const v = OPEN();
  v.phase = 'final'; v.contest.settled = true; v.total = 239; v.rank = 2; v.of = 3;
  v.slots = v.slots.map((s) => ({ ...s, pip: s.playerId ? 'locked' : 'open', state: s.playerId ? 'final' : 'empty', points: s.playerId ? 20 : null }));
  v.perfect = { score: 308.3, players: [{ slot: 'c', name: 'Nikola Jokic', position: 'C', team: 'DEN', points: 66.5 }, { slot: 'g1', name: 'Luka Doncic', position: 'F-G', team: 'LAL', points: 60.8 }] };
  v.boardRows = { head: [{ userId: 2, handle: 'kd', rank: 1, points: 270.5 }, { userId: 1, handle: 'me', rank: 2, points: 239, isMe: true }, { userId: 3, handle: 'cc', rank: 3, points: 129.5 }], around: [], gap: false, count: 3 };
  const h = html({ view: v, signedIn: true });
  assert.match(h, /data-block="result"/);
  assert.match(h, /<b>239<\/b><span>your six<\/span>/);
  assert.match(h, /<b>2nd<\/b><span>of 3<\/span>/);
  assert.match(h, /<b>308\.3<\/b><span>perfect six<\/span>/);
  assert.match(h, /data-block="perfect"/);
  assert.match(h, /Nikola Jokic/);
  assert.match(h, /class="sx-br you" data-rank="2"/);
  assert.match(h, /<span class="t">129\.5<\/span>/);
  assert.doesNotMatch(h, /DNF/, 'no DNF anywhere in the Six UI');
  assert.doesNotMatch(h, /data-player=/, 'no pool on a graded night');
});

test('SIGNED OUT the card is read-only', () => {
  const h = html({ view: OPEN(), signedIn: false, signinHref: '/signin?next=six' });
  assert.match(h, /<a class="sx-lock" href="\/signin\?next=six">Sign in to play<\/a>/);
  assert.equal([...h.matchAll(/<button[^>]*class="sx-row[^"]*"[^>]*disabled/g)].length, 8);
});

test('NO DNF IN THE SIX UI: a closed card with an empty slot says it scores 0', () => {
  const v = OPEN();
  v.phase = 'live'; v.nightState = 'closed'; v.total = 88;
  v.slots = v.slots.map((s) => ({ ...s, pip: s.playerId ? 'locked' : 'open' }));
  const h = html({ view: v, signedIn: true });
  assert.doesNotMatch(h, /DNF/);
  assert.match(h, /empty · 0/);
  assert.match(h, /2 OF 6 · empty slots score 0/);
  assert.match(html({ view: OPEN(), signedIn: true }), /so does an empty slot/);
});
