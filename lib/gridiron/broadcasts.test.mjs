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
  assert.match(SYNC, /export async function syncCfbGames\(leagueId, seasonYear = 2025, \{ broadcasts = true \} = \{\}\)/);
});

test('the media read runs AFTER the games, never before', () => {
  // A media row can only attach to a match this run has already written.
  const SYNC = strip(src('lib/gridiron/sync.js'));
  const fn = SYNC.slice(SYNC.indexOf('export async function syncCfbGames'));
  assert.ok(fn.indexOf('await upsertGame') < fn.indexOf('syncCfbBroadcasts('));
});

test('NFL AND EPL ARE UNTOUCHED BY CONSTRUCTION, not by a league check', () => {
  const SYNC = strip(src('lib/gridiron/sync.js'));
  const nfl = SYNC.slice(SYNC.indexOf('export async function syncNflGames'),
    SYNC.indexOf('export async function syncCfbGames'));
  assert.ok(!/syncCfbBroadcasts|broadcasts/.test(nfl), 'the NFL sync gains nothing');
  // BDL /nfl/v1/games carries no TV field on a live payload - 23 keys, none of
  // them an outlet - so there is nothing to wire even if we wanted to.
});

// ── THE CARD ─────────────────────────────────────────────────────────────────

test('ABSENT STAYS ABSENT - no network means the line the card always had', () => {
  const CARD = strip(src('components/gridiron/Scoreboard.js'));
  assert.match(CARD, /\{g\.network \? <> · <span className="gi-net">\{g\.network\}<\/span><\/> : null\}/,
    'the separator lives inside the conditional, so nothing dangles');
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
