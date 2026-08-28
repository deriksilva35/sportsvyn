// lib/market/reads.test.mjs - /market's reads, and the three laws Phase A must
// not break. Source-level assertions: these are facts about how the SQL is
// written and what the page renders, and both are things a passing runtime test
// against today's data would happily miss.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKET_LEAGUES, THREE_WAY, hasMovement } from './reads.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// COMMENTS STRIPPED BEFORE EVERY SCAN. Both files below EXPLAIN these rules in
// prose, naming the exact strings the assertions forbid - so a scan of the raw
// text finds the explanation and reports the defect it warns against. That trap
// has fired five times on this repo; it does not get to fire a sixth.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const READS = strip(src('lib/market/reads.js'));
const PAGE = strip(src('app/market/page.js'));

// ---------------------------------------------------------------------------
// LAW 1 - league scoping never touches league_id on a match-scope read
// ---------------------------------------------------------------------------
//
// odds_markets.league_id IS NULL ON EVERY MATCH-SCOPE ROW; it is populated only
// on futures, which have no match_id. Grouping match markets by league_id does
// not throw and does not return zero rows - it returns ONE bucket named (null)
// holding two million rows. A wrong answer that looks like an answer is the
// worst failure mode available here, which is why this is pinned at the source.

test('LAW 1: match-scope reads join leagues through matches, never league_id', () => {
  // Every league join in the file must arrive via matches.
  assert.match(READS, /JOIN matches m ON m\.id = om\.match_id\s*\n\s*JOIN leagues l ON l\.id = m\.league_id/,
    'the match-scope join goes om -> matches -> leagues');

  // league_id may appear ONLY inside the futures reader, which has no match to
  // join to. Anywhere else it is the inversion.
  const futuresStart = READS.indexOf('export async function futuresBoards');
  assert.ok(futuresStart > 0, 'futuresBoards exists');
  const beforeFutures = READS.slice(0, futuresStart);
  assert.ok(!/om\.league_id/.test(beforeFutures),
    'no match-scope read may name odds_markets.league_id');

  // And the futures reader is allowed to, precisely because it must.
  const futures = READS.slice(futuresStart);
  assert.match(futures, /JOIN leagues l ON l\.id = om\.league_id/,
    'futures rows carry league_id and have no match_id to join through');
  assert.match(futures, /market_scope = 'futures'/);
});

test('LAW 1b: every match-scope read is scoped to match_scope = match', () => {
  assert.match(READS, /om\.market_scope = 'match'/);
});

// ---------------------------------------------------------------------------
// LAW 2 - one surface, one source
// ---------------------------------------------------------------------------

test('LAW 2: every read filters to the Odds API fetcher', () => {
  const n = (READS.match(/fetcher_version = \$\{FETCHER\}/g) ?? []).length;
  assert.ok(n >= 4, `expected every reader to filter by fetcher, found ${n}`);
  assert.match(READS, /const FETCHER = 'odds-api-v4'/);
  // The other vendor's rows (fetcher_version NULL) are World Cup and friendlies
  // history. They stay in the table; they never reach this page.
});

// ---------------------------------------------------------------------------
// LAW 3 - "median of N books" is COUNTED, never written down
// ---------------------------------------------------------------------------

test('LAW 3: the book count is computed per league, not hardcoded', () => {
  assert.match(READS, /count\(DISTINCT b\) AS books/);
  assert.match(READS, /unnest\(om\.source_books\)/);
  assert.match(READS, /GROUP BY l\.slug/);
  // The page must interpolate the counted value, never a literal.
  assert.match(PAGE, /median of \$\{n\} books, de-vigged/);
  assert.ok(!/median of \d+ books/.test(PAGE),
    'a literal book count would be a lie the day a book is added or dropped');
});

test('LAW 3b: the counted value is what reaches the copy', () => {
  // Proves the wiring rather than the SQL: a Map keyed by league slug, read by
  // the band that renders the line.
  const books = new Map([['nfl', 10], ['cfb', 11]]);
  const n = books.get('cfb');
  assert.equal(`median of ${n} books, de-vigged`, 'median of 11 books, de-vigged');
  assert.equal(books.get('epl'), undefined, 'a league with no rows yet yields no claim');
});

// ---------------------------------------------------------------------------
// PHASE BOUNDARY - Phase B is ABSENT, not empty
// ---------------------------------------------------------------------------
//
// The mock shows a modelline and a LEDGER band. Both need the gridiron model
// that does not exist, so Phase A renders NEITHER. Not an empty section, not a
// placeholder: an empty ledger would promise a grade sheet we cannot write,
// which is the one thing a page about honesty must not do.

test('PHASE A: no modelline and no ledger markup, occurrence count zero', () => {
  for (const forbidden of ['modelline', 'tagpill', 'lrow', 'scorepill', 'getLedger', 'getModelBoard']) {
    const n = (PAGE.match(new RegExp(forbidden, 'g')) ?? []).length;
    assert.equal(n, 0, `${forbidden} is Phase B and must be absent from the Phase A page`);
  }
  const CSS = strip(src('app/market/market.css'));
  for (const forbidden of ['modelline', 'tagpill', 'lrow', 'scorepill']) {
    assert.equal((CSS.match(new RegExp(forbidden, 'g')) ?? []).length, 0,
      `${forbidden} rules must not ship ahead of the markup they style`);
  }
});

test('PHASE A: the retired WC market readers are not imported by the page', () => {
  assert.ok(!/matchProbability|marketLedger/.test(PAGE),
    'the WC model and ledger libs stay out of Phase A entirely');
});

// ---------------------------------------------------------------------------
// SHAPE
// ---------------------------------------------------------------------------

test('the three leagues, and only EPL is three-way', () => {
  assert.deepEqual([...MARKET_LEAGUES], ['cfb', 'nfl', 'epl']);
  assert.deepEqual([...THREE_WAY], ['epl']);
});

test('MOVERS ONLY: a dash is not a zero', () => {
  const sel = (moveProb) => ({ moveProb });
  // No baseline stamped yet - not observed, not "held still".
  assert.equal(hasMovement({ h2h: [sel(null), sel(null)], spread: [], total: [] }), false);
  // Observed and flat.
  assert.equal(hasMovement({ h2h: [sel(0), sel(0)], spread: [], total: [] }), false);
  // Observed and moved, in either direction, on any market.
  assert.equal(hasMovement({ h2h: [sel(null)], spread: [sel(-0.78)], total: [] }), true);
  assert.equal(hasMovement({ h2h: [], spread: [], total: [sel(1.2)] }), true);
});

// ---------------------------------------------------------------------------
// EPL INGEST - three-way de-vig
// ---------------------------------------------------------------------------

test('EPL h2h ingests three-way, and the draw is a priced selection', () => {
  const ING = strip(src('lib/gridiron/oddsIngest.js'));
  assert.match(ING, /const threeWay = sport === 'epl'/);
  assert.match(ING, /names: \[event\.home_team, 'Draw', event\.away_team\]/);
  // devigField normalises the WHOLE field. devig2Way over two of three outcomes
  // would silently redistribute the draw's probability into the two sides.
  assert.match(ING, /async function upsertThreeWay/);
  assert.match(ING, /devigField\(cons\)/);
  const KEYS = strip(src('lib/theOddsApi.js'));
  assert.match(KEYS, /epl: 'soccer_epl'/);
});

test('the futures step skips leagues with no outrights key', () => {
  const CRON = strip(src('app/api/cron/gridiron-odds/route.js'));
  assert.match(CRON, /const FUTURES_LEAGUES = LEAGUES\.filter\(\(l\) => l\.futures\)/);
  assert.match(CRON, /for \(const lg of FUTURES_LEAGUES\)/,
    'iterating all LEAGUES would throw unknown-sport on EPL once a day forever');
  assert.match(CRON, /sport: 'epl', slug: 'epl'/);
});

// ---------------------------------------------------------------------------
// THE SWEEP
// ---------------------------------------------------------------------------

test('the dead dashboard readers are gone and nothing imports them', () => {
  for (const dead of ['lib/dashboard.js', 'components/my/MarketPanel.js', 'app/market/BoardSection.js']) {
    assert.throws(() => src(dead), `${dead} must be deleted`);
  }
  assert.ok(!/BoardSection/.test(PAGE));
});

// ---------------------------------------------------------------------------
// M2 — TABS. A move, not an edit.
// ---------------------------------------------------------------------------

test('TABS: three boards, and LEDGER is absent rather than disabled', () => {
  assert.match(PAGE, /const TABS = \[\['lines', 'Lines'\], \['props', 'Props'\], \['futures', 'Futures'\]\]/);
  assert.match(PAGE, /const DEFAULT_TAB = 'lines'/);
  // A greyed-out tab promises a feature; no tab promises nothing.
  assert.ok(!/ledger/i.test(PAGE), 'LEDGER is Phase B and must not appear at all');
});

test('TABS: both axes survive every link', () => {
  // A reader on PROPS who picks CFB stays on PROPS; the tab row keeps the
  // filter already applied. This used to be three hand-built helpers each
  // knowing a different subset of the state - which is exactly how a sort
  // link came to drop ?view=table. There is now ONE builder, it starts from
  // the current state, and a control names only what it changes.
  assert.match(PAGE, /const href = \(patch\) => marketHref\(urlState, patch\)/);
  assert.match(PAGE, /href=\{href\(\{ tab: k \}\)\}/, 'the tab row changes only the tab');
  assert.match(PAGE, /href=\{href\(\{ f: k \}\)\}/, 'the chips change only the filter');
  assert.match(PAGE, /href=\{href\(\{ view: 'table' \}\)\}/, 'the toggle changes only the view');
  // Defaults are omitted by the builder so /market stays /market.
  assert.match(strip(src('lib/market/marketUrl.js')), /if \(key === 'tab' && v === DEFAULT_TAB\) continue;/);
});

test('TABS: an unknown tab falls back rather than rendering nothing', () => {
  assert.match(PAGE, /TABS\.some\(\(\[k\]\) => k === rawTab\) \? rawTab : DEFAULT_TAB/);
});

test('TABS: each board renders under exactly one tab', () => {
  // LINES gained a CARDS/TABLE toggle, so the tab gate now wraps both views;
  // the gate itself is unchanged and each board still renders under one tab.
  assert.match(PAGE, /\{tab === 'lines' \? \(/);
  assert.match(PAGE, /view === 'table' \? \(\s*\n\s*<LinesTable/);
  // M3b replaced the five-card band with the full board; the tab gate is the
  // same shape, the body behind it is not.
  assert.match(PAGE, /\{tab === 'props' && board \?/);
  assert.match(PAGE, /\{tab === 'futures' \?/);
});

test('the props board honours the league chip, like every other tab', () => {
  // M2 taught the five-card band to respect ?f=; M3b's board inherits the rule
  // through boardState, which is where every filter now lives.
  assert.match(PAGE, /league: filter === 'movers' \? 'all' : filter/);
  assert.match(PAGE, /moversOnly: sp\.movers === '1' \|\| filter === 'movers'/);
});

test('the game-page ghost links target the props tab', () => {
  for (const f of ['components/gridiron/OddsStrip.js', 'components/gridiron/PropsPanel.js']) {
    const s = strip(src(f));
    assert.match(s, /\/market\?tab=props&f=\$\{leagueSlug\}/, `${f} deep-links to the props tab`);
    assert.ok(!/`\/market\?f=\$\{leagueSlug\}`/.test(s), `${f} must not use the old bare filter link`);
  }
});

// ---------------------------------------------------------------------------
// LINES + FUTURES TABLES — the secondary views
// ---------------------------------------------------------------------------

test('TWO DEFAULTS, DELIBERATELY OPPOSITE', () => {
  // On PROPS the table is the default; on LINES and FUTURES the CARDS are.
  // Each tab's unmarked URL renders what it rendered before its second view
  // existed, which is what makes every shipped link safe.
  assert.match(PAGE, /tab === 'props'\s*\n\s*\? \(sp\.view === 'charts' \? 'charts' : 'table'\)\s*\n\s*: \(sp\.view === 'table' \? 'table' : 'cards'\)/);
});

test('the LINES and FUTURES tables reuse the reads the cards already ran', () => {
  // No new queries and no new numbers: a table that re-read the database could
  // drift from the cards beside it.
  assert.match(PAGE, /flattenLines\(byLeague, \{ boardIds, leagues, game: boardState\.game \}\)/);
  assert.match(PAGE, /flattenFutures\(futures\)/);
  const LT = strip(src('lib/market/lineTables.js'));
  assert.ok(!/await sql/.test(LT), 'the flatteners must not query');
  assert.ok(!/from .\.\/db/.test(LT), 'and must not import the database at all');
});

test('the futures table carries the WHOLE field, the cards only five', () => {
  const READS = strip(src('lib/market/reads.js'));
  assert.match(READS, /leagueSlug: slug, priced: all\.length, top: all\.slice\(0, topN\), all,/);
});

test('LINES/FUTURES tables sort nulls last in both directions too', () => {
  const LT = strip(src('lib/market/lineTables.js'));
  const fn = LT.slice(LT.indexOf('export function sortRows'), LT.indexOf('function defaultDesc'));
  assert.match(fn, /if \(an\) return 1;/);
  assert.match(fn, /if \(bn\) return -1;/);
  assert.ok(fn.indexOf('if (an) return 1;') < fn.indexOf('return desc ? -cmp : cmp;'));
});

test('the LINES/FUTURES tables add no client components', () => {
  for (const f of ['components/market/LineTable.js', 'lib/market/lineTables.js']) {
    const code = strip(src(f));
    assert.ok(!/'use client'/.test(code), `${f} must stay server-rendered`);
    assert.ok(!/useState|useEffect|onChange=/.test(code));
  }
});

test('teamShort uses the teams table, never a person-name rule', () => {
  const LT = strip(src('lib/market/lineTables.js'));
  assert.match(LT, /if \(label === 'Draw'\) return label;/, 'Draw is neither team');
  assert.match(LT, /label === name \|\| label\.startsWith\(`\$\{name\} `\)/,
    'exact then whole-word prefix - CFB stores TCU where the book writes TCU Horned Frogs');
});

// ── THE GAME DROPDOWN ON LINES ───────────────────────────────────────────────

test('GAME DROPDOWN: one control object, shared - not a copy that would drift', () => {
  const PF = strip(src('components/market/PropsFilters.js'));
  assert.match(PF, /import GameFilter from '\.\/GameFilter'/);
  // The props tab must no longer carry its own select markup, or the two tabs
  // could disagree about what the control is.
  assert.ok(!/name="game"/.test(PF), 'props must render the shared control, not its own select');
  assert.match(PAGE, /import GameFilter from '@\/components\/market\/GameFilter'/);
});

test('GAME DROPDOWN: present on LINES for BOTH views, absent on FUTURES', () => {
  const lines = PAGE.slice(PAGE.indexOf("{tab === 'lines' ? ("), PAGE.indexOf("{tab === 'props' && board"));
  assert.match(lines, /<GameFilter tab="lines"/, 'lines gets the dropdown');
  // OUTSIDE the view ternary is what makes it appear on cards AND table: a
  // control inside the table branch would vanish the moment a reader toggled
  // back to cards, which is the same class of loss the url-state fix closed.
  assert.ok(lines.indexOf('<GameFilter') < lines.indexOf("{view === 'table' ? ("),
    'the dropdown must render before the view branch, so both views carry it');
  const futures = PAGE.slice(PAGE.indexOf("{tab === 'futures' ? ("));
  assert.ok(!/<GameFilter/.test(futures),
    'a title market has no game to filter to - the control would only ever empty the tab');
});

test('GAME DROPDOWN: options are the LINES denominator, not the props census', () => {
  // Offering a game that only has props would be a control that filters to
  // nothing. The options come from the cards this view is about to render.
  assert.match(PAGE, /linesGames\(byLeague, \{ boardIds, leagues: MARKET_LEAGUES \}\)/);
  const LT = strip(src('lib/market/lineTables.js'));
  assert.ok(!/await sql/.test(LT), 'and still no new query');
});

test('GAME DROPDOWN: the CARDS view honours ?game= too', () => {
  // The table half shipped with the lines-table relay. A dropdown that worked
  // in one view and silently did nothing in the other reads as a broken
  // control, which is worse than an absent one.
  assert.match(PAGE, /boardState\.game \? moved\.filter\(\(c\) => c\.matchId === Number\(boardState\.game\)\) : moved/);
  // The band prints its own length, so a single-game render says "1 priced"
  // rather than carrying the unfiltered count.
  assert.match(PAGE, /cards\.length \? `\$\{cards\.length\} priced`/);
});

test('GAME DROPDOWN: a selected game does not print absences it invented', () => {
  assert.match(PAGE, /const cardBands = boardState\.game\s*\n?\s*\? leagues\.filter\(\(s\) => \(shown\.get\(s\) \?\? \[\]\)\.length\) : leagues/);
  assert.match(PAGE, /cardBands\.map\(\(s\) => \(/);
  // League chip and game dropdown can be set to disagree; say which one is
  // hiding the game rather than leaving a blank that reads as no prices.
  assert.match(PAGE, /That game is not in the selected league/);
});

test('GAME DROPDOWN: every href and hidden field comes from the one builder', () => {
  const GF = strip(src('components/market/GameFilter.js'));
  assert.match(GF, /import \{ hiddenFields \} from '@\/lib\/market\/marketUrl'/);
  assert.match(GF, /hiddenFields\(urlState, \['game'\]\)/,
    'derived from live state - a param missing here is a param the reader loses on submit');
  assert.ok(!/'use client'/.test(GF) && !/onChange=/.test(GF),
    'still zero client components on this surface');
});

test('GAME DROPDOWN: linesGames orders board games first, then league, then kickoff', async () => {
  const { linesGames } = await import('./lineTables.js');
  const card = (matchId, leagueSlug, kickoffAt) => ({
    matchId, leagueSlug, kickoffAt,
    home: { abbreviation: 'HOM', name: 'Home Club' },
    away: { abbreviation: 'AWY', name: 'Away Club' },
  });
  const byLeague = new Map([
    ['nfl', [card(1, 'nfl', '2026-09-05T00:20:00Z'), card(2, 'nfl', '2026-09-04T00:20:00Z')]],
    ['cfb', [card(3, 'cfb', '2026-09-06T00:00:00Z')]],
  ]);
  const out = linesGames(byLeague, { boardIds: new Set([3]), leagues: ['nfl', 'cfb'] });
  assert.deepEqual(out.map((g) => g.matchId), [3, 2, 1]);
  assert.match(out[0].label, /Board$/, 'board games say so');
  assert.match(out[1].label, /^NFL · AWY at HOM/);
});

test('GAME DROPDOWN: a team with no abbreviation still gets a readable option', () => {
  // 127 CFB away sides carry no abbreviation. The fallback is the NAME, then a
  // marker - never a bare em dash where a game should be.
  const LT = strip(src('lib/market/lineTables.js'));
  assert.match(LT, /card\.away\?\.abbreviation \|\| card\.away\?\.name \|\| '\?'/);
  assert.match(LT, /card\.home\?\.abbreviation \|\| card\.home\?\.name \|\| '\?'/);
});
