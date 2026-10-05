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
import { elapsedOf } from '../../lib/games/v3Rows.js';
import { playLobbyOpen, isMoveCandidate } from '../../lib/games/playLobby.js';
import { readFileSync } from 'node:fs';
import { PLAY_REGISTRY, weeklyItem, pickemItem, draftItem, octoberItem, runItem, nbaPickemItem, sixItem, dailyItem } from '../../lib/games/playRegistry.js';
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
const chips = (c) => [...c.querySelectorAll('.gv-chip')];
const click = (node) => act(() => {
  node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
});

// ===========================================================================
// THE PLAY LOBBY (thu-38 + fri-1) - the default screen, from the real shapers
// ===========================================================================
// THE v3 "This week" PANE IS RETIRED, and its eight tests with it (the now
// card on four demo days, the four football rows, the streak on the Daily row).
// The approved Play-tab canvas replaced that screen: the facts those rows drew
// are the registry's items now (lib/games/playRegistry.test.mjs pins their
// words), and these tests press the new screen the way the old ones pressed
// the old one. nowCard.js and v3Rows.js keep their own pure tests.

const E = (key) => PLAY_REGISTRY.find((e) => e.key === key);
const PLAY = ({ signedIn = true, open = 'all', leagues = [] } = {}) => {
  const now = new Date();
  const o = { signedIn, now };
  const items = [
    octoberItem(E('mlb-october'), { contest: { board: [{ kickoff_at: ahead(2) }, { kickoff_at: ahead(5) }], meta: { games: 2 } }, filled: signedIn ? 2 : 0, size: 5 }, o),
    // Signed out the Draft is a "Sign in to draft" row, never a move (fri-2).
    draftItem(E('nfl-draft'), { home: { state: 'drafting', week: 4, locksAt: ahead(2.5) }, round: 4 }, o),
    weeklyItem(E('nfl-weekly'), { home: { state: 'play', week: 4, locksAt: ahead(60) } }, o),
    pickemItem(E('nfl-pickem'), { card: { total: 16, picked: 16, pickable: 13, pickedOpen: 13, nextKickoff: ahead(8), displayWeek: 4 } }, o),
    runItem(E('mlb-run'), { contest: { meta: { label: 'Wild Card' } }, next: null, filled: 9, size: 9 }, o),
    nbaPickemItem(E('nba-pickem'), { st: null, plan: { opensAt: ahead(19 * 24), board: [{}, {}, {}] } }, o),
    sixItem(E('nba-six'), { st: null, plan: { opensAt: ahead(19 * 24) } }, o),
    pickemItem(E('cfb-pickem'), { card: null, plan: { opensAt: ahead(30) } }, o),
    dailyItem(E('daily'), { state: signedIn ? 'play' : 'signed-out', closesAt: ahead(10) }, o),
  ].filter(Boolean);
  const view = playLobbyOpen(items, { now, signedIn, open, nextGameBySport: { nfl: ahead(30), mlb: ahead(2), cfb: ahead(30) } });
  return {
    handle: signedIn ? 'sportsvyn_og' : null, chip: 'week',
    play: { ...view, now: now.toISOString(), tz: 'America/Los_Angeles', leagues,
      practice: [{ key: 'mock', title: 'Mock draft', href: '/sim', sub: '12 teams · 8 rounds · any seat' },
        { key: 'league', title: 'Start a league', href: '/leagues', sub: 'Your rules, your people' }],
      foot: 'Every game scores on its own · times in your zone' },
  };
};
function afterEachInline() {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); document.getElementById('root').innerHTML = '';
}
const cards = (c) => [...c.querySelectorAll('.pl-card')];
const prow = (c, key) => c.querySelector(`.pl-row[data-row="${key}"]`);

test('PLAY: the top says PLAY, the date and the zone, once', () => {
  const c = screen({ v: PLAY(), chip: 'week' });
  assert.equal(txt(c.querySelector('.pl-top h1')), 'Play');
  assert.match(txt(c.querySelector('.pl-zone')), /^\w{3} \d{1,2} \w{3} · \w+/);
  assert.equal(c.querySelectorAll('.gv-now').length, 0, 'the now card is retired');
});

test('YOUR MOVE: only what the reader can act on, soonest lock first, LOCKS SOON under 3h, CTA as drawn', () => {
  const c = screen({ v: PLAY(), chip: 'week' });
  assert.deepEqual(cards(c).map((x) => x.dataset.key), ['mlb-october', 'nfl-draft', 'daily', 'nfl-weekly'],
    "Pick'em is complete, the Run is locked, the NBA and CFB games are not open");
  assert.deepEqual(cards(c).map((x) => Boolean(x.querySelector('.pl-soon'))), [true, true, false, false]);
  assert.deepEqual(cards(c).map((x) => txt(x.querySelector('.pl-cta'))), ['FINISH CARD', 'BACK TO ROOM', 'PLAY TODAY', 'SET YOUR SIX']);
  assert.match(txt(c.querySelector('.pl-move .pl-sh h3')), /Your move · 4/);
  const bar = cards(c)[0].querySelector('.pl-bar');
  assert.equal(bar.children.length, 5, 'one segment per slot');
  assert.equal(bar.querySelectorAll('.on').length, 2, 'two filled');
  // THE WEEKDAY IS OPTIONAL: the lock is ahead(2) of the REAL clock, so in the
  // last two hours of a day it lands tomorrow and the label rightly names the
  // day ("Sat 12:46 AM"). Red on 3 Oct at 02:46Z for exactly that reason.
  assert.match(txt(cards(c)[0].querySelector('.pl-card-s')), /^2 of 5 picked · next lock (?:[A-Z][a-z]{2} )?\d{1,2}:\d{2} [AP]M$/, 'the time is a clock reading, no zone repeated');
  assert.equal(cards(c)[1].getAttribute('href'), '/draft');
});

// ===========================================================================
// THE COLLAPSED CARDS (sun-19) - one card per sport, closed by default
// ===========================================================================
const scards = (c) => [...c.querySelectorAll('.pl-sc')];
const head = (c, id) => c.querySelector(`.pl-sc[data-group="${id}"] > .pl-sc-h`);
const openIds = (c) => scards(c).filter((x) => x.querySelector('.pl-sc-h').getAttribute('aria-expanded') === 'true').map((x) => x.dataset.group);
const chipBy = (c, id) => c.querySelector(`.pl-chip[data-chip="${id}"]`);

test('CHIPS: ALL + each sport with a game in 14 days, ALL pressed, each a ?sport= URL, 44px pinned', () => {
  const c = screen({ v: PLAY(), chip: 'week' });
  const ch = [...c.querySelectorAll('.pl-chip')];
  assert.deepEqual(ch.map((x) => txt(x)), ['ALL', 'NFL', 'MLB', 'CFB']);
  assert.deepEqual(ch.map((x) => x.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false']);
  assert.deepEqual(ch.map((x) => x.className.includes(' on')), [true, false, false, false]);
  assert.deepEqual(ch.map((x) => x.getAttribute('href')), ['/games', '/games?sport=nfl', '/games?sport=mlb', '/games?sport=cfb'],
    'a real link: cmd-click and no-JS land on the server-rendered open card');
  assert.equal(c.querySelectorAll('.gv-chips').length, 0, 'the pane chips are not on the lobby');
});

test('CARDS: every group is one card, COLLAPSED by default, soonest lock first, then ALL SPORTS, out of season dimmed and last', () => {
  const c = screen({ v: PLAY(), chip: 'week' });
  assert.deepEqual(scards(c).map((g) => g.dataset.group), ['mlb', 'nfl', 'cfb', 'all-sports', 'nba'],
    'MLB locks first; CFB has only a door; then the cross-sport card; NBA is out of season, last');
  assert.deepEqual(openIds(c), [], 'nothing open on ALL');
  for (const k of scards(c)) {
    const h = k.querySelector('.pl-sc-h');
    assert.equal(h.tagName, 'BUTTON', 'a real button');
    assert.equal(h.getAttribute('type'), 'button');
    assert.equal(h.getAttribute('aria-expanded'), 'false');
    const rows = c.querySelector(`#${h.getAttribute('aria-controls')}`);
    assert.ok(rows, 'aria-controls names the rows');
    assert.equal(rows.hidden, true, 'a closed card hides its rows');
  }
  assert.deepEqual(scards(c).map((k) => txt(k.querySelector('.pl-sc-name'))), ['MLB', 'NFL', 'CFB', 'ALL SPORTS', 'NBA']);
  assert.deepEqual(scards(c).map((k) => txt(k.querySelector('.pl-sc-n'))), ['2 games', '3 games', '1 game', '1 game', '2 games']);
  const nba = c.querySelector('.pl-sc[data-group="nba"]');
  assert.ok(nba.className.includes('dim'), 'out of season: dimmed');
  assert.match(txt(nba.querySelector('.pl-sc-sum')), /^Opens \w{3} \d{1,2} \w{3}$/, 'with its open date');
  assert.ok(!c.querySelector('.pl-sc[data-group="nfl"]').className.includes('dim'));
});

test('THE SUMMARY is built from the rows it carries: progress, door, lock state, then the next lock', () => {
  const c = screen({ v: PLAY(), chip: 'week' });
  const sum = (id) => txt(c.querySelector(`.pl-sc[data-group="${id}"] .pl-sc-sum`));
  assert.match(sum('nfl'), /^The Draft · The Weekly · 0 of 6 set · Pick'em · 16 of 16 picked · next lock (?:[A-Z][a-z]{2} )?\d{1,2}:\d{2} [AP]M$/);
  assert.match(sum('mlb'), /^October · 2 of 5 picked · The Run locked · next lock /);
  assert.match(sum('cfb'), /^Pick'em opens \w{3} \d{1,2} \w{3}$/);
  assert.match(sum('all-sports'), /^Today's board is open · closes (?:midnight|(?:[A-Z][a-z]{2} )?\d{1,2}:\d{2} [AP]M)$/);
});

test('YOUR MOVE TAG: on a card exactly when one of its rows is a YOUR MOVE card (the shared predicate)', () => {
  for (const signedIn of [true, false]) {
    const v = PLAY({ signedIn });
    const c = screen({ v, chip: 'week', signedIn });
    const moveKeys = new Set(cards(c).map((x) => x.dataset.key));
    for (const k of scards(c)) {
      const want = v.play.cards.find((x) => x.id === k.dataset.group).rows.some((r) => moveKeys.has(r.key));
      assert.equal(Boolean(k.querySelector('.pl-sc-move')), want, `${k.dataset.group} signed ${signedIn ? 'in' : 'out'}`);
    }
    // and the YOUR MOVE cards are exactly the items the predicate admits (signed out: the first three)
    const now = new Date(v.play.now);
    const admitted = v.play.cards.flatMap((x) => x.rows).filter((r) => isMoveCandidate(r, { now, signedIn })).map((r) => r.key);
    for (const key of moveKeys) assert.ok(admitted.includes(key), key);
    afterEachInline();
  }
  const c = screen({ v: PLAY(), chip: 'week' });
  assert.deepEqual(scards(c).filter((k) => k.querySelector('.pl-sc-move')).map((k) => k.dataset.group), ['mlb', 'nfl', 'all-sports'],
    "CFB and NBA have nothing open; NFL's Draft and Weekly are moves");
  assert.equal(txt(c.querySelector('.pl-sc-move')), 'YOUR MOVE');
});

test('?sport= OPENS THAT CARD in the server render, and only that card; YOUR MOVE is not filtered', () => {
  const c = screen({ v: PLAY({ open: 'nfl' }), chip: 'week' });
  assert.deepEqual(openIds(c), ['nfl']);
  assert.equal(c.querySelector('#pl-card-nfl-rows').hidden, false);
  assert.deepEqual([...c.querySelectorAll('#pl-card-nfl-rows .pl-row')].map((r) => r.dataset.row), ['nfl-draft', 'nfl-weekly', 'nfl-pickem'], 'today\'s rows, in their order');
  assert.equal(chipBy(c, 'nfl').getAttribute('aria-pressed'), 'true');
  assert.equal(chipBy(c, 'all').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(cards(c).map((x) => x.dataset.key), ['mlb-october', 'nfl-draft', 'daily', 'nfl-weekly'],
    'every sport\'s moves stay on top');
  assert.deepEqual(scards(c).map((g) => g.dataset.group), ['mlb', 'nfl', 'cfb', 'all-sports', 'nba'], 'every card stays');
  afterEachInline();
  const nba = screen({ v: PLAY({ open: 'nba' }), chip: 'week' });
  assert.deepEqual(openIds(nba), ['nba'], 'an out-of-season card opens too');
  assert.ok(chipBy(nba, 'nba'), 'and the sport the reader is on keeps its chip');
  assert.deepEqual([...nba.querySelectorAll('#pl-card-nba-rows .pl-row')].map((r) => r.dataset.phase), ['upcoming', 'upcoming']);
  afterEachInline();
  assert.deepEqual(openIds(screen({ v: PLAY({ open: 'bogus' }), chip: 'week' })), [], 'an unknown ?sport= is ALL');
});

test('ONE OPEN AT A TIME: a header tap opens in place and closes the other; a second tap closes; the URL follows', () => {
  window.history.replaceState(null, '', '/games');
  const c = screen({ v: PLAY(), chip: 'week' });
  click(head(c, 'nfl'));
  assert.deepEqual(openIds(c), ['nfl']);
  assert.equal(window.location.pathname + window.location.search, '/games?sport=nfl');
  click(head(c, 'mlb'));
  assert.deepEqual(openIds(c), ['mlb'], 'opening MLB closed NFL');
  assert.equal(c.querySelector('#pl-card-nfl-rows').hidden, true);
  assert.equal(window.location.search, '?sport=mlb');
  assert.equal(chipBy(c, 'mlb').getAttribute('aria-pressed'), 'true');
  click(head(c, 'mlb'));
  assert.deepEqual(openIds(c), []);
  assert.equal(window.location.search, '', 'closed: back to ALL');
  click(head(c, 'all-sports'));
  assert.equal(window.location.search, '?sport=all-sports');
});

test('CHIP TOGGLE: a chip opens its card; the open chip again returns to ALL; ALL closes everything; Back restores', () => {
  window.history.replaceState(null, '', '/games');
  const c = screen({ v: PLAY(), chip: 'week' });
  click(chipBy(c, 'cfb'));
  assert.deepEqual(openIds(c), ['cfb']);
  assert.equal(window.location.search, '?sport=cfb');
  click(chipBy(c, 'cfb'));
  assert.deepEqual(openIds(c), [], 'the open chip tapped again');
  assert.equal(chipBy(c, 'all').getAttribute('aria-pressed'), 'true');
  assert.equal(window.location.search, '');
  click(chipBy(c, 'nfl'));
  click(chipBy(c, 'all'));
  assert.deepEqual(openIds(c), [], 'ALL = everything collapsed');
  // BACK: the address bar moves first, then popstate - the card follows it
  window.history.replaceState(null, '', '/games?sport=nfl');
  act(() => { window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
  assert.deepEqual(openIds(c), ['nfl']);
  window.history.replaceState(null, '', '/games');
  act(() => { window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
  assert.deepEqual(openIds(c), []);
});

test('CLOSES: "midnight" only when the close IS 00:00 in the viewer\'s zone, else the clock reading', async () => {
  const { closesLabel, isMidnightIn } = await import('./PlayCloses.js');
  const etMidnight = '2026-10-05T04:00:00.000Z'; // 00:00 EDT on 5 Oct
  const now = '2026-10-04T19:00:00.000Z';
  assert.equal(isMidnightIn(etMidnight, 'America/New_York'), true);
  assert.equal(closesLabel(etMidnight, { now, tz: 'America/New_York' }), 'midnight');
  assert.equal(closesLabel(etMidnight, { now, tz: 'America/Los_Angeles' }), '9:00 PM', 'the same instant is 9 PM in Pacific');
  assert.equal(closesLabel(etMidnight, { now, tz: null }), 'midnight', 'null is the ET fallback the server paints');
});

test('44px TARGETS are pinned in CSS: the card header and the sport chips', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const pc = strip(readFileSync(new URL('./playCollapse.css', import.meta.url), 'utf8'));
  const pl = strip(readFileSync(new URL('./play.css', import.meta.url), 'utf8'));
  assert.match(pc, /\.pl-sc-h \{[^}]*min-height: 44px/);
  assert.match(pl, /\.gv-chip\.pl-chip \{[^}]*min-height: 44px/);
  assert.match(pc, /\.pl-sc\.dim \{[^}]*opacity: \.6/, 'out of season is dimmed');
  assert.doesNotMatch(pc, /#[0-9a-fA-F]{3,8}\b/, 'tokens only - no mock hexes');
});

test('YOUR LEAGUES: listed by name when the reader has any; PRACTICE always', () => {
  const none = screen({ v: PLAY(), chip: 'week' });
  assert.equal(none.querySelectorAll('.pl-league').length, 0, 'no league, no section');
  assert.deepEqual([...none.querySelectorAll('.pl-tile b')].map(txt), ['Mock draft', 'Start a league']);
  afterEachInline();
  const two = screen({ v: PLAY({ leagues: [{ id: 3, name: 'Sunday Crew', href: '/leagues/3', sub: '6 members' }] }), chip: 'week' });
  const l = two.querySelector('.pl-league');
  assert.equal(l.getAttribute('href'), '/leagues/3');
  assert.match(txt(l), /Sunday Crew/);
});

test('the three panes stay one tap away from the lobby, and their chips lead back to Play', () => {
  const c = screen({ v: PLAY(), chip: 'week' });
  assert.deepEqual([...c.querySelectorAll('.pl-panes a')].map((a) => a.getAttribute('href')),
    ['/games?pane=boards', '/games?pane=results', '/games?pane=alerts']);
  afterEachInline();
  const b = screen({ chip: 'boards', v: { boards: { boardKey: 'weekly', boards: [{ key: 'weekly', label: 'WEEKLY', rows: [], empty: 'none' }] } } });
  assert.deepEqual(chips(b).map((x) => x.dataset.chip), ['week', 'boards', 'results', 'alerts']);
  assert.deepEqual(chips(b).map((x) => txt(x)), ['Play', 'Boards', 'Results', 'Alerts']);
  assert.deepEqual(chips(b).map((x) => x.className.includes('on')), [false, true, false, false]);
  assert.deepEqual(chips(b).map((x) => x.getAttribute('href')),
    ['/games', '/games?pane=boards', '/games?pane=results', '/games?pane=alerts']);
});

test('tapping Boards asks for ?pane=boards, and that URL renders the Boards pane', () => {
  const c = screen({ chip: 'results', v: { handle: 'x', results: { dailyDays: [], gradedWeek: [] } } });
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
  assert.equal(c2.querySelectorAll('.pl-card').length, 0, 'YOUR MOVE belongs to the Play lobby only');
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
  for (const [pane, sel] of [['games', '.pl-chips'], ['leaderboards', '.gv-lb'], ['history', '.gv-lb'], ['answer', '.gv-lb']]) {
    const chip = normalizeChip(pane);
    const v = chip === 'week' ? PLAY()
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
test('signed out: every door becomes the sign-in door, and YOUR MOVE is the three soonest-locking games', () => {
  const c = screen({ v: PLAY({ signedIn: false }), chip: 'week', signedIn: false });
  assert.deepEqual(cards(c).map((x) => x.dataset.key), ['mlb-october', 'nfl-pickem', 'daily'],
    'three, open, by lock - the Weekly (60h) is the fourth and is left out');
  for (const k of cards(c)) {
    assert.match(k.getAttribute('href'), /^\/signin\?callbackUrl=/, k.dataset.key);
    assert.equal(txt(k.querySelector('.pl-cta')), 'SIGN IN TO PLAY');
    assert.equal(k.querySelector('.pl-bar'), null, 'no progress is faked');
  }
  for (const r of c.querySelectorAll('.pl-row')) assert.match(r.getAttribute('href'), /^\/signin\?callbackUrl=/, r.dataset.row);
  const draft = prow(c, 'nfl-draft');
  assert.match(txt(draft.querySelector('.pl-t small')), /^Sign in to draft$/, 'the Draft row shows signed out (fri-2)');
  assert.equal(draft.getAttribute('href'), '/signin?callbackUrl=%2Fdraft', 'sign in, then the room');
  assert.equal(c.querySelectorAll('.pl-league').length, 0);
  assert.ok(c.querySelector('.lob-stranger'), 'the free-to-play lines');
  assert.equal(c.querySelector('.gv-me'), null);
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

test('THE HANDLE IS DRAWN ONCE: no identity chip next to PLAY, signed in or out (the header carries it)', () => {
  for (const signedIn of [true, false]) {
    const c = screen({ v: { ...PLAY({ signedIn }), handle: 'ovfsentinelx150' }, chip: 'week', signedIn });
    assert.equal(c.querySelector('.gv-me'), null);
    assert.equal(/@ovfsentinelx150/.test(txt(c.querySelector('.pl-top'))), false);
    afterEachInline();
  }
});

test('THE LOBBY HAS A DEFINITE WIDTH: .lob is width 100%, not shrink-to-fit (27 Sep: 411 px on a 375 px phone)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../app/games/games.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const lob = /\.lob \{([^}]*)\}/.exec(css)[1];
  assert.match(lob, /width: 100%;/);
  assert.match(lob, /max-width: 960px; margin: 0 auto;/);
  assert.doesNotMatch(css, /body\s*\{[^}]*overflow-x:\s*hidden/, 'no blanket overflow clip on the page');
});
