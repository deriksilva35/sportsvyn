// lib/gridiron/propsIngest.test.mjs — the props ingest's three load-bearing
// claims: the scope IS the budget, the de-vig forks on a real mathematical
// difference, and the key guard reads the vendor rather than the config.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyAlert, zeroMatchAlert, PROPS_MIN_REMAINING } from './propsIngest.js';
import { PROP_MARKETS, ANYTIME_MARKETS } from '../theOddsApi.js';
import { devig2Way, median } from '../odds.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
// Comments stripped first: this file's own header names the strings the
// assertions forbid, and the raw text would trip every one of them.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const ING = strip(src('lib/gridiron/propsIngest.js'));
const CRON = strip(src('app/api/cron/gridiron-props/route.js'));

// ---------------------------------------------------------------------------
// SCOPE — asserted as a JOIN, not as an intention
// ---------------------------------------------------------------------------
//
// The relay's requirement is that a game which is NOT on the board and NOT in
// the game week gets ZERO props calls. A test that mocked the DB and counted
// calls would prove the mock behaves; what has to be true is that the SQL
// cannot return such a game in the first place. So the shape of the query is
// the assertion.

test('SCOPE: CFB is board-only, joined off contests.board', () => {
  const fn = ING.slice(ING.indexOf('export async function propsScope'), ING.indexOf('function matchEvent'));
  const cfb = fn.slice(fn.indexOf("leagueSlug === 'cfb'"), fn.indexOf('WITH nxt AS'));
  assert.match(cfb, /FROM contests c/);
  assert.match(cfb, /jsonb_array_elements\(c\.board\) g/);
  assert.match(cfb, /JOIN matches m ON m\.id = \(g->>'match_id'\)::int/,
    'the board IS the join - a CFB game off the board cannot appear');
  // No week fallback: a widening OR here would silently restore the 99-game
  // slate and the 297-credit tick that came with it.
  assert.ok(!/m\.week/.test(cfb), 'CFB scope must not reach for a week window');
});

test('SCOPE: NFL and EPL are the current game week, phase-matched', () => {
  const fn = ING.slice(ING.indexOf('export async function propsScope'));
  assert.match(fn, /m\.week IS NOT DISTINCT FROM n\.week/,
    'IS NOT DISTINCT FROM - a NULL week must not silently match everything');
  assert.match(fn, /m\.season_phase IS NOT DISTINCT FROM n\.season_phase/,
    'so a preseason week cannot drag a regular-season game in behind it');
  assert.match(fn, /m\.season_year IS NOT DISTINCT FROM n\.season_year/);
});

test('SCOPE: only scheduled, future games are ever called', () => {
  const fn = ING.slice(ING.indexOf('export async function propsScope'), ING.indexOf('function matchEvent'));
  const occurrences = (fn.match(/m\.status = 'scheduled' AND m\.kickoff_at > now\(\)/g) ?? []).length;
  // Three, not two: the CFB branch, the week-picking CTE, and the week branch's
  // own outer WHERE. The CTE needs it independently - without it the "current
  // week" could be chosen from a game that has already kicked off.
  assert.equal(occurrences, 3, 'every branch, and the week picker, freeze at kickoff');
});

// ---------------------------------------------------------------------------
// DE-VIG — the fork is mathematical, and it is the ratified inversion
// ---------------------------------------------------------------------------

test('DE-VIG: a genuine two-way Over/Under normalises to 100.000', () => {
  // Real shape: a book's over/under pair on one line, with its margin in it.
  const dv = devig2Way({ a: median([1.90, 1.91, 1.90]), b: median([1.88, 1.90, 1.89]) });
  assert.ok(Math.abs(dv.a_pct + dv.b_pct - 100) < 1e-9, 'sums to exactly 100');
  assert.ok(dv.overround_pct > 0, 'and the overround it removed was real');
});

test('DE-VIG: anytime markets are stored RAW, never field-normalised', () => {
  // THE RATIFIED INVERSION. Several players score in one game, so anytime
  // outcomes are NOT mutually exclusive and their field legitimately sums far
  // above 100 - a live NFL probe measured 577.4% across 30 players, and the
  // World Cup's anytime_scorer rows sit at 663-849%. Normalising would assert
  // exactly one player scores, which is false.
  assert.ok(ANYTIME_MARKETS.has('player_anytime_td'));
  assert.ok(ANYTIME_MARKETS.has('player_goal_scorer_anytime'));
  // The ingest must not run a field de-vig anywhere.
  assert.ok(!/devigField/.test(ING), 'no field normalisation may reach the props path');
  assert.match(ING, /decToImplied/, 'anytime prices convert straight to implied, one at a time');
});

test('DE-VIG: the two treatments are selected by market, not by sport', () => {
  assert.match(ING, /if \(ANYTIME_MARKETS\.has\(key\)\)/,
    'a sport-level branch would mis-handle EPL, which has one of each');
});

// ---------------------------------------------------------------------------
// STORAGE — the constraint forced this, and the WC precedent solved it
// ---------------------------------------------------------------------------

test('STORAGE: rows use market_scope match, because player_prop needs a player_id', () => {
  assert.match(ING, /const SCOPE = 'match'/);
  assert.ok(!/'player_prop'/.test(ING.replace(/SCOPE/g, '')),
    'player_prop requires a resolved player_id and name-matching is deferred by ruling');
  assert.match(ING, /fetcher_version = \$\{FETCHER_VERSION\}/,
    'props stay separable from the board rows by fetcher_version');
  assert.match(ING, /const FETCHER_VERSION = 'odds-api-v4-props'/);
});

test('STORAGE: prop rows and board rows never share a fetcher string', () => {
  const READS = strip(src('lib/market/reads.js'));
  // The two constants must be DISTINCT and each reader must name exactly one.
  // (The per-reader assertions live in lib/market/reads.test.mjs; this one
  // guards the ingest side of the same contract.)
  assert.match(READS, /const FETCHER = 'odds-api-v4';/);
  assert.match(READS, /const PROPS_FETCHER = 'odds-api-v4-props'/);
  assert.match(ING, /const FETCHER_VERSION = 'odds-api-v4-props'/,
    'what the props ingest writes is what the props reader looks for');
});

// ---------------------------------------------------------------------------
// THE KEY GUARD — watches the vendor's header, not our config
// ---------------------------------------------------------------------------

test('KEY GUARD: a small key is caught even though every call returns 200', () => {
  // The droplet's key: 500 credits. It can never be the 100K plan.
  const warn = keyAlert({ requests_remaining: '486', requests_used: '14' });
  assert.match(warn, /500-credit key/);
  assert.match(warn, /not the 100K plan/);
});

test('KEY GUARD: the credit floor fires on the real plan', () => {
  assert.equal(keyAlert({ requests_remaining: '94870', requests_used: '5130' }), null,
    'a healthy 100K key passes');
  const low = keyAlert({ requests_remaining: '9000', requests_used: '91000' });
  assert.match(low, /credit floor breached/);
  assert.equal(PROPS_MIN_REMAINING, 10_000);
});

test('KEY GUARD: missing or unreadable headers are themselves the alarm', () => {
  assert.match(keyAlert(null), /no vendor budget headers/);
  assert.match(keyAlert({ requests_remaining: null }), /unreadable/);
});

test('KEY GUARD: the cron actually calls it on every successful run', () => {
  assert.match(CRON, /const warn = keyAlert\(res\.summary\?\.budget\)/);
  assert.match(CRON, /CREDIT\/KEY WARNING/);
});

// ---------------------------------------------------------------------------
// LAUNCH SET + UNMAPPED VISIBILITY
// ---------------------------------------------------------------------------

test('LAUNCH SET matches what the vendor actually prices', () => {
  assert.deepEqual(PROP_MARKETS.nfl,
    ['player_pass_yds', 'player_rush_yds', 'player_receptions', 'player_anytime_td']);
  // Measured, not assumed: the vendor does not price passing yards for college.
  assert.ok(!PROP_MARKETS.cfb.includes('player_pass_yds'),
    'CFB has no player_pass_yds - probed 27 Aug 2026');
  assert.deepEqual(PROP_MARKETS.epl,
    ['player_goal_scorer_anytime', 'player_shots_on_target']);
});

test('a market key the vendor adds is COUNTED, not silently dropped', () => {
  assert.match(ING, /unmappedMarkets\.add\(m\.key\)/);
  assert.match(ING, /unmappedMarkets: \[\.\.\.unmappedMarkets\]/);
  assert.match(CRON, /unmapped prop markets/);
});

// ENABLED. The key question is answered: a manual run against the DEPLOYED env
// reported requests_used 5245 / requests_remaining 94755 - a 100,000-credit
// plan with a healthy balance, read from the vendor's own header rather than
// from any config. keyAlert passed on that budget.
test('the props cron is scheduled, and never on the 15-minute rhythm', () => {
  const vercel = JSON.parse(src('vercel.json'));
  const c = vercel.crons.find((x) => x.path === '/api/cron/gridiron-props');
  assert.ok(c, 'the props cron is registered');
  assert.ok(!c.schedule.includes('/15'),
    'per-game billing at that cadence is ~10,000 credits a day');
  assert.equal(c.schedule.split(' ')[1].split(',').length, 4, 'four ticks a day');
  assert.match(CRON, /cronAuthorized\(request\)/, 'and it stays behind the cron secret');
});

test('the per-event payload is not coerced to an empty array', () => {
  const API = strip(src('lib/theOddsApi.js'));
  assert.match(API, /\{ raw: true \}/,
    'the per-event endpoint returns an object; the array coercion would empty it');
  assert.match(API, /raw \|\| Array\.isArray\(events\)/);
});

// ---------------------------------------------------------------------------
// ZERO-MATCH GUARD — a sync run's success is what it WROTE
// ---------------------------------------------------------------------------
//
// Both of this subsystem's real failures wore ok=true. The first EPL odds tick
// fetched 20 events and matched 0. The first props run scoped 15 NFL and 8 CFB
// games and called nothing. Neither threw, so neither alerted.

test('ZERO-MATCH: fetching events and matching none is an alert', () => {
  const a = zeroMatchAlert({ events: 20, matched: 0, source: 'epl-odds' });
  assert.match(a, /epl-odds/);
  assert.match(a, /fetched 20 vendor events and matched NONE/);
});

test('ZERO-MATCH: a genuinely empty vendor day is NOT an alert', () => {
  // No events is a quiet day - the off-season, or nothing scheduled. Alerting
  // on it would train the reader to ignore the alert that matters.
  assert.equal(zeroMatchAlert({ events: 0, matched: 0, source: 'nfl-odds' }), null);
});

test('ZERO-MATCH: any match at all clears it', () => {
  assert.equal(zeroMatchAlert({ events: 20, matched: 1, source: 'epl-odds' }), null);
});

test('ZERO-MATCH: both crons actually fire it', () => {
  const ODDS = strip(src('app/api/cron/gridiron-odds/route.js'));
  assert.match(ODDS, /zeroMatchAlert\(\{/);
  assert.match(ODDS, /MATCHED NOTHING/);
  assert.match(CRON, /zeroMatchAlert\(\{/);
  assert.match(CRON, /MATCHED NOTHING/);
  // On the odds path it reads the vendor event count; on the props path the
  // scoped game count, because props scope locally before calling.
  assert.match(ODDS, /events: res\.summary\?\.events \?\? 0/);
  assert.match(CRON, /events: res\.summary\?\.scoped \?\? 0/);
});

// ---------------------------------------------------------------------------
// THE MATCHER — one resolver, not two
// ---------------------------------------------------------------------------

test('props reuses resolveTeamId rather than a second, weaker matcher', () => {
  assert.match(ING, /import \{ resolveTeamId \}/);
  assert.match(ING, /resolveTeamId\(sport, e\.home_team/);
  // Compared by team ID, not by name string: the whole point of the resolver.
  assert.match(ING, /h === row\.home_team_id && a === row\.away_team_id/);
});

test('EPL joins on the prefix rule; NFL stays exact-only', () => {
  const JOIN = strip(src('lib/gridiron/oddsJoin.js'));
  assert.match(JOIN, /if \(sport === 'nfl'\) return null;/,
    'NFL exact-only - a prefix rule there would let "New York" match either team');
  // The prefix loop must be reachable for epl, which the old `!== cfb` gate
  // blocked. Ten of twenty EPL events failed on exactly this.
  assert.ok(!/if \(sport !== 'cfb'\) return null;/.test(JOIN));
});

// ---------------------------------------------------------------------------
// A.2c — phase scope, single-sided storage, alert isolation
// ---------------------------------------------------------------------------

test('PHASE SCOPE: PRE is excluded, and NULL is not preseason', () => {
  const fn = ING.slice(ING.indexOf('export async function propsScope'), ING.indexOf('function buildResolver'));
  const occurrences = (fn.match(/m\.season_phase IS DISTINCT FROM 'PRE'/g) ?? []).length;
  assert.equal(occurrences, 2, 'both the week picker and the outer query exclude PRE');
  // IS DISTINCT FROM, never <>. EPL's season_phase is NULL on all 370
  // scheduled matches and `<> 'PRE'` is NULL for NULL - it would exclude every
  // EPL match exactly as the odds join's `= ANY(...)` did.
  assert.ok(!/season_phase <> 'PRE'/.test(fn), 'plain inequality would drop every NULL-phase league');
  assert.ok(!/season_phase != 'PRE'/.test(fn));
});

test('SINGLE-SIDED O/U stores as-offered, and the fork is on the DATA', () => {
  // No pair means no overround to remove. Not a dropped row - a row that says
  // less, honestly. player_shots_on_target is Over-only today.
  assert.match(ING, /if \(!e\.paired\)/);
  // RAW IMPLIED, NOT NULL. implied_probability is NOT NULL on the table, and
  // passing null failed the entire EPL leg on first contact - loudly, which is
  // the guard working. It was also incoherent: anytime rows store the raw
  // number, and "same family as anytime" must mean the same storage.
  assert.match(ING, /impliedPct: decToImplied\(dec\), books/,
    'single-sided stores the raw implied, exactly as anytime does');
  assert.ok(!/impliedPct: null/.test(ING), 'a NOT NULL column cannot take null');
  // The fork must key off whether a book actually priced both sides, NOT off a
  // hardcoded market list - the day the vendor pairs it, devig2Way takes over
  // with no code change.
  assert.match(ING, /if \(sides\.Over && sides\.Under\)/);
  assert.ok(!/shots_on_target/.test(ING.replace(/PROP_MARKETS/g, '')),
    'no market key may be special-cased in the de-vig fork');
});

test('the /market card notes as-offered from the ROW, not a market list', () => {
  const READS = strip(src('lib/market/reads.js'));
  // The first version of this keyed off a NULL implied_probability. That could
  // never work: the column is NOT NULL, so the null never arrives. The row's
  // SHAPE - whether its Over/Under counterpart exists - is what actually
  // distinguishes a de-vigged pair from an as-offered single.
  assert.match(READS, /r\.asOffered = !\(k && paired\.has\(k\)\)/);
  assert.ok(!/r\.implied_probability == null\) card\.hasAnytime/.test(READS),
    'the null-implied test was unreachable and is gone');
});

test('ALERT ISOLATION: the zero-match alert carries its own source key', () => {
  // maybeAlert rate-limits BY SOURCE and a different payload inside the window
  // writes no ledger row at all. Sharing the league source meant a CREDIT/KEY
  // WARNING 40 minutes earlier swallowed the zero-match alert entirely -
  // observed in production, nfl-props scoped 13 / called 0, no row emitted.
  const ODDS = strip(src('app/api/cron/gridiron-odds/route.js'));
  for (const [name, code] of [['odds', ODDS], ['props', CRON]]) {
    assert.match(code, /source: `\$\{lg\.source\}-zeromatch`/, `${name} cron isolates the alert source`);
  }
});

test('AS-OFFERED is derived from row shape, not a market list', () => {
  const READS = strip(src('lib/market/reads.js'));
  // A de-vigged O/U always ships as a PAIR - devig2Way needs both sides to
  // exist. Anytime and one-sided O/U have no counterpart. That is the test,
  // and it survives the vendor pairing or unpairing any market.
  assert.match(READS, /const OU = \/\^\(\.\*\) \(Over\|Under\)\$\//);
  assert.match(READS, /r\.asOffered = !\(k && paired\.has\(k\)\)/);
  assert.match(READS, /if \(r\.asOffered\) r\.impliedPct = null/,
    'a raw price must never appear in the de-vigged implied column');
});
