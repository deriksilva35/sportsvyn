// lib/gridiron/broadcasts.test.mjs — the CFB outlet ingest and its one rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toBroadcasterRows, primaryOutlet, rank } from './broadcasts.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('the mediaType vocabulary is the one the provider actually sends', () => {
  // Counted across 1,204 rows of the whole 2026 season: exactly tv and web.
  const rows = toBroadcasterRows([
    { mediaType: 'tv', outlet: 'FOX' },
    { mediaType: 'web', outlet: 'ESPN+' },
  ]);
  assert.deepEqual(rows.map((r) => r.broadcaster_type), ['tv', 'streaming']);
});

test('AN UNKNOWN mediaType IS SKIPPED AND COUNTED, never coerced', () => {
  // broadcaster_type carries a CHECK constraint. Coercing an unrecognised
  // value would fail the whole sync run over one row the provider added after
  // we last looked, so the row is dropped and the name of what we dropped is
  // kept.
  const unknownTypes = [];
  const rows = toBroadcasterRows([
    { mediaType: 'tv', outlet: 'FOX' },
    { mediaType: 'satellite-radio', outlet: 'SiriusXM' },
  ], { unknownTypes });
  assert.deepEqual(rows.map((r) => r.broadcaster_name), ['FOX']);
  assert.deepEqual(unknownTypes, ['satellite-radio']);
});

test('EXACTLY ONE PRIMARY, and TV outranks streaming', () => {
  // 013 carries a partial unique index allowing one is_primary per
  // (match, country); two would be rejected at the index.
  const rows = toBroadcasterRows([
    { mediaType: 'web', outlet: 'ESPN+' },
    { mediaType: 'tv', outlet: 'ESPN' },
  ]);
  assert.equal(rows.filter((r) => r.is_primary).length, 1);
  assert.equal(primaryOutlet(rows), 'ESPN');
  assert.deepEqual(rows.map((r) => r.display_order), [1, 2]);
});

test('THE CW PAIR: same broadcast, two provider names, the on-air brand wins', () => {
  // 31 games this season carry two tv rows that are one broadcast under two
  // names. A card has room for one, and the choice must not depend on the
  // order the rows arrived - a re-sync would flip it and the flip would show.
  const a = toBroadcasterRows([
    { mediaType: 'tv', outlet: 'CW' }, { mediaType: 'tv', outlet: 'The CW Network' },
  ]);
  const b = toBroadcasterRows([
    { mediaType: 'tv', outlet: 'The CW Network' }, { mediaType: 'tv', outlet: 'CW' },
  ]);
  assert.equal(primaryOutlet(a), 'CW');
  assert.equal(primaryOutlet(b), 'CW', 'arrival order must not decide it');
  assert.deepEqual(a, b, 'the whole ordering is arrival-independent');
});

test('an equal-length tie still resolves the same way every run', () => {
  const a = toBroadcasterRows([{ mediaType: 'tv', outlet: 'FS1' }, { mediaType: 'tv', outlet: 'CBS' }]);
  const b = toBroadcasterRows([{ mediaType: 'tv', outlet: 'CBS' }, { mediaType: 'tv', outlet: 'FS1' }]);
  assert.equal(primaryOutlet(a), 'CBS');
  assert.deepEqual(a, b);
});

test('a name repeated across mediaTypes cannot collide with itself', () => {
  // Uniqueness is (match, country, name). Two rows with one name inside a
  // single write would conflict mid-statement rather than at the upsert.
  const rows = toBroadcasterRows([
    { mediaType: 'tv', outlet: 'ESPN' }, { mediaType: 'web', outlet: 'ESPN' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].broadcaster_type, 'tv', 'the first occurrence is kept');
});

test('NO OUTLET IS NO ROW - a blank is not a broadcaster', () => {
  assert.deepEqual(toBroadcasterRows([{ mediaType: 'tv', outlet: null }]), []);
  assert.deepEqual(toBroadcasterRows([{ mediaType: 'tv', outlet: '   ' }]), []);
  assert.deepEqual(toBroadcasterRows([]), []);
  assert.deepEqual(toBroadcasterRows(null), []);
  assert.equal(primaryOutlet([]), null);
  assert.equal(primaryOutlet(null), null);
});

test('rank is a total order - sorting is stable across any input order', () => {
  const rows = [
    { broadcaster_name: 'ESPN+', broadcaster_type: 'streaming' },
    { broadcaster_name: 'ACC Network', broadcaster_type: 'tv' },
    { broadcaster_name: 'CW', broadcaster_type: 'tv' },
  ];
  const sorted = [...rows].sort(rank).map((r) => r.broadcaster_name);
  assert.deepEqual(sorted, ['CW', 'ACC Network', 'ESPN+']);
  assert.equal(rank(rows[0], rows[0]), 0, 'a row does not outrank itself');
});

// ── THE WRITE PATH, asserted on source ───────────────────────────────────────

test('THE JOIN IS THE ID WE ALREADY STORE, not a name or a kickoff time', () => {
  const B = strip(src('lib/gridiron/broadcasts.js'));
  assert.match(B, /external_ids->>'cfbd_game_id' = ANY\(\$\{ids\}\)/);
  assert.ok(!/homeTeam|awayTeam|startTime/.test(B),
    'no fuzzy matching: the two payloads agree on a primary key');
});

test('IDEMPOTENT, and the counters say which kind of write happened', () => {
  const B = strip(src('lib/gridiron/broadcasts.js'));
  assert.match(B, /ON CONFLICT \(match_id, country_code, broadcaster_name\) DO UPDATE/);
  assert.match(B, /RETURNING \(xmax = 0\) AS inserted/,
    'insert/update split, so a second run reports 0 inserted rather than nothing');
  assert.match(B, /if \(w\?\.inserted\) summary\.inserted \+= 1; else summary\.updated \+= 1;/);
});

test('THE OLD PRIMARY IS CLEARED BEFORE A NEW ONE IS SET', () => {
  // The partial unique index rejects a second primary, so a match whose
  // primary outlet CHANGES between runs would fail on the way in if the old
  // flag were still standing.
  const B = strip(src('lib/gridiron/broadcasts.js'));
  assert.match(B, /UPDATE match_broadcasters SET is_primary = false/);
  assert.match(B, /broadcaster_name IS DISTINCT FROM/,
    'IS DISTINCT FROM, because broadcaster_name is nullable-safe comparison territory');
  const clear = B.indexOf('SET is_primary = false');
  const insert = B.indexOf('INSERT INTO match_broadcasters');
  assert.ok(clear < insert, 'clear, then set');
});

test('A GAME WE DO NOT HOLD IS COUNTED, not silently dropped', () => {
  const B = strip(src('lib/gridiron/broadcasts.js'));
  assert.match(B, /if \(!matchId\) \{ summary\.unmatchedGames \+= 1; continue; \}/);
});

test('PROVENANCE IS STAMPED - provider rows are distinguishable from seeded ones', () => {
  // match_broadcasters held 5 hand-seeded rows and zero with a provider stamp
  // before this. data_provider_synced_at is what tells them apart forever.
  const B = strip(src('lib/gridiron/broadcasts.js'));
  assert.match(B, /data_provider_synced_at\) *\n? *VALUES[\s\S]{0,200}now\(\)/);
});

test('BROADCASTS RIDE THE BASELINE RUN, not every 5-minute live tick', () => {
  // Who is carrying a game is set days ahead and does not move while it is
  // being played.
  const ROUTE = strip(src('app/api/cron/gridiron-games/route.js'));
  assert.match(ROUTE, /broadcasts: kind === 'baseline'/);
  assert.match(ROUTE, /run: \(\) => lg\.run\(leagueId, season, kind\)/);
  const SYNC = strip(src('lib/gridiron/sync.js'));
  // PINS THE RULE, NOT THE PUNCTUATION. This used to match the whole parameter
  // list verbatim, which meant adding ANY sibling option failed a test about
  // broadcasts - it did exactly that when the live-score arm landed 29 Aug.
  // What has to hold is that `broadcasts` is still an option defaulting true,
  // so the route's `kind === 'baseline'` is what decides. Other options are
  // free to exist beside it.
  assert.match(SYNC, /export async function syncCfbGames\(leagueId, seasonYear = 2025, \{[^}]*\bbroadcasts = true\b[^}]*\} = \{\}\)/);
});

test('THE LIVE SCORE DOES NOT ride the baseline - it runs every tick', () => {
  // The mirror of the test above, and the opposite rule. A broadcast
  // assignment is a schedule fact set days ahead; a SCORE is the one thing
  // that only changes while the ball is in the air. Gating it to the baseline
  // would leave a live card showing a dash for up to 30 minutes - which is the
  // D1 defect this arm exists to close, reintroduced.
  const ROUTE = strip(src('app/api/cron/gridiron-games/route.js'));
  assert.doesNotMatch(ROUTE, /liveScores: kind === 'baseline'/,
    'the live score must not be gated to the baseline run');
  const SYNC = strip(src('lib/gridiron/sync.js'));
  assert.match(SYNC, /export async function syncCfbGames\(leagueId, seasonYear = 2025, \{[^}]*\bliveScores = true\b[^}]*\} = \{\}\)/,
    'liveScores defaults ON, so every tick that syncs games also scores them');
});

test('the live score is read AFTER the upsert, or the upsert undoes it', () => {
  // upsertGame writes the provider's NULL points and REPLACES metadata
  // wholesale. Anything written before it on the same tick is erased by it.
  const SYNC = strip(src('lib/gridiron/sync.js'));
  const fn = SYNC.slice(SYNC.indexOf('export async function syncCfbGames'));
  assert.ok(fn.indexOf('await upsertGame') < fn.indexOf('syncCfbLiveScores('),
    'the score write must follow the upsert loop');
});

test('the media read runs AFTER the games, never before', () => {
  // A media row can only attach to a match this run has already written.
  const SYNC = strip(src('lib/gridiron/sync.js'));
  const fn = SYNC.slice(SYNC.indexOf('export async function syncCfbGames'));
  assert.ok(fn.indexOf('await upsertGame') < fn.indexOf('syncCfbBroadcasts('));
});

test('THE TWO ARMS DO NOT CROSS, and EPL still has none', () => {
  // THIS TEST USED TO SAY "NFL is untouched by construction". That stopped
  // being true the moment the ESPN arm shipped, and the honest replacement is
  // not to delete the claim but to state the one that holds now: each league's
  // sync calls its OWN ingest, and EPL calls neither because API-Sports Ultra
  // carries no broadcast field on a live fixture payload.
  const SYNC = strip(src('lib/gridiron/sync.js'));
  const nfl = SYNC.slice(SYNC.indexOf('export async function syncNflGames'),
    SYNC.indexOf('export async function syncCfbGames'));
  const cfb = SYNC.slice(SYNC.indexOf('export async function syncCfbGames'));
  assert.ok(/syncNflBroadcasts\(/.test(nfl) && !/syncCfbBroadcasts\(/.test(nfl),
    'the NFL sync calls the ESPN arm and only that one');
  assert.ok(/syncCfbBroadcasts\(/.test(cfb) && !/syncNflBroadcasts\(/.test(cfb),
    'the CFB sync calls the CFBD arm and only that one');
  assert.ok(!/epl/i.test(strip(src('lib/gridiron/nflBroadcasts.js'))));
});

// ── THE CARD ─────────────────────────────────────────────────────────────────

test('ABSENT STAYS ABSENT - no network means the slot the card always had', () => {
  // THE GRAMMAR MOVED with the NFL arm: the network now takes the SECOND slot,
  // replacing the venue city rather than trailing the identifier line. The
  // claim under it is unchanged - a card with no listing renders exactly what
  // it rendered before, and no separator is left dangling either way.
  const CARD = strip(src('components/gridiron/Scoreboard.js'));
  assert.match(CARD, /: \[distinctLabel\(g\.weekLabel\), g\.venueCity\]\.filter\(Boolean\)\.join\(' · '\)\}/,
    'no network and the slot falls back to exactly the old expression');
  assert.ok(!/W\{g\.week\}\s*\n?\s*\{g\.network/.test(CARD),
    'the identifier line no longer carries it');
});

test('THE CARD SHOWS THE PRIMARY ONLY, and the reader asks for it once', () => {
  const R = strip(src('lib/gridiron/readers.js'));
  assert.match(R, /is_primary = true AND match_id = ANY\(\$\{ids\}\)/,
    'one query for the whole slate, like attachApRanks beside it');
  assert.match(R, /for \(const g of games\) g\.network = byMatch\.get\(g\.id\) \?\? null;/,
    'a game with no listing gets null, and null renders nothing');
  const call = R.indexOf('await attachNetworks(games)');
  assert.ok(call > 0, 'the slate reader attaches it');
});
