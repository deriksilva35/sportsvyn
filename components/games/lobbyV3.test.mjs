// components/games/lobbyV3.test.mjs - the v3 screen in jsdom, with real taps.
//
// PRESS THE BUTTON. The pure shapers already have 25 tests (lib/games/
// nowCard.test.mjs, v3Rows.test.mjs) and they prove the NUMBERS; none of them
// proves a screen. This renders the real component - the real Link, the real
// HouseTag, the real StandaloneTime - and reads the DOM back, because the
// failure mode this relay is guarding against is not a wrong number, it is a
// correct number that never reaches a row.
//
// A TAP ON A CHIP IS A NAVIGATION, AND THAT IS WHAT IS TESTED. The chips are
// <Link>s carrying ?pane=, deliberately (see the component's header), so
// "switching chips" has two halves and both are asserted: the tapped chip's
// href is the URL it claims, and the screen rendered AT that URL shows that
// pane. A click handler would be a third thing to test and a hydration flash
// to ship.
//
// NO TEMP MODULE IS WRITTEN INTO THE REPO. nextResolve's load hook transforms
// repo JSX on the way in, so the component imports directly; the weekly-hdr
// relay lost an afternoon to an eslint run reading a temp .mjs that vanished
// underneath it.

import { test, before, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
import { nowCard } from '../../lib/games/nowCard.js';
import { weeklyRowV3, pickemRowV3, dailyRowV3, draftRowV3, pickemRecord, elapsedOf } from '../../lib/games/v3Rows.js';
import { normalizeChip } from '../../lib/games/lobby.js';

install();

let React; let createRoot; let act; let LobbyV3; let dom;
const roots = new Set();

const HOUR = 3600_000;
const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
const ahead = (h) => new Date(Date.now() + h * HOUR).toISOString();

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'https://sportsvyn.test/games' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  LobbyV3 = (await import('./LobbyV3.js')).default;
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear();
  document.getElementById('root').innerHTML = '';
});
after(() => { for (const r of roots) { try { r.unmount(); } catch { /* gone */ } } });

function screen(props = {}) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(LobbyV3, {
    v: {}, chip: 'week', signedIn: true, signinHref: (h) => `/signin?callbackUrl=${encodeURIComponent(h)}`,
    ...props,
  })));
  return c;
}
const txt = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
// textContent GLUES SIBLING ELEMENTS: a row of <span>1</span><span>jake</span>
// reads '1jake', so an assertion written as prose silently tests the wrong
// thing. cells() reads the row the way the screen draws it - one cell at a
// time, in order.
const cells = (el, sel = ':scope > *') => [...(el?.querySelectorAll(sel) ?? [])].map(txt);
const rows = (c) => [...c.querySelectorAll('.gv-g')];
const chips = (c) => [...c.querySelectorAll('.gv-chip')];
const rowBy = (c, key) => c.querySelector(`.gv-g[data-row="${key}"]`);
const click = (node) => act(() => {
  node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
});

// ===========================================================================
// THE FOUR DEMO DAYS, each built from the shapers the reader feeds
// ===========================================================================
const week = (v) => ({ now: v.now, rows: v.rows, week: 2, practice: [
  { key: 'draft', label: 'Mock draft', title: 'The Draft', href: '/sim', sub: '12 · 8 rounds · this season' },
  { key: 'league', label: 'Mock draft', title: 'Your league', href: '/leagues', sub: 'your rules' },
], foot: v.foot ?? 'Everything scores on its own · graded Tuesday' });

// THU, PRE-KICK: the board is open, nothing is live, nothing is graded.
const THU = () => {
  const now = nowCard({
    daily: { state: 'play', closesAt: ahead(6), shape: '8 slots · 12 teams · about 3 minutes', streakLine: '4-day streak' },
    weekly: { state: 'open' }, draft: { state: 'none' },
  });
  return week({ now, rows: [
    dailyRowV3({ pct: '99.7%', matched: '7 of 8 matched', streak: 4, state: 'play', opensAt: ahead(6) }),
    weeklyRowV3({ rows: [{ id: 1, name: 'Josh Allen' }, { id: 2, name: 'Kenneth Walker' }, { id: 3, name: 'Jahmyr Gibbs' },
      { id: 4, name: 'A' }, { id: 5, name: 'B' }, { id: 6, name: 'C' }], state: 'open', filled: 6 }),
    pickemRowV3({ nfl: { record: { correct: 0, played: 0, pending: 38 } }, cfb: null }),
    draftRowV3({ state: 'drafting' }),
  ] });
};

// FRI, MORNING: last night's board closed and is graded - the card leads with it.
const FRI = () => {
  const now = nowCard({
    daily: { state: 'done', closesAt: ago(9), stats: [{ label: 'Yesterday', value: '99.7%' }],
      edition: '2024 season', gradedLine: '7 of 8 · 5-day streak' },
    weekly: { state: 'locked', live: true, scored: 34.2 }, draft: { state: 'none' },
  });
  return week({ now, rows: [
    dailyRowV3({ pct: '99.7%', streak: 5, state: 'done', opensAt: ahead(12) }),
    weeklyRowV3({ rows: [], state: 'locked', live: true, scored: 34.2, toPlay: 5 }),
    // THE LIVE GAME IS OFF THE RECORD. 15 NFL games are pending; the record
    // reads 1-0, not 1-15 and not 16-0.
    pickemRowV3({
      nfl: { record: pickemRecord({
        picks: { 1: 'home', 2: 'away', 3: 'home' },
        games: [{ id: 1, status: 'final', winner: 'home' }, { id: 2, status: 'live', winner: null },
          { id: 3, status: 'scheduled', winner: null }] }) },
      cfb: { record: { correct: 0, played: 0, pending: 22 } },
    }),
    draftRowV3({ state: 'none' }),
  ] });
};

// SUN, LIVE: a lineup is being played right now and outranks every result.
const SUN = () => {
  const now = nowCard({
    daily: { state: 'done', closesAt: ahead(6) },
    weekly: { state: 'locked', live: true, scored: 48.2, toPlay: 3, rank: 14, of: 61 },
    draft: { state: 'none' },
  });
  return week({ now, rows: [
    dailyRowV3({ pct: '96.1%', matched: '6 of 8', streak: 6, state: 'done', opensAt: ahead(6) }),
    weeklyRowV3({ rows: [], state: 'locked', live: true, scored: 48.2, toPlay: 3 }),
    pickemRowV3({ nfl: { record: { correct: 5, played: 7, pending: 4 } }, cfb: { record: { correct: 12, played: 20, pending: 5 } } }),
    draftRowV3({ state: 'none' }),
  ] });
};

// TUE, GRADED: the week settled, and nothing is open yet.
const TUE = () => {
  const now = nowCard({
    daily: { state: 'closed', closesAt: ahead(9) },
    weekly: { state: 'settled', settledAt: ago(2), week: 2, rank: 3, of: 61, score: 141.6 },
    draft: { state: 'none' },
  });
  return week({ now, rows: [
    dailyRowV3({ state: 'closed', streak: 6, opensAt: ahead(9) }),
    weeklyRowV3({ rows: [], state: 'settled', rank: 3, of: 61, score: 141.6 }),
    pickemRowV3({ nfl: { record: { correct: 21, played: 32, pending: 0 } }, cfb: null }),
    draftRowV3({ state: 'none' }),
  ] });
};

// ===========================================================================
test('THU pre-kick: the now card is the open board, and it is not marked done', () => {
  const c = screen({ v: { handle: 'sportsvyn_og', week: THU() }, chip: 'week' });
  const card = c.querySelector('.gv-now');
  assert.equal(card.dataset.kind, 'daily-open');
  assert.match(txt(card), /Tonight/);
  assert.match(txt(card), /The Daily/);
  assert.match(txt(card), /season revealed when you start/);
  assert.equal(card.className.includes('done'), false);
  assert.equal(card.getAttribute('href'), '/daily/board');
  assert.match(txt(card.querySelector('.gv-now-go')), /^Play$/);
});

test('FRI morning: the graded Daily leads, marked done, and carries its own score', () => {
  const c = screen({ v: { handle: 'x', week: FRI() }, chip: 'week' });
  const card = c.querySelector('.gv-now');
  assert.equal(card.dataset.kind, 'daily-graded');
  assert.match(txt(card), /Graded overnight/);
  assert.match(txt(card), /Your Daily · 99\.7%/);
  assert.equal(card.className.includes('done'), true);
  assert.match(txt(card.querySelector('.gv-now-go')), /See results/);
});

test('SUN live: a live lineup outranks the graded Daily on the same screen', () => {
  const c = screen({ v: { handle: 'x', week: SUN() }, chip: 'week' });
  const card = c.querySelector('.gv-now');
  assert.equal(card.dataset.kind, 'live');
  assert.match(txt(card), /Live now/);
  assert.match(txt(card), /Your Weekly · 48\.2/);
  assert.match(txt(card), /3 to play/);
  assert.match(txt(card), /14th of 61/);
  assert.equal(card.getAttribute('href'), '/weekly');
});

test('TUE graded: the settled week leads and the screen is a receipt', () => {
  const c = screen({ v: { handle: 'x', week: TUE() }, chip: 'week' });
  const card = c.querySelector('.gv-now');
  assert.equal(card.dataset.kind, 'week-graded');
  assert.match(txt(card), /Week 2 is in/);
  assert.match(txt(card), /3rd of 61/);
  assert.equal(card.className.includes('done'), true);
});

// ---- all four row states, per game ----------------------------------------
test('every game draws a row on every demo day, in the mock order', () => {
  for (const [name, day] of [['thu', THU], ['fri', FRI], ['sun', SUN], ['tue', TUE]]) {
    const c = screen({ v: { handle: 'x', week: day() }, chip: 'week' });
    assert.deepEqual(rows(c).map((r) => r.dataset.row), ['daily', 'weekly', 'pickem', 'draft'], name);
    assert.deepEqual(rows(c).map((r) => txt(r.querySelector('.gv-ic'))), ['D', 'W', 'P', 'R'], name);
    afterEachInline();
  }
});
function afterEachInline() {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); document.getElementById('root').innerHTML = '';
}

test('the Weekly row: set, then live, then final - three states, three tones', () => {
  const open = screen({ v: { week: THU() }, chip: 'week' });
  const w1 = rowBy(open, 'weekly');
  assert.match(txt(w1), /Allen · Walker · Gibbs \+3/);
  assert.deepEqual(cells(w1.querySelector('.gv-r')), ['6/6', 'set']);
  assert.equal(w1.querySelector('.gv-ic').className.includes('live'), false);
  afterEachInline();

  const live = screen({ v: { week: SUN() }, chip: 'week' });
  const w2 = rowBy(live, 'weekly');
  assert.equal(w2.querySelector('.gv-ic').className.includes('live'), true);
  assert.deepEqual(cells(w2.querySelector('.gv-r')), ['48.2', 'live']);
  afterEachInline();

  const done = screen({ v: { week: TUE() }, chip: 'week' });
  const w3 = rowBy(done, 'weekly');
  assert.equal(w3.querySelector('.gv-ic').className.includes('done'), true);
  assert.deepEqual(cells(w3.querySelector('.gv-r')), ['3rd', 'of 61']);
});

test("the Pick'em row ignores a live game: 1-0, not 1-15 and not 16-0", () => {
  const c = screen({ v: { week: FRI() }, chip: 'week' });
  const p = rowBy(c, 'pickem');
  assert.match(txt(p), /NFL 1-0/);
  assert.match(txt(p), /CFB 22 pending/);
  assert.equal(/1-15|16-0/.test(txt(p)), false);
});

test('the streak renders on the Daily row and in the now card, and nowhere else', () => {
  const c = screen({ v: { handle: 'og', week: THU() }, chip: 'week' });
  assert.match(txt(rowBy(c, 'daily')), /4-day streak/);
  assert.match(txt(c.querySelector('.gv-now')), /4-day streak/);
  // THE HEADER CHIP IS GONE (the addendum): the streak moved into the line.
  assert.equal(/streak/.test(txt(c.querySelector('.gv-top'))), false);
});

// ---- the chips -------------------------------------------------------------
test('four chips, the current one marked, each carrying the URL it claims', () => {
  const c = screen({ v: { handle: 'x', week: THU() }, chip: 'week' });
  assert.deepEqual(chips(c).map((x) => x.dataset.chip), ['week', 'boards', 'results', 'alerts']);
  assert.deepEqual(chips(c).map((x) => txt(x)), ['This week', 'Boards', 'Results', 'Alerts']);
  assert.deepEqual(chips(c).map((x) => x.className.includes('on')), [true, false, false, false]);
  assert.deepEqual(chips(c).map((x) => x.getAttribute('href')),
    ['/games', '/games?pane=boards', '/games?pane=results', '/games?pane=alerts']);
});

test('tapping Boards asks for ?pane=boards, and that URL renders the Boards pane', () => {
  const c = screen({ v: { handle: 'x', week: THU() }, chip: 'week' });
  const boards = chips(c).find((x) => x.dataset.chip === 'boards');
  click(boards);
  const url = boards.getAttribute('href');
  assert.equal(url, '/games?pane=boards');
  afterEachInline();

  // the page's own mapping, on the URL the tap produced
  const pane = new URL(url, 'https://sportsvyn.test').searchParams.get('pane');
  const chip = normalizeChip(pane);
  assert.equal(chip, 'boards');
  const c2 = screen({ chip, v: { handle: 'x', boards: { boardKey: 'weekly', boards: [
    { key: 'weekly', label: 'WEEKLY', rows: [
      { rank: 1, userId: 9, name: 'jakebutler', value: '152.4' },
      { rank: 2, userId: 4, name: 'The Chalk', value: '147.9', house: true, persona: 'chalk', method: 'the consensus' },
      { rank: 3, userId: 1, name: 'sportsvyn_og', value: '141.6', you: true },
    ], footer: '61 played · perfect six 168.3', note: 'Week 2 · final' },
    { key: 'pickem', label: "PICK'EM", rows: [] },
    { key: 'draft', label: 'DRAFT', rows: [] },
    { key: 'daily', label: 'DAILY', rows: [] },
  ] } } });
  assert.equal(c2.querySelectorAll('.gv-now').length, 0, 'the now card belongs to This week only');
  const trs = [...c2.querySelectorAll('.gv-tr')];
  assert.equal(trs.length, 4);                                  // three rows + the footer line
  assert.deepEqual(cells(trs[0]), ['1', 'jakebutler', '152.4']);
  assert.match(txt(trs[1]), /HOUSE/, 'a house row is marked as the house');
  assert.equal(trs[2].className.includes('you'), true);
  assert.match(txt(trs[3]), /61 played · perfect six 168\.3/);   // one cell, so prose is safe here
  assert.match(txt(c2.querySelector('.gv-foot')), /Week 2 · final/);
});

test("a board with no rows states why, rather than drawing a table of dashes", () => {
  const c = screen({ chip: 'boards', v: { boards: { boardKey: 'weekly', boards: [
    { key: 'weekly', label: 'WEEKLY', rows: [], empty: 'Entries are sealed until Week 2 locks' },
    { key: 'pickem', label: "PICK'EM", rows: [] },
  ] } } });
  assert.match(txt(c), /Entries are sealed until Week 2 locks/);
  assert.equal(c.querySelectorAll('.gv-sc').length, 0);
});

test('v2 ?pane= URLs all land on a chip: games->week, leaderboards->boards, history/answer->results', () => {
  assert.equal(normalizeChip('games'), 'week');
  assert.equal(normalizeChip('leaderboards'), 'boards');
  assert.equal(normalizeChip('history'), 'results');
  assert.equal(normalizeChip('answer'), 'results');
  assert.equal(normalizeChip(undefined), 'week');
  assert.equal(normalizeChip('nonsense'), 'week');
  // and each of those renders its pane without the others' payload
  for (const [pane, sel] of [['games', '.gv-now'], ['leaderboards', '.gv-lb'], ['history', '.gv-lb'], ['answer', '.gv-lb']]) {
    const chip = normalizeChip(pane);
    const v = chip === 'week' ? { week: THU() }
      : chip === 'boards' ? { boards: { boardKey: 'weekly', boards: [{ key: 'weekly', label: 'WEEKLY', rows: [], empty: 'none' }] } }
        : { results: { dailyDays: [], gradedWeek: [] } };
    const c = screen({ chip, v });
    assert.ok(c.querySelector(sel), `${pane} -> ${chip} rendered ${sel}`);
    afterEachInline();
  }
});

// ---- Results ---------------------------------------------------------------
test('Results: elapsed is derived once and printed on the day it belongs to', () => {
  const day = (ymd, dow, season, startedAt, completedAt, pct) => ({
    date: ymd, day: dow, season, pct, pctNum: Number(pct.replace('%', '')) / 100,
    elapsed: elapsedOf({ startedAt, completedAt }), matched: null, you: true,
  });
  const c = screen({ chip: 'results', v: { results: {
    dailyDays: [
      day('2026-09-17', 'Thu', 2024, '2026-09-17T23:00:00Z', '2026-09-17T23:02:43Z', '99.7%'),
      day('2026-09-16', 'Wed', 1983, '2026-09-16T23:00:00Z', '2026-09-16T23:01:34Z', '85.6%'),
    ],
    dailySummary: '2 played this week · avg 92.7% · best 99.7%',
    gradedWeek: [
      { key: 'weekly', mark: 'W', name: 'The Weekly', sub: '3 played', value: '1st · 137.5', href: '/weekly' },
      { key: 'daily', mark: 'D', name: 'The Daily', sub: '2 played · best 99.7%', value: 'avg 92.7%', href: '/daily' },
    ],
    gradedWeekLabel: 'WEEK 1',
  } } });
  const trs = [...c.querySelectorAll('.gv-lb')[0].querySelectorAll('.gv-tr')];
  assert.deepEqual(cells(trs[0]), ['Thu', '2024 season2:43', '99.7%']);
  assert.equal(txt(trs[0].querySelector('.gv-hn small')), '2:43');
  assert.deepEqual(cells(trs[1]), ['Wed', '1983 season1:34', '85.6%']);
  assert.equal(txt(trs[1].querySelector('.gv-hn small')), '1:34');
  assert.match(txt(trs[2]), /2 played this week · avg 92\.7% · best 99\.7%/);
  const graded = c.querySelectorAll('.gv-lb')[1];
  assert.match(txt(graded.querySelector('.gv-lbh')), /WEEK 1/);
  const grows = [...graded.querySelectorAll('.gv-tr')];
  assert.deepEqual(cells(grows[0]), ['W', 'The Weekly3 played', '1st · 137.5']);
  assert.deepEqual(cells(grows[1]), ['D', 'The Daily2 played · best 99.7%', 'avg 92.7%']);
});

test('Results with nothing played says so, and draws no graded block at all', () => {
  const c = screen({ chip: 'results', v: { results: { dailyDays: [], gradedWeek: [] } } });
  assert.match(txt(c), /Nothing played yet this week/);
  assert.equal(c.querySelectorAll('.gv-lb').length, 1);
});

// ---- Alerts ----------------------------------------------------------------
test('Alerts lists what is actually stored, and invents no per-game switches', () => {
  const c = screen({ chip: 'alerts', v: { alerts: {
    follows: [{ teamId: 3, name: 'Buffalo Bills', slug: 'buffalo-bills' }],
    matchAlerts: [{ matchId: 21555, label: 'Detroit Lions at Buffalo Bills', detail: 'kickoff · scores · final', href: '/match/nfl-w2-det-buf' }],
    nextAlertAt: null,
  } } });
  const alerts = [...c.querySelectorAll('.gv-alrow')];
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].getAttribute('href'), '/team/buffalo-bills');
  assert.equal(alerts[1].getAttribute('href'), '/match/nfl-w2-det-buf');
  // migration 082 has scope 'team' | 'match' and no per-game scope, so no
  // switch may appear that would write nowhere.
  assert.equal(c.querySelectorAll('input[type="checkbox"], .sw, button').length, 0);
});

test('Alerts with none set offers the two doors that exist', () => {
  const c = screen({ chip: 'alerts', v: { alerts: { follows: [], matchAlerts: [] } } });
  assert.match(txt(c), /No alerts set/);
  assert.match(txt(c), /Follow a team, or set alerts on a game from its page/);
});

// ---- signed out ------------------------------------------------------------
test('signed out: every door becomes the sign-in door, and nothing is faked', () => {
  const c = screen({ v: { handle: null, week: THU() }, chip: 'week', signedIn: false });
  const card = c.querySelector('.gv-now');
  assert.match(txt(card.querySelector('.gv-now-go')), /^Sign in$/);
  assert.equal(card.getAttribute('href'), '/signin?callbackUrl=%2Fdaily%2Fboard');
  for (const r of rows(c)) {
    assert.match(r.getAttribute('href'), /^\/signin\?callbackUrl=/, r.dataset.row);
  }
  // the identity chip carries no handle it does not have
  assert.equal(/@/.test(txt(c.querySelector('.gv-me'))), false);
});

test('signed out on Alerts: one door, and no list of somebody else’s alerts', () => {
  const c = screen({ chip: 'alerts', signedIn: false, v: { alerts: { follows: [], matchAlerts: [] } } });
  assert.match(txt(c), /Sign in to set them/);
  assert.equal(c.querySelector('.gv-alrow a').getAttribute('href'), '/signin?callbackUrl=%2Fgames%3Fpane%3Dalerts');
});

test('the SEASON tab draws the four season boards through the shared component', () => {
  const table = (rows) => ({ top: rows, self: null, through: null });
  const c = screen({ chip: 'boards', userId: 1, v: { boards: {
    boardKey: 'season',
    boards: [{ key: 'weekly', label: 'WEEKLY', rows: [] }, { key: 'season', label: 'SEASON', rows: [] }],
    sections: [
      { key: 'overall', name: 'The Daily — season', state: 'live',
        table: table([{ rank: 1, userId: 1, name: '@sportsvyn_og', value: '66.6' }]) },
      { key: 'draft', name: 'The Draft — season', state: 'pending', populatesLabel: 'First settle with Week 1' },
    ],
  } } });
  assert.match(txt(c), /The Daily — season/);
  assert.match(txt(c), /@sportsvyn_og/);
  // A PENDING BOARD SAYS WHEN IT POPULATES, and draws no empty table.
  assert.match(txt(c), /The Draft — season/);
  assert.match(txt(c), /First settle with Week 1/);
  assert.equal(c.querySelectorAll('.gv-season').length, 2);
  // and the tabs are still all there, so the reader can get back
  assert.deepEqual([...c.querySelectorAll('.gv-lbh a')].map((a) => txt(a)), ['WEEKLY', 'SEASON']);
});

test('the season boards are reachable at all: no season table is orphaned by the v2 removal', async () => {
  // v2's leaderboards pane was the ONLY home of the Weekly, Draft and Daily
  // season tables, and Rankings links back to /games for the full Pick'em
  // one. This asserts the reader still composes all four.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../lib/games/lobbyV3.js', import.meta.url), 'utf8');
  for (const call of ["overall(uid, 10)", "pickemTable(uid, { sport: null })", "gameSeasonTable('weekly', uid)", "gameSeasonTable('draft', uid)"]) {
    assert.ok(src.includes(call), `the season tab must still read ${call}`);
  }
});

test('the pct-ranked season boards print their OWN figures, not the Daily\'s', () => {
  // THE BUG THIS EXISTS FOR: sending all four season tables through
  // SeasonBoard - which reads points and days played - served Pick'em and the
  // Weekly as rows of blanks and "- pts". These three are ranked on an
  // average percentage and carry pct / correct / played / avgPct /
  // weeksPlayed.
  const c = screen({ chip: 'boards', userId: 1, v: { boards: {
    boardKey: 'season',
    boards: [{ key: 'season', label: 'SEASON', rows: [] }],
    sections: [
      { key: 'pickem', name: "Pick'em — season", state: 'live', table: {
        top: [
          { rank: 1, userId: 1, name: '@sportsvyn_og', pct: 94.7, correct: 36, played: 38 },
          // UNDER THE FLOOR: the note replaces the figure, and the rank is a dash.
          { rank: null, userId: 2, name: '@benson', note: '1 of 3 boards' },
        ],
        self: null,
      } },
      { key: 'weekly', name: 'The Weekly — season', state: 'live', table: {
        top: [{ rank: 1, userId: 9, name: '@jake', avgPct: 88.2, weeksPlayed: 4 }],
        self: { rank: null, userId: 1, name: '@sportsvyn_og', note: '1 of 3 weeks' },
      } },
    ],
  } } });
  const pk = [...c.querySelectorAll('.gv-season')[0].querySelectorAll('.gv-tr')];
  assert.deepEqual(cells(pk[0]), ['1', '@sportsvyn_og', '94.7% · 36/38']);
  assert.deepEqual(cells(pk[1]), ['-', '@benson', '1 of 3 boards']);
  const wk = [...c.querySelectorAll('.gv-season')[1].querySelectorAll('.gv-tr')];
  assert.deepEqual(cells(wk[0]), ['1', '@jake', '88.2% avg · 4 played']);
  // the viewer's own row is pinned below the top and marked
  assert.equal(wk[1].className.includes('you'), true);
  assert.deepEqual(cells(wk[1]), ['-', '@sportsvyn_og', '1 of 3 weeks']);
  // and no board printed a figure it does not have
  assert.equal(/ pts|undefined|NaN/.test(txt(c)), false);
});
