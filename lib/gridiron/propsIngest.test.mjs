// lib/gridiron/propsIngest.test.mjs — the props ingest's three load-bearing
// claims: the scope IS the budget, the de-vig forks on a real mathematical
// difference, and the key guard reads the vendor rather than the config.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyAlert, PROPS_MIN_REMAINING } from './propsIngest.js';
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

test('STORAGE: the /market board reads cannot pick up prop rows', () => {
  const READS = strip(src('lib/market/reads.js'));
  assert.match(READS, /const FETCHER = 'odds-api-v4'/);
  // Every board read filters on the exact non-props fetcher string.
  assert.ok(!/odds-api-v4-props/.test(READS));
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

// DISARMED ON PURPOSE, AND THIS TEST IS THE RECORD OF WHY.
//
// The route, the ingest and the guard all ship; the SCHEDULE does not. Props
// must run against the 100K key, and which key the deployed cron environment
// carries has not been established - the droplet's is a 500-credit key. A
// registered schedule would have taken that decision by simply arriving at
// 13:00 UTC, which is not how a spend decision should get made.
//
// TO ENABLE: add { path: '/api/cron/gridiron-props', schedule: '0 13,17,21,23 * * *' }
// back to vercel.json. Four ticks a day, never the 15-minute rhythm - per-game
// billing at that cadence is ~10,000 credits a day. Until then the route is
// reachable only with the cron secret, which is what makes a controlled first
// tick possible.
test('the props cron ships DISARMED until the key question is answered', () => {
  const vercel = JSON.parse(src('vercel.json'));
  const c = vercel.crons.find((x) => x.path === '/api/cron/gridiron-props');
  assert.equal(c, undefined, 'no schedule may be registered before the key is confirmed');
  // The route itself must still exist - this is a disarm, not a revert.
  assert.ok(src('app/api/cron/gridiron-props/route.js').length > 0);
  assert.match(CRON, /cronAuthorized\(request\)/, 'and it stays behind the cron secret');
});

test('the per-event payload is not coerced to an empty array', () => {
  const API = strip(src('lib/theOddsApi.js'));
  assert.match(API, /\{ raw: true \}/,
    'the per-event endpoint returns an object; the array coercion would empty it');
  assert.match(API, /raw \|\| Array\.isArray\(events\)/);
});
