// lib/gridiron/upsertGamePreserve.test.mjs — upsertGame stops destroying what
// it does not know.
//
// THE DEFECT THIS PINS, measured live on 29 Aug: both /games feeds leave the
// score NULL for the whole of a live game, and upsertGame wrote that NULL over
// the running score while REPLACING metadata wholesale — so score, live_state
// and the drive envelopes all vanished for the upsert loop's duration. 20.7
// seconds observed, 14-52s across four consecutive ticks, every 5 minutes.
//
// These are source assertions rather than a live database exercise because the
// behaviour lives in one SQL statement; the DEV sentinel proves it end to end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const SYNC = src('lib/gridiron/sync.js');
// The UPDATE inside upsertGame, isolated from the INSERT that follows it.
const UPDATE = SYNC.slice(SYNC.indexOf('UPDATE matches SET'), SYNC.indexOf('INSERT INTO matches'));

test('a provider NULL never overwrites a stored score', () => {
  assert.match(UPDATE, /COALESCE\(\$\{g\.homeScore\}::int, matches\.home_score\)/);
  assert.match(UPDATE, /COALESCE\(\$\{g\.awayScore\}::int, matches\.away_score\)/);
  // The bare assignment is what caused the wipe. It must be gone.
  assert.doesNotMatch(UPDATE, /home_score = \$\{g\.homeScore\},/);
  assert.doesNotMatch(UPDATE, /away_score = \$\{g\.awayScore\},/);
});

test('an incoming REAL score still wins - a final must be able to write points', () => {
  // COALESCE(incoming, stored) takes incoming whenever it is non-null. If this
  // were COALESCE(stored, incoming) a game could never be scored at all.
  assert.match(UPDATE, /COALESCE\(\$\{g\.homeScore\}::int, matches\.home_score\)/);
  assert.doesNotMatch(UPDATE, /COALESCE\(matches\.home_score, \$\{g\.homeScore\}/);
});

test('a (re)scheduled row takes the provider verbatim - no stale score survives', () => {
  // The r1 guard. Preserving on a game that has not been played would be a lie,
  // so 'scheduled' is the one status where an incoming null clears.
  assert.match(UPDATE, /home_score = CASE WHEN \$\{g\.status\} = 'scheduled' THEN \$\{g\.homeScore\}::int/);
  assert.match(UPDATE, /away_score = CASE WHEN \$\{g\.status\} = 'scheduled' THEN \$\{g\.awayScore\}::int/);
});

test('metadata MERGES at the top level; the wholesale replace is gone', () => {
  assert.match(UPDATE, /metadata = COALESCE\(matches\.metadata, '\{\}'::jsonb\)\s*\n?\s*\|\| \$\{JSON\.stringify\(g\.metadata \?\? \{\}\)\}::jsonb/);
  assert.doesNotMatch(UPDATE, /metadata = \$\{JSON\.stringify\(g\.metadata \?\? \{\}\)\}::jsonb/,
    'a wholesale assignment takes drives and live_state with it');
});

test('a stale clock does not outlive its game - non-live nulls live_state', () => {
  // The debt the merge owes back. Replace used to clear live_state as a side
  // effect; preserving by default would let a finished game keep a running
  // clock forever. syncCfbLiveScores cannot clear it (it only selects live
  // rows), so this statement must.
  assert.match(UPDATE, /CASE WHEN \$\{g\.status\} = 'live' THEN '\{\}'::jsonb\s*\n?\s*ELSE '\{"live_state": null\}'::jsonb END/);
});

test('live_state is nulled, not key-removed - the shape the readers expect', () => {
  // apiSportsImport.js and syncFixture.js both store the key with a null value,
  // and readers do `meta.live_state ?? null`. Removing the key would be a third
  // shape for the same absence.
  assert.match(UPDATE, /"live_state": null/);
  assert.doesNotMatch(UPDATE, /metadata - 'live_state'|jsonb_strip_nulls/);
  const api = src('lib/gridiron/apiSportsImport.js');
  assert.match(api, /live_state: status === 'live'/, 'the sibling writer still nulls the same way');
});

test('the merge form matches writeDriveEnvelopes, not a new sibling', () => {
  // ONE grammar for merging into matches.metadata. playsImport.js already
  // established it; this must be the same shape, not a second dialect.
  const imp = src('lib/gridiron/playsImport.js');
  assert.match(imp, /SET metadata = COALESCE\(metadata, '\{\}'::jsonb\)/);
  assert.match(UPDATE, /COALESCE\(matches\.metadata, '\{\}'::jsonb\)/);
});

test('`||` here is SAFE because every key involved is top level', () => {
  // The 14/15 Aug shallow-merge law: `||` is one level deep, and appending an
  // object onto an ARRAY makes it an element. Both callers send exactly one
  // key, line_scores, and it is an OBJECT at the top level - so the merge
  // replaces that key and touches no nesting and no array.
  for (const marker of ['const metadata = { line_scores: {']) {
    assert.ok(SYNC.includes(marker), 'callers still send a flat line_scores object');
  }
  const nfl = SYNC.slice(SYNC.indexOf('export async function syncNflGames'),
    SYNC.indexOf('export async function syncCfbGames'));
  const cfb = SYNC.slice(SYNC.indexOf('export async function syncCfbGames'));
  for (const [name, body] of [['nfl', nfl], ['cfb', cfb]]) {
    const meta = body.slice(body.indexOf('const metadata ='), body.indexOf('const slug'));
    assert.match(meta, /line_scores/, `${name} caller sends line_scores`);
    assert.doesNotMatch(meta, /drives|live_state/,
      `${name} caller must NOT send drives/live_state - those belong to other writers`);
  }
});

test('SCOPE: this upsertGame serves exactly two callers, and preseason is not one', () => {
  // The preseason path has its OWN upsertGame in apiSportsImport.js on rows
  // keyed by apisports_game_id. Changing this function cannot reach it.
  const calls = [...SYNC.matchAll(/await upsertGame\(leagueId, '(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(calls.sort(), ['bdl_game_id', 'cfbd_game_id']);
  const api = src('lib/gridiron/apiSportsImport.js');
  assert.match(api, /async function upsertGame\(leagueId, providerId, g\)/,
    'the preseason importer keeps its own upsert');
});

test('the INSERT path is untouched - a new row has nothing to preserve', () => {
  const INSERT = SYNC.slice(SYNC.indexOf('INSERT INTO matches'));
  assert.match(INSERT, /\$\{g\.homeScore\}, \$\{g\.awayScore\}/, 'plain values on insert');
  assert.doesNotMatch(INSERT.slice(0, INSERT.indexOf('RETURNING')), /COALESCE\(matches\./);
});

test('the live-score arm still runs AFTER the upsert loop', () => {
  // Carried forward from the D1 relay. Even with the score preserved, the
  // ordering is what makes the restore land on this tick rather than the next.
  const fn = SYNC.slice(SYNC.indexOf('export async function syncCfbGames'));
  assert.ok(fn.indexOf('await upsertGame') < fn.indexOf('syncCfbLiveScores('));
});
