// lib/gridiron/nflBroadcasts.test.mjs — the NFL outlet ingest and its six traps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toBroadcasterRows, joinKey, ourAbbr, shouldAlertOnBlank, TEAM_ALIAS, SEASON_TYPE,
} from './nflBroadcasts.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * A REAL WEEK-1 EVENT, shaped exactly as the live scoreboard returned it. The
 * empty top-level `broadcasts` is deliberately present: it is the trap, and a
 * fixture without it could not catch t1.
 */
const WK1 = {
  id: '401872656',
  date: '2026-09-09T20:20Z',
  broadcasts: [],            // ← the summary-endpoint trap, empty on every game
  competitions: [{
    broadcasts: [{ market: 'national', names: ['NBC'] }],
    geoBroadcasts: [{
      type: { id: '1', shortName: 'TV' },
      market: { id: '1', type: 'National' },
      media: { shortName: 'NBC', logo: 'https://a.espncdn.com/guid/x/logos/default.png' },
      lang: 'en', region: 'us',
    }],
    competitors: [
      { homeAway: 'home', team: { abbreviation: 'SEA' } },
      { homeAway: 'away', team: { abbreviation: 'NE' } },
    ],
  }],
};

// ── t1: the empty top-level broadcasts ───────────────────────────────────────

test('t1: the parse reads competitions[0].broadcasts, NEVER the top-level one', () => {
  // summary.broadcasts is [] on every game. A reader that took it would ship a
  // silent zero and look like it had worked.
  assert.deepEqual(WK1.broadcasts, [], 'the fixture keeps the trap in place');
  const rows = toBroadcasterRows(WK1);
  assert.equal(rows.length, 1, 'a known wk1 fixture must parse NON-EMPTY');
  assert.equal(rows[0].broadcaster_name, 'NBC');
  assert.equal(rows[0].broadcaster_type, 'tv');
  assert.equal(rows[0].is_primary, true);

  // And the source may not name the trap path at all.
  const M = strip(src('lib/gridiron/nflBroadcasts.js'));
  assert.match(M, /event\?\.competitions\?\.\[0\]/);
  assert.ok(!/\bevent\.broadcasts\b|\bsummary\.broadcasts\b/.test(M),
    'the top-level array must never be read');
});

test('t1b: an event with ONLY the empty top-level array yields no rows', () => {
  assert.deepEqual(toBroadcasterRows({ broadcasts: [{ names: ['NBC'] }], competitions: [{}] }), [],
    'a name in the wrong place is not a broadcast');
  assert.deepEqual(toBroadcasterRows(null), []);
  assert.deepEqual(toBroadcasterRows({}), []);
});

// ── t2: blank future weeks are healthy ───────────────────────────────────────

test('t2: a fully-blank FUTURE week does not alert', () => {
  // Week 18 of 2026 is 0/16 covered and that is flex scheduling, not a failure.
  const wk18 = { games: 16, networks: 0, firstKickoff: '2027-01-10T18:00:00Z' };
  assert.equal(shouldAlertOnBlank(wk18, { now: '2026-08-29T00:00:00Z' }), false);
});

test('t2b: a blank week that is IMMINENT does alert', () => {
  const soon = { games: 16, networks: 0, firstKickoff: '2026-09-02T18:00:00Z' };
  assert.equal(shouldAlertOnBlank(soon, { now: '2026-08-29T00:00:00Z' }), true);
  // The boundary is the window, not a week number - a week 18 that is days away
  // in December is exactly as alarming as a week 1 in September.
  const late = { games: 16, networks: 0, firstKickoff: '2027-01-05T18:00:00Z' };
  assert.equal(shouldAlertOnBlank(late, { now: '2027-01-01T00:00:00Z' }), true);
});

test('t2c: a week with any coverage, or no games at all, never alerts', () => {
  const now = { now: '2026-08-29T00:00:00Z' };
  assert.equal(shouldAlertOnBlank({ games: 16, networks: 1, firstKickoff: '2026-09-02T00:00Z' }, now), false);
  assert.equal(shouldAlertOnBlank({ games: 0, networks: 0, firstKickoff: null }, now), false);
  assert.equal(shouldAlertOnBlank({ games: 16, networks: 0, firstKickoff: null }, now), false);
});

// ── t3: self-throttle ────────────────────────────────────────────────────────

test('t3: the sweep is serial and paused - silence is not permission', () => {
  const M = strip(src('lib/gridiron/nflBroadcasts.js'));
  assert.match(M, /throttleMs = 150/, 'a default pause exists');
  assert.match(M, /if \(throttleMs\) await sleep\(throttleMs\)/);
  // Serial, not a fan-out: no Promise.all over the week loop.
  const fn = M.slice(M.indexOf('export async function syncNflBroadcasts'));
  assert.ok(!/Promise\.all|Promise\.allSettled/.test(fn),
    'weeks are fetched one at a time');
  assert.match(fn, /for \(let w = 1; w <= last; w \+= 1\)/);
});

// ── t4: never log ESPN's error body ──────────────────────────────────────────

test('t4: a failed fetch names the STATUS and PATH, never the response body', () => {
  // ESPN's 404 body carries their internal hostname, sports.core.api.espn.pvt.
  const M = strip(src('lib/gridiron/nflBroadcasts.js'));
  assert.match(M, /throw new Error\(`ESPN \$\{res\.status\} on \$\{path\}`\)/);
  assert.ok(!/res\.text\(\)/.test(M), 'the body is never even read on failure');
  assert.ok(!/espn\.pvt/.test(M));
  // The catch logs the message we constructed, not a payload.
  assert.match(M, /e\?\.message \?\? 'unknown'/);
});

// ── t5: the alias map, exercised ─────────────────────────────────────────────

test('t5: LA resolves to LAR and WAS to WSH - the named silent-drop defect', () => {
  assert.deepEqual(TEAM_ALIAS, { LA: 'LAR', WAS: 'WSH' });
  assert.equal(ourAbbr('LA'), 'LAR');
  assert.equal(ourAbbr('WAS'), 'WSH');
  assert.equal(ourAbbr('SEA'), 'SEA', 'everything else passes through untouched');

  const rams = { competitions: [{ competitors: [
    { homeAway: 'home', team: { abbreviation: 'LA' } },
    { homeAway: 'away', team: { abbreviation: 'SF' } }] }] };
  const commanders = { competitions: [{ competitors: [
    { homeAway: 'home', team: { abbreviation: 'WAS' } },
    { homeAway: 'away', team: { abbreviation: 'DAL' } }] }] };
  assert.equal(joinKey(rams, 'REG', 3), 'REG|3|LAR|SF');
  assert.equal(joinKey(commanders, 'REG', 7), 'REG|7|WSH|DAL');
});

test('t5b: a half-known game builds no key rather than a colliding one', () => {
  const half = { competitions: [{ competitors: [{ homeAway: 'home', team: {} }] }] };
  assert.equal(joinKey(half, 'REG', 1), null);
  assert.equal(joinKey({}, 'REG', 1), null);
});

// ── the simulcast, and the write path ────────────────────────────────────────

test('SIMULCAST: two rows, names[0] primary, no tie-break rule needed', () => {
  const ev = { competitions: [{
    broadcasts: [{ market: 'national', names: ['ESPN', 'ABC'] }],
    geoBroadcasts: [
      { type: { shortName: 'TV' }, media: { shortName: 'ESPN', logo: 'http://a/e.png' } },
      { type: { shortName: 'TV' }, media: { shortName: 'ABC', logo: 'http://a/a.png' } },
    ],
    competitors: [{ homeAway: 'home', team: { abbreviation: 'KC' } },
      { homeAway: 'away', team: { abbreviation: 'DEN' } }],
  }] };
  const rows = toBroadcasterRows(ev);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.broadcaster_name), ['ESPN', 'ABC']);
  assert.equal(rows.filter((r) => r.is_primary).length, 1, 'the index allows exactly one');
  assert.equal(rows[0].is_primary, true);
  assert.deepEqual(rows.map((r) => r.display_order), [1, 2]);
});

test('CHANNEL LOGO comes off geoBroadcasts - 013 has the column for it', () => {
  const rows = toBroadcasterRows(WK1);
  assert.equal(rows[0].channel_logo_url, 'https://a.espncdn.com/guid/x/logos/default.png');
  // No logo is null, not an empty string: the column means "we have none".
  const noLogo = toBroadcasterRows({ competitions: [{
    broadcasts: [{ names: ['NFL Net'] }],
    geoBroadcasts: [{ type: { shortName: 'TV' }, media: { shortName: 'NFL Net', logo: '' } }] }] });
  assert.equal(noLogo[0].channel_logo_url, null);
});

test('an UNRECOGNISED geoBroadcasts type is skipped and counted, never coerced', () => {
  const unknownTypes = [];
  const rows = toBroadcasterRows({ competitions: [{
    broadcasts: [{ names: ['SiriusXM', 'FOX'] }],
    geoBroadcasts: [
      { type: { shortName: 'Satellite' }, media: { shortName: 'SiriusXM' } },
      { type: { shortName: 'TV' }, media: { shortName: 'FOX' } },
    ] }] }, { unknownTypes });
  assert.deepEqual(rows.map((r) => r.broadcaster_name), ['FOX']);
  assert.deepEqual(unknownTypes, ['Satellite']);
  // AND the survivor is primary - stamping during the loop would have left
  // this row with is_primary false and the game with no primary at all.
  assert.equal(rows[0].is_primary, true);
  assert.equal(rows[0].display_order, 1);
});

test('a name with no geoBroadcasts row still stores, defaulted to tv', () => {
  const rows = toBroadcasterRows({ competitions: [{ broadcasts: [{ names: ['FOX'] }] }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].broadcaster_type, 'tv');
  assert.equal(rows[0].channel_logo_url, null);
});

test('SCOPE is REG and POST - preseason is not ESPN seasontype 1 here', () => {
  assert.deepEqual(SEASON_TYPE, { 2: 'REG', 3: 'POST' });
  assert.ok(!Object.values(SEASON_TYPE).includes('PRE'));
});

test('THE STAMP is on insert AND update, via EXCLUDED - proven in the CFB arm', () => {
  const M = strip(src('lib/gridiron/nflBroadcasts.js'));
  assert.match(M, /is_primary, display_order, language_code, data_provider_synced_at\)/);
  assert.match(M, /'en', now\(\)\)/);
  assert.match(M, /data_provider_synced_at = EXCLUDED\.data_provider_synced_at/);
  assert.match(M, /channel_logo_url = EXCLUDED\.channel_logo_url/);
  assert.match(M, /RETURNING \(xmax = 0\) AS inserted/);
});

test('THE OLD PRIMARY IS CLEARED BEFORE A NEW ONE IS SET', () => {
  const M = strip(src('lib/gridiron/nflBroadcasts.js'));
  const clear = M.indexOf('SET is_primary = false');
  const insert = M.indexOf('INSERT INTO match_broadcasters');
  assert.ok(clear > 0 && clear < insert, 'clear, then set');
  assert.match(M, /broadcaster_name IS DISTINCT FROM/);
});

test('SCOPED TO NFL REG/POST - no query can reach a CFB or friendly row', () => {
  // t6's structural half. The write only ever targets a match_id that came out
  // of this SELECT, and this SELECT is one league and two phases.
  const M = strip(src('lib/gridiron/nflBroadcasts.js'));
  assert.match(M, /WHERE m\.league_id = \$\{leagueId\} AND m\.season_year = \$\{seasonYear\}/);
  assert.match(M, /m\.season_phase = ANY\(ARRAY\['REG', 'POST'\]\)/);
  assert.match(M, /WHERE match_id = \$\{matchId\}/, 'the clear is per-match, never table-wide');
  assert.ok(!/DELETE FROM match_broadcasters/.test(M), 'nothing is ever deleted');
});

test('the module reads NO env - the fetcher is injected', () => {
  const M = strip(src('lib/gridiron/nflBroadcasts.js'));
  assert.ok(!/process\.env/.test(M), 'no credential or host can enter through this module');
});

test('BROADCASTS RIDE THE BASELINE on the NFL arm too', () => {
  const ROUTE = strip(src('app/api/cron/gridiron-games/route.js'));
  assert.match(ROUTE, /syncNflGames\(leagueId, season, \{ broadcasts: kind === 'baseline' \}\)/);
  const SYNC = strip(src('lib/gridiron/sync.js'));
  assert.match(SYNC, /export async function syncNflGames\(leagueId, seasonYear = 2025, \{ broadcasts = true \} = \{\}\)/);
  const fn = SYNC.slice(SYNC.indexOf('export async function syncNflGames'),
    SYNC.indexOf('export async function syncCfbGames'));
  assert.ok(fn.indexOf('upsertGame') < fn.indexOf('syncNflBroadcasts('), 'games first, then the join');
});

// ── the reader and the card ──────────────────────────────────────────────────

test('attachNetworks IS LEAGUE-BLIND - the NFL arm needs zero reader changes', () => {
  const R = strip(src('lib/gridiron/readers.js'));
  const start = R.indexOf('async function attachNetworks');
  const fn = R.slice(start, R.indexOf('\n}', start));
  assert.ok(!/nfl|cfb|epl|league/i.test(fn),
    'it keys on match_id alone, so a second league is free');
  assert.match(fn, /is_primary = true AND match_id = ANY\(\$\{ids\}\)/);
});

test('THE FOOT: network REPLACES the city slot, and absence restores it', () => {
  const CARD = strip(src('components/gridiron/Scoreboard.js'));
  assert.match(CARD, /\{g\.network\s*\n?\s*\? <span className="gi-net">\{g\.network\}<\/span>\s*\n?\s*: \[distinctLabel\(g\.weekLabel\), g\.venueCity\]\.filter\(Boolean\)\.join\(' · '\)\}/);
  // The identifier line is back to what it always was - no network on it.
  assert.match(CARD, /<span className="gi-line">\{g\.leagueSlug\.toUpperCase\(\)\} · \{g\.seasonPhase\} W\{g\.week\}<\/span>/);
});
