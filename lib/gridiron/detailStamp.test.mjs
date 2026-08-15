// lib/gridiron/detailStamp.test.mjs - metadata.detail survives two writers.
//
// WHY THIS FILE EXISTS SEPARATELY FROM gameDetail.test.mjs: that suite is pure,
// and this defect is not visible to a pure test, or to any single-writer test.
// It only appears when TWO writers touch metadata->'detail' in sequence:
// apiSportsImport.js nests its merge and writes final_seen_at, gameDetail.js
// wrote the whole detail object and deleted it. Each was correct alone. Read
// either file in isolation on 14 Aug and you would have signed it off.
//
// So these tests run the REAL SQL against a scratch row on DEV, in the real
// order, rather than asserting on a JS copy of the merge. Rows use the
// 'stamptest-' slug marker and are cleaned up.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { sql } = await import('../db.js');
const { writeDetailStamp } = await import('./gameDetail.js');

const SLUG = 'stamptest-detail-merge';
let matchId, leagueId, teamA, teamB;

async function cleanup() {
  await sql`DELETE FROM matches WHERE slug LIKE ${'stamptest-%'}`;
}

before(async () => {
  await cleanup();
  leagueId = (await sql`SELECT id FROM leagues WHERE slug = ${'nfl'} LIMIT 1`)[0]?.id;
  const teams = await sql`SELECT id FROM teams WHERE league_id = ${leagueId} LIMIT 2`;
  teamA = teams[0]?.id; teamB = teams[1]?.id;
  matchId = (await sql`
    INSERT INTO matches (league_id, slug, status, kickoff_at, home_team_id, away_team_id,
                         season_year, season_phase, week, metadata)
    VALUES (${leagueId}, ${SLUG}, 'final', now(), ${teamA}, ${teamB}, 2026, 'PRE', 1, '{}'::jsonb)
    RETURNING id`)[0].id;
});
after(cleanup);

const detailOf = async () =>
  (await sql`SELECT metadata->'detail' AS d FROM matches WHERE id = ${matchId}`)[0].d;

// The apiSportsImport.js stamp, verbatim in shape: nested merge, set-once.
async function hotSweepStampsFinalSeen(at) {
  await sql`
    UPDATE matches
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'detail',
             COALESCE(metadata->'detail', '{}'::jsonb) || jsonb_build_object(
               'final_seen_at', COALESCE(metadata->'detail'->>'final_seen_at', ${at})
             ))
     WHERE id = ${matchId}`;
}

async function reset(detail) {
  await sql`UPDATE matches SET metadata = ${JSON.stringify({ detail })}::jsonb WHERE id = ${matchId}`;
}

// ---------------------------------------------------------------------------
// (1) The exact clobber from the 14 Aug slate.
// ---------------------------------------------------------------------------

test('THE 14 AUG CLOBBER: a detail write must not delete final_seen_at', async () => {
  const X = '2026-08-15T02:01:37Z';
  await reset({ final_seen_at: X, at: '2026-08-15T02:01:00.000Z' });

  // What the detail fetch wrote that night, and what wiped the stamp.
  await writeDetailStamp(matchId, { at: '2026-08-15T02:01:03.044Z', final: false });

  const d = await detailOf();
  assert.equal(d.final_seen_at, X, 'final_seen_at was destroyed - this is the defect');
  assert.equal(d.at, '2026-08-15T02:01:03.044Z', 'current-state keys must still take the incoming value');
  assert.equal(d.final, false);
  assert.deepEqual(Object.keys(d).sort(), ['at', 'final', 'final_seen_at']);
});

test('an incoming stamp cannot overwrite an existing final_seen_at (set-once)', async () => {
  const FIRST = '2026-08-15T02:01:37Z';
  await reset({ final_seen_at: FIRST });
  // A later writer that carries its own, later, stamp: the first one still wins.
  await writeDetailStamp(matchId, { at: 'x', final: true, final_seen_at: '2026-08-15T09:99:99Z' });
  assert.equal((await detailOf()).final_seen_at, FIRST);
});

test('first writer sets it: absent final_seen_at is written, not skipped', async () => {
  await reset({ at: 'old' });
  await writeDetailStamp(matchId, { at: 'new', final: true, final_seen_at: '2026-08-15T02:20:00Z' });
  assert.equal((await detailOf()).final_seen_at, '2026-08-15T02:20:00Z');
});

test('unrelated sibling keys inside detail also survive', async () => {
  await reset({ final_seen_at: 'X', at: 'old', some_future_key: 'keep me' });
  await writeDetailStamp(matchId, { at: 'new', final: false });
  const d = await detailOf();
  assert.equal(d.some_future_key, 'keep me');
  assert.equal(d.final_seen_at, 'X');
});

test('sibling TOP-LEVEL metadata keys are untouched', async () => {
  await sql`UPDATE matches SET metadata = ${JSON.stringify({
    detail: { final_seen_at: 'X' }, venue: 'MetLife', line_scores: { home: [7, 0] },
  })}::jsonb WHERE id = ${matchId}`;
  await writeDetailStamp(matchId, { at: 'new', final: true });
  const m = (await sql`SELECT metadata FROM matches WHERE id = ${matchId}`)[0].metadata;
  assert.equal(m.venue, 'MetLife');
  assert.deepEqual(m.line_scores, { home: [7, 0] });
  assert.equal(m.detail.final_seen_at, 'X');
});

test('a detail write onto an EMPTY metadata object still works', async () => {
  // matches.metadata is NOT NULL, so the COALESCE(metadata,'{}') in the writer
  // is defensive only - '{}' is the real floor. Pinned so the empty case is
  // covered by something other than the column constraint.
  await sql`UPDATE matches SET metadata = '{}'::jsonb WHERE id = ${matchId}`;
  await writeDetailStamp(matchId, { at: 'new', final: false });
  const d = await detailOf();
  assert.equal(d.at, 'new');
  assert.equal(d.final, false);
  assert.equal(d.final_seen_at, undefined, 'nothing invented when there was no prior stamp');
});

// ---------------------------------------------------------------------------
// (2) TWO WRITERS INTERLEAVING - the sequence a single-writer test misses.
// ---------------------------------------------------------------------------

test('MULTI-WRITER: hot sweep stamps, detail fetch writes after - stamp survives', async () => {
  await reset({});
  const FIRST_FINAL = '2026-08-15T02:01:37Z';

  await hotSweepStampsFinalSeen(FIRST_FINAL);              // 22:01:37 hot sweep
  assert.equal((await detailOf()).final_seen_at, FIRST_FINAL);

  await writeDetailStamp(matchId, { at: '02:01:40Z', final: false }); // detail, during the flap
  assert.equal((await detailOf()).final_seen_at, FIRST_FINAL,
    'the detail fetch deleted the stamp the hot sweep had just written');
});

test('MULTI-WRITER: the full 14 Aug sequence, flap included, keeps the FIRST instant', async () => {
  await reset({});
  const FIRST_FINAL = '2026-08-15T02:01:37Z';
  const LATER_FINAL = '2026-08-15T02:10:58Z';

  // 22:01:37 provider says final -> hot sweep stamps
  await hotSweepStampsFinalSeen(FIRST_FINAL);
  // 22:01:03-ish detail fetch lands, reading a stale 'live' status
  await writeDetailStamp(matchId, { at: '2026-08-15T02:01:03Z', final: false });
  // 22:02 provider flaps final -> live; hot sweep runs again, must NOT move it
  await hotSweepStampsFinalSeen(LATER_FINAL);
  // 22:09 provider settles on final; the post-whistle fetch claims the game
  await writeDetailStamp(matchId, { at: '2026-08-15T02:09:11Z', final: true });

  const d = await detailOf();
  assert.equal(d.final_seen_at, FIRST_FINAL,
    `stamp must hold the FIRST final (${FIRST_FINAL}), not the post-flap one (${LATER_FINAL})`);
  assert.equal(d.final, true, 'the claim must still land');
  assert.equal(d.at, '2026-08-15T02:09:11Z');
});

test('MULTI-WRITER: repeated detail writes never erode the stamp', async () => {
  await reset({});
  await hotSweepStampsFinalSeen('2026-08-15T02:01:37Z');
  for (let i = 0; i < 5; i++) {
    await writeDetailStamp(matchId, { at: `pass-${i}`, final: i % 2 === 0 });
  }
  const d = await detailOf();
  assert.equal(d.final_seen_at, '2026-08-15T02:01:37Z');
  assert.equal(d.at, 'pass-4');
});

// ---------------------------------------------------------------------------
// (3) The shallow-merge trap itself, pinned so nobody reintroduces it.
// ---------------------------------------------------------------------------

test('WHY: bare `jsonb ||` on a nested object deletes siblings', async () => {
  const r = (await sql`
    SELECT ('{"detail":{"final_seen_at":"X","at":"old"}}'::jsonb
            || '{"detail":{"at":"new","final":false}}'::jsonb) AS shallow`)[0].shallow;
  assert.equal(r.detail.final_seen_at, undefined,
    'if this ever passes, Postgres changed and the nested merge can be reconsidered');
  assert.deepEqual(r.detail, { at: 'new', final: false });
});
