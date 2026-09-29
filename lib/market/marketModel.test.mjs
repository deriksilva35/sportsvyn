// lib/market/marketModel.test.mjs - FILTER PARITY for static /market.
//
// The board used to be filtered on the server, per request: the league went
// into propsBoardRows' WHERE and propsBoardFrom ran over what came back. It is
// now filtered in the browser over EVERY league's rows. This pins, for five
// representative query strings, that the client model returns the rows the
// server path returned - and pins BOTH against literal row lists worked out by
// hand from the fixture below, so neither side is merely compared to itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketModel, parseMarketUrl, spFrom } from './marketModel.js';
import { propsBoardFrom } from './propsShape.js';
import { MARKET_LEAGUES } from './marketShape.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const T = (abbr, name = abbr) => ({ abbr, name });
const KC_BUF = { matchId: 1, home: T('BUF', 'Bills'), away: T('KC', 'Chiefs') };
const DAL_PHI = { matchId: 2, home: T('PHI', 'Eagles'), away: T('DAL', 'Cowboys') };
const UGA_BAMA = { matchId: 3, home: T('BAMA', 'Alabama'), away: T('UGA', 'Georgia') };
const ARS_CHE = { matchId: 4, home: T('CHE', 'Chelsea'), away: T('ARS', 'Arsenal') };
const row = (selection, leagueSlug, game, marketType, group, moveProb, impliedPct, position, hit, over = {}) => ({
  ...game, selection, leagueSlug, marketType, group, moveProb, impliedPct, position, hit,
  marketRowLabel: marketType, line: 1.5, american: -110, avg: null, onBoard: false,
  kickoffAt: '2026-10-04T17:00:00.000Z', matchStatus: 'scheduled', ...over,
});
// letter = the id the literals below use
const PROPS = [
  row('A Pat Mahomes', 'nfl', KC_BUF, 'player_pass_yds', 'pass', 0.03, 55, 'QB', { cleared: 6, games: 10 }),
  row('B Isiah Pacheco', 'nfl', KC_BUF, 'player_rush_yds', 'rush', null, 48, 'RB', { cleared: 3, games: 10 }),
  row('C Dak Prescott', 'nfl', DAL_PHI, 'player_pass_yds', 'pass', -0.05, 51, 'QB', null),
  row('D DeVonta Smith', 'nfl', DAL_PHI, 'player_reception_yds', 'rec', 0.01, 50, 'WR', { cleared: 7, games: 10 }),
  row('E Carson Beck', 'cfb', UGA_BAMA, 'player_pass_yds', 'pass', 0.02, 60, 'QB', { cleared: 5, games: 10 }, { onBoard: true }),
  row('F Ryan Smith', 'cfb', UGA_BAMA, 'player_reception_yds', 'rec', null, 40, 'WR', { cleared: 4, games: 10 }),
  row('G Cole Palmer', 'epl', ARS_CHE, 'player_goal_scorer_anytime', 'scorer', 0.04, 35, 'M', { cleared: 5, games: 10 }),
  row('H Bukayo Saka', 'epl', ARS_CHE, 'player_shots', 'shots', 0, 45, 'F', null),
];

const sel = (s) => ({ label: s, american: -110, impliedPct: 50, moveProb: null, value: null });
const card = (leagueSlug, matchId, move = null) => ({
  leagueSlug, matchId, matchStatus: 'scheduled', kickoffAt: '2026-10-04T17:00:00.000Z', threeWay: false,
  home: { abbreviation: 'H' }, away: { abbreviation: 'A' },
  h2h: [{ ...sel('Home'), moveProb: move }, sel('Away')], spread: [], total: [],
});
const DATA = {
  slate: [['nfl', [card('nfl', 11, 0.02), card('nfl', 12)]], ['cfb', [card('cfb', 21)]], ['epl', [card('epl', 31, -0.01)]]],
  futures: [], books: [['nfl', 7]], snapAt: null, boardIds: [21],
  propsRows: PROPS, propsGames: [],
};

// THE OLD SERVER PATH, reproduced from what it did: propsBoardRows(league)
// selected `l.slug = ANY(leagues)` where leagues was [league] for a real
// league and every league otherwise, then cachedPropsBoard ran propsBoardFrom.
function oldServerRows(qs) {
  const { boardState } = parseMarketUrl(spFrom(new URLSearchParams(qs)));
  const leagues = MARKET_LEAGUES.includes(boardState.league) ? [boardState.league] : MARKET_LEAGUES;
  const fromSql = PROPS.filter((r) => leagues.includes(r.leagueSlug));
  return propsBoardFrom(fromSql, boardState);
}
const clientRows = (qs) => marketModel(DATA, spFrom(new URLSearchParams(qs))).board;
const ids = (b) => b.rows.map((r) => r.selection[0]);

const CASES = [
  // The index's unmarked sort is 'kickoff', which is not a table column, so
  // the sorter's default applies: biggest absolute move first, NULL last.
  ['tab=props&f=nfl', ['C', 'A', 'D', 'B'], 4],
  ['tab=props&f=cfb&view=table&sort=implied&dir=asc', ['F', 'E'], 2],
  ['tab=props&team=KC&mkt=player_pass_yds', ['A'], 1],
  // Movers: a NULL move is unobserved and a 0 did not move - both out.
  ['tab=props&movers=1&view=table', ['C', 'G', 'A', 'E', 'D'], 5],
  // q matches two Smiths; pos keeps both WRs; hit >= 50 keeps 7/10, drops 4/10.
  // `total` is before position and hit rate, which is what it always meant.
  ['tab=props&q=smith&pos=WR&hit=50', ['D'], 2],
];

for (const [qs, want, total] of CASES) {
  test(`PARITY ?${qs}`, () => {
    const oldB = oldServerRows(qs);
    const newB = clientRows(qs);
    assert.deepEqual(ids(oldB), want, 'the old server path, against the hand-worked list');
    assert.deepEqual(ids(newB), want, 'the client model, against the same list');
    assert.equal(oldB.total, total);
    assert.equal(newB.total, total);
    assert.equal(newB.filtered, oldB.filtered);
  });
}

test('the LINES board narrows in the client too: movers, and a game', () => {
  const m = marketModel(DATA, { f: 'movers' });
  assert.deepEqual([...m.shown.entries()].map(([k, l]) => [k, l.map((c) => c.matchId)]),
    [['cfb', []], ['nfl', [11]], ['epl', [31]]]);
  assert.equal(m.total, 2);
  const g = marketModel(DATA, { game: '21' });
  assert.deepEqual(g.cardBands, ['cfb'], 'a chosen game keeps only its own band');
});

test('the model never mutates the data it was handed', () => {
  const before = JSON.stringify(DATA);
  marketModel(DATA, { tab: 'props', sort: 'implied' });
  marketModel(DATA, {});
  assert.equal(JSON.stringify(DATA), before);
});

test('ONE URL BUILDER: the client board makes no /market URL of its own', () => {
  const C = src('components/market/MarketClient.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(C, /marketHref\(urlState, patch\)/, 'hrefs come from marketHref');
  assert.doesNotMatch(C, /['"`]\/market\?/, 'no hand-built /market? string');
  assert.doesNotMatch(C, /new URLSearchParams|\.toString\(\)\s*\}/, 'no second serialiser');
  assert.doesNotMatch(C, /from '@\/lib\/(db|market\/(reads|propsBoard|propStats|cachedReads))'/,
    'nothing that imports the database driver reaches the browser');
});

test('STATIC: the page reads no request, and the 404 no session', () => {
  const P = src('app/market/page.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(P, /export const dynamic = 'force-static';/);
  assert.match(P, /export const revalidate = 60;/);
  assert.doesNotMatch(P, /resolveShellMode|GlobalHeaderServer|searchParams|cookies\(|auth\(/);
  const NF = src('app/not-found.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(NF, /GlobalHeaderServer|auth\(|cookies\(/);
  // tue-3: the arcade nav flag is an environment read (lib/brand/theme.js), not a request read.
  assert.match(NF, /<GlobalHeaderClient arcade=\{arcadeOn\(\)\} \/>/);
});

test('/market carries the site footer, and the league wearings do not', () => {
  const P = src('app/market/page.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(P, /import SiteFooter from '@\/components\/SiteFooter';/);
  const page = P.slice(P.indexOf('export default async function MarketPage'));
  assert.match(page, /<SiteFooter \/>/);
  const view = P.slice(P.indexOf('export async function MarketView'), P.indexOf('export default async function MarketPage'));
  assert.doesNotMatch(view, /SiteFooter/, 'MarketView is shared with /nfl/market and /cfb/market');
  const F = src('components/SiteFooter.js');
  assert.doesNotMatch(F, /from '@\/auth'|cookies\(|headers\(/, 'the footer stays static-safe');
});
