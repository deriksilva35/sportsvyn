// components/market/playerProps.test.mjs - the index and the card, PRESSED.
//
// THE HARD LINE IS A TEST, NOT A COMMENT. Sportsvyn does not sell picks, so
// "Higher", "Lower", "slip" and "stance" are asserted absent from both rendered
// screens rather than merely absent from the source today.
//
// AND THE NUMBERS ARE ASSERTED WHERE A READER SEES THEM. A hit rate of "1 of 3"
// is a different claim from "1/5", an as-offered price is not a percentage, and
// a DNP is not a zero - each is checked off the DOM, because every one of them
// is a place where a true number can be printed as a false sentence.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { install } from '../../lib/testing/nextResolve.mjs';
import { MARKET_STATS } from '../../lib/market/propStats.js';
import { MARKET_LABELS, HIT_RATE_MARKETS, cardSeries } from '../../lib/market/propsBoard.js';

install();

let React; let createRoot; let act; let PropsIndex; let PlayerPropCard; let dom;
const roots = new Set();

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/market' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  PropsIndex = (await import('./PropsIndex.js')).default;
  PlayerPropCard = (await import('./PlayerPropCard.js')).default;
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); document.getElementById('root').innerHTML = '';
});
after(() => { for (const r of roots) { try { r.unmount(); } catch { /* gone */ } } });

const KICK = '2026-09-19T17:00:00.000Z';
const row = (o = {}) => ({
  matchId: 1, matchStatus: 'scheduled', kickoffAt: KICK, leagueSlug: 'cfb',
  marketType: 'player_receptions', marketLabel: 'Recs', selection: 'Andrew Marsh',
  side: 'Over', line: 3.5, american: -110, impliedPct: 52.8, asOffered: false,
  moveProb: 0.4, numBooks: 3, position: 'WR', teamAbbr: 'MICH', playerId: 7, playerSlug: 'andrew-marsh',
  home: { abbr: 'MICH', name: 'Michigan' }, away: { abbr: 'UTEP', name: 'UTEP' },
  hit: { cleared: 1, games: 3 },
  chart: { points: [{ value: 5, week: 1 }, { value: 2, week: 2 }, { value: 3, week: 3 }], line: 3.5, season: 2026 },
  ...o,
});

function index(rows, state = {}, filtered = rows.length) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(PropsIndex, {
    rows, filtered,
    state: { league: 'all', team: 'all', pos: 'all', marketType: 'all', minHitPct: 0, sort: 'kickoff', ...state },
    hrefFor: () => '/market?tab=props', teams: ['MICH', 'UTEP'],
    stats: [['player_receptions', 'RECS']], cardHref: (r) => (r.playerSlug ? `/market/props/${r.playerSlug}?match=${r.matchId}` : null),
  })));
  return c;
}
const txt = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// THE INDEX
// ---------------------------------------------------------------------------

test('the index groups by game in kickoff order and counts what it shows', () => {
  const c = index([
    row({ matchId: 2, kickoffAt: '2026-09-19T23:00:00.000Z', home: { abbr: 'OU' }, away: { abbr: 'TEX' } }),
    row({ matchId: 1, kickoffAt: KICK }),
  ]);
  const heads = [...c.querySelectorAll('.px-gh b')].map(txt);
  assert.deepEqual(heads, ['UTEP at MICH', 'TEX at OU'], 'earliest kickoff first');
  assert.match(txt(c.querySelector('.px-sortrow .cnt')), /2 props/);
});

test('THE COUNT SAYS BOTH NUMBERS WHEN THE PAGE IS SHORT OF THE SLATE', () => {
  // filtered is the whole matching set; the index draws a page of it. A count
  // of 1172 over 400 drawn rows is a true number in a false place.
  const c = index([row(), row({ matchId: 2 })], {}, 1172);
  assert.match(txt(c.querySelector('.px-sortrow .cnt')), /2 of 1172 props/);

  const whole = index([row(), row({ matchId: 2 })]);
  assert.match(txt(whole.querySelector('.px-sortrow .cnt')), /^\s*2 props\s*$/,
    'and it stays a bare count when nothing was left off');
});

test('HIT IS n OF N WITH THE REAL N - never a fabricated five', () => {
  const c = index([row({ hit: { cleared: 1, games: 3 } })]);
  const hit = c.querySelector('.px-num.hit');
  assert.match(txt(hit), /1 of 3/);
  assert.equal(/of 5/.test(txt(hit)), false, 'the denominator is games played');
  assert.equal(/1\/5/.test(txt(c)), false);
});

test('AN AS-OFFERED ROW SHOWS THE PRICE AND SAYS SO - never a percentage', () => {
  const c = index([row({ asOffered: true, impliedPct: null, american: 300, marketType: 'player_anytime_td', line: null })]);
  const num = c.querySelector('.px-num');
  assert.match(txt(num), /\+300/);
  assert.match(txt(num), /as offered/);
  assert.equal(/%/.test(txt(num)), false, 'an un-de-vigged price is not a probability');
});

test('AN UNLINKED ROW GETS NO SPARKLINE, and keeps its columns', () => {
  const c = index([row({ playerId: null, playerSlug: null, chart: null, hit: null })]);
  assert.ok(c.querySelector('.px-spark.empty'), 'the slot is held, the bars are absent');
  assert.equal(c.querySelectorAll('.px-spark i').length, 0);
  assert.match(txt(c.querySelector('.px-num.hit')), /—/, 'and the hit cell is a dash, not a zero');
  assert.equal(c.querySelector('a.px-row'), null, 'an unlinked row is not a link');
});

test('AN ANYTIME ROW STILL DRAWS ITS BARS - the market is the line', () => {
  // A NULL selection_value IS NOT A MISSING LINE. Anytime and first TD price
  // the event itself, so the row prints no number - but the hit count beside
  // it was measured against 0.5, and a row that asserts "1 of 2" while holding
  // an empty sparkline slot is withholding the picture it just summarised.
  const c = index([row({
    marketType: 'player_anytime_td', line: null, asOffered: true, impliedPct: null,
    hit: { cleared: 1, games: 2 },
    chart: { points: [{ value: 1, week: 2 }, { value: 0, week: 1 }], line: 0.5, season: 2026, noun: 'TDs' },
  })]);
  assert.ok(c.querySelector('.px-spark') && !c.querySelector('.px-spark.empty'),
    'the anytime row draws bars against its implicit 0.5');
  assert.ok(c.querySelectorAll('.px-spark i').length > 0);
  assert.equal(/ 0\.5/.test(txt(c.querySelector('.px-who'))), false,
    'and the printed row still carries no line, because the market is the line');
});

test('a linked row opens the card at ?match=', () => {
  const c = index([row()]);
  const a = c.querySelector('a.px-row');
  assert.equal(a.getAttribute('href'), '/market/props/andrew-marsh?match=1');
});

test('THE HARD LINE, ON THE INDEX', () => {
  const c = index([row(), row({ asOffered: true, impliedPct: null })]);
  const t = txt(c).toLowerCase();
  for (const word of ['higher', 'lower', 'slip', 'stance', 'desk position', 'parlay', 'bet ', 'pick of']) {
    assert.equal(t.includes(word), false, `"${word}" must not appear on the index`);
  }
  assert.match(txt(c), /Sportsvyn does not sell picks/);
});

test('an empty index says what to do about it', () => {
  const c = index([]);
  assert.match(txt(c), /LOOSEN A FILTER/);
});

// ---------------------------------------------------------------------------
// THE CARD
// ---------------------------------------------------------------------------

const card = (over = {}) => ({
  player: { id: 7, slug: 'andrew-marsh', name: 'Andrew Marsh', position: 'WR', teamAbbr: 'MICH', seasonLine: null, ...(over.player ?? {}) },
  game: { id: 1, slug: 'cfb-2026-reg-w3-utep-michigan', leagueSlug: 'cfb', status: 'scheduled', kickoffAt: KICK, home: { abbr: 'MICH' }, away: { abbr: 'UTEP' }, ...(over.game ?? {}) },
  props: over.props ?? [{
    ...row(),
    series: {
      points: [{ value: 12, week: 12, season: 2025 }, { value: 5, week: 13, season: 2025 },
        { value: null, week: 1, season: 2026 }, { value: 2, week: 2, season: 2026 }, { value: 3, week: 3, season: 2026 }],
      line: 3.5, seasons: [2025, 2026], crossed: true, noun: 'recs',
    },
  }],
});

function render(c0) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(PlayerPropCard, { card: c0 })));
  return c;
}

test('the card names the player without inventing a depth chart', () => {
  const c = render(card());
  assert.match(txt(c.querySelector('.ppc-who h1')), /Marsh/);
  const line = txt(c.querySelector('.ppc-who p'));
  assert.match(line, /WR · MICH/);
  assert.equal(/RB1|WR1|TE1|QB1/.test(line), false, 'no positional rank exists to print');
});

test('A CROSSED SEASON IS LABELLED, and the two windows are reconciled', () => {
  const c = render(card());
  const cap = txt(c.querySelector('.ppc-cap'));
  assert.match(cap, /Last 5 played/);
  assert.match(cap, /2025 and 2026/, 'the crossing is stated, never silent');
  // the hit rate is one season and the chart is five games - the page says so
  assert.match(cap, /hit rate is/);
});

test('A DNP IS AN OUTLINE, NOT A ZERO - and is not in the denominator', () => {
  const c = render(card());
  const bars = [...c.querySelectorAll('.ppc-bar')];
  assert.equal(bars.length, 5);
  const dnp = bars.filter((b) => b.className.includes('dnp'));
  assert.equal(dnp.length, 1);
  assert.match(txt(dnp[0]), /—/, 'the value reads as absent');
  // the hit cell counts 3 games, not the 5 bars: valueOf drops the unmeasured
  assert.match(txt(c.querySelector('.ppc-cells .c.hit')), /1 of 3/);
});

test('the card strip returns to the game page', () => {
  const c = render(card());
  assert.equal(c.querySelector('a.ppc-strip').getAttribute('href'), '/cfb/game/cfb-2026-reg-w3-utep-michigan');
});

test('THE HARD LINE, ON THE CARD - and no stance block anywhere', () => {
  const c = render(card());
  const t = txt(c).toLowerCase();
  for (const word of ['higher', 'lower', 'slip', 'stance', 'desk position', 'no desk position']) {
    assert.equal(t.includes(word), false, `"${word}" must not appear on the card`);
  }
  assert.match(txt(c), /Sportsvyn does not sell picks/);
});

// ---------------------------------------------------------------------------
// THE CONTRACT BETWEEN THE SCREENS AND THE DATA
// ---------------------------------------------------------------------------

test('EVERY STAT CHIP MAPS TO A COLUMN WE HOLD - a new priced type fails here', () => {
  // The index's stat filter is built from the board's own market types. If the
  // feed starts pricing a type with no MARKET_STATS entry, that chip would
  // filter to rows that can never carry a hit rate - so the map is the source
  // of truth and this is the alarm.
  for (const key of Object.keys(MARKET_LABELS)) {
    assert.ok(MARKET_STATS[key], `${key} has a label but no stat mapping`);
  }
  // And every market we DO compute a hit rate for must have columns to read.
  for (const key of HIT_RATE_MARKETS) {
    assert.ok(MARKET_STATS[key]?.cols?.length, `${key} is in HIT_RATE_MARKETS with no columns`);
  }
  // The two scorer markets our logs cannot answer stay OUT, with the reason on
  // the constant: player_match_stats.goal_minutes is empty.
  assert.equal(HIT_RATE_MARKETS.has('player_first_goal_scorer'), false);
  assert.equal(HIT_RATE_MARKETS.has('player_last_goal_scorer'), false);
});

test('cardSeries crosses a season, keeps DNPs, and refuses without a line', () => {
  const logs = [
    { season: 2026, week: 3, rec: 3 }, { season: 2026, week: 2, rec: 2 },
    { season: 2026, week: 1, rec: null }, { season: 2025, week: 13, rec: 5 },
    { season: 2025, week: 12, rec: 12 }, { season: 2025, week: 11, rec: 9 },
  ];
  const s = cardSeries(logs, 'player_receptions', 3.5);
  assert.equal(s.points.length, 5, 'the newest five');
  assert.deepEqual(s.points.map((p) => p.value), [12, 5, null, 2, 3], 'oldest first, DNP intact');
  assert.deepEqual(s.seasons, [2025, 2026]);
  assert.equal(s.crossed, true);
  // NO LINE, NO CHART: a bar chart with no threshold is a chart of nothing in
  // particular on a surface whose whole subject is a price.
  assert.equal(cardSeries(logs, 'player_receptions', null), null);
  assert.equal(cardSeries([], 'player_receptions', 3.5), null);
});
