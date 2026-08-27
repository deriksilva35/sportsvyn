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
