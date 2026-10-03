// lib/gridiron/playsReimport.test.mjs - the 2026 NFL re-import's diff and its
// batched write, against DEV, on the recorded PHI@CHI game (no network).
//
// The sentinel match is seeded with PHI@CHI's plays AS THE PRE-FIX IMPORTER
// WROTE THEM TO PROD (fixture `stored`), re-derived from the recorded BDL
// feed, written with applyGame, and read back: the interception row must come
// back as PHI's with its end-of-play state, and a second diff must be empty.
// Also proves migration 123's columns exist where the suite runs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { sql } = await import('../db.js');
const { nflPlaysAndDrives, writePlays, writeDriveEnvelopes } = await import('./playsImport.js');
const { diffGame, applyGame } = await import('./playsReimport.js');

const F = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'phi-chi-2026-w3.json'), 'utf8'));
const SLUG = `sentinel-reimport-${process.pid}-${Date.now()}`;
const INT = '4018729631513';
let matchId = null; let home = null; let away = null; let tmap = null;

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'nfl'`;
  [home, away] = (await sql`SELECT id FROM teams WHERE league_id = ${lg.id} ORDER BY id LIMIT 2`).map((r) => r.id);
  // PROD's CHI/PHI ids -> two DEV teams; BDL 24 (CHI) / 18 (PHI) likewise.
  const remap = new Map([[F.match.home_team_id, home], [F.match.away_team_id, away]]);
  tmap = new Map([['24', home], ['18', away]]);
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, home_score, away_score, season_year, season_phase, week, metadata)
    VALUES (${lg.id}, ${SLUG}, 'final', ${home}, ${away}, now() - interval '1 day', 27, 7, 2026, 'REG', 3,
            ${JSON.stringify({ drives: F.storedDrives })}::jsonb)
    RETURNING id`;
  matchId = m.id;
  // The pre-fix rows: the importer's own write, then the stored offense/drive put back.
  const { plays } = nflPlaysAndDrives(F.bdl, tmap);
  const byP = new Map(F.stored.map((s) => [s.provider_play_id, s]));
  const pre = plays.filter((p) => byP.has(p.providerPlayId)).map((p) => {
    const s = byP.get(p.providerPlayId);
    return { ...p, driveId: s.drive_id, driveNumber: s.drive_number, playNumber: s.play_number,
      offenseTeamId: s.offense_team_id == null ? null : remap.get(s.offense_team_id), endDown: null, endDistance: null, endYardsToGoal: null };
  });
  await writePlays(matchId, pre);
});

after(async () => {
  await sql`DELETE FROM plays WHERE match_id = ${matchId}`;
  await sql`DELETE FROM matches WHERE id = ${matchId}`;
  const [left] = await sql`SELECT count(*)::int n FROM matches WHERE slug = ${SLUG}`;
  assert.equal(left.n, 0, 'the sentinel is gone');
});

const stored = () => sql`
  SELECT id, provider_play_id, drive_id, drive_number, play_number, offense_team_id, play_type,
         end_down, end_distance, end_yards_to_goal
    FROM plays WHERE match_id = ${matchId}`;

test('the re-import corrects the pre-fix rows in one batched write, and a second pass finds nothing', async () => {
  const [held] = await sql`SELECT offense_team_id FROM plays WHERE match_id = ${matchId} AND provider_play_id = ${INT}`;
  assert.equal(held.offense_team_id, home, 'seeded as the pre-fix importer had it: CHI');

  const { plays, drives } = nflPlaysAndDrives(F.bdl, tmap);
  const [m] = await sql`SELECT metadata->'drives' AS drives FROM matches WHERE id = ${matchId}`;
  const d = diffGame(await stored(), plays, m.drives, drives);
  assert.deepEqual(d.offenseByType, { 'pass-incompletion': 2, 'pass-interception-return': 2 });
  assert.equal(d.missing.length, F.bdl.length - F.stored.length, 'the feed row PROD never got');
  assert.ok(d.envelopesChanged);

  const w = await applyGame(sql, matchId, plays, d, { batch: 50 });
  assert.equal(w.updated, d.changed.length, 'every changed row written, across several batches');
  await writePlays(matchId, d.missing);
  await writeDriveEnvelopes(matchId, drives);

  const [row] = await sql`
    SELECT offense_team_id, drive_id, end_down, end_distance, end_yards_to_goal, down, distance, yards_to_goal, text
      FROM plays WHERE match_id = ${matchId} AND provider_play_id = ${INT}`;
  assert.equal(row.offense_team_id, away, 'PHI - the original offense');
  assert.deepEqual([row.down, row.distance, row.yards_to_goal], [3, 2, 2], 'the pre-snap state is untouched');
  assert.deepEqual([row.end_down, row.end_distance, row.end_yards_to_goal], [1, 10, 80]);
  assert.match(row.text, /INTERCEPTED/, 'text is the feed\'s and was not rewritten');

  const [m2] = await sql`SELECT metadata->'drives' AS drives FROM matches WHERE id = ${matchId}`;
  const again = diffGame(await stored(), plays, m2.drives, drives);
  assert.deepEqual(again.offenseByType, {});
  assert.equal(again.changed.length, 0);
  assert.equal(again.missing.length, 0);
  assert.equal(again.envelopesChanged, false, 'jsonb key order is not a change');
});
