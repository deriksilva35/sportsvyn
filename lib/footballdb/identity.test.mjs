// lib/footballdb/identity.test.mjs — resolveAndPersistIdentity against real
// DEV, sentinel rows only (never a real player's row - the same discipline
// every write-path proof in this repo follows). Teardown deletes by tracked
// id, never a namespace or name sweep.
//
// RULING UNDER TEST: an ambiguous identity is STORED, never ATTACHED. A
// fixture name with two nfl_players candidates must produce one brand-new
// player row and one matching season row - and neither of the two existing
// candidates may gain a row of their own.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../db.js';
import { normalizeName } from '../gridiron/nameMatch.js';
import { resolveAndPersistIdentity } from './identity.js';

const SENTINEL_NAME = 'Zzz Sentinel Ambiguous Testfixture';
const SENTINEL_NORM = normalizeName(SENTINEL_NAME);

const createdPlayerIds = [];
const createdSeasonTotalIds = [];

test('an ambiguous fixture name mints one new player, never attaches to either existing candidate', async () => {
  // Two sentinel nfl_players rows sharing the fixture's normalized name -
  // exactly what makes resolveIdentity() call this ambiguous.
  const [a] = await sql`
    INSERT INTO nfl_players (first_name, last_name, full_name, normalized_name, position)
    VALUES ('Zzz', 'SentinelA', ${SENTINEL_NAME}, ${SENTINEL_NORM}, 'RB')
    RETURNING id`;
  const [b] = await sql`
    INSERT INTO nfl_players (first_name, last_name, full_name, normalized_name, position)
    VALUES ('Zzz', 'SentinelB', ${SENTINEL_NAME}, ${SENTINEL_NORM}, 'WR')
    RETURNING id`;
  createdPlayerIds.push(a.id, b.id);

  const candidateIndex = new Map([
    [SENTINEL_NORM, [{ id: a.id, position: 'RB' }, { id: b.id, position: 'WR' }]],
  ]);

  const resolved = await resolveAndPersistIdentity(sql, SENTINEL_NAME, 'RB', candidateIndex, { apply: true });

  assert.equal(resolved.outcome, 'ambiguous');
  assert.equal(resolved.matchedBy, 'created-ambiguous');
  assert.deepEqual(resolved.candidateIds.sort(), [a.id, b.id].sort());
  assert.notEqual(resolved.nflPlayerId, null);
  assert.notEqual(resolved.nflPlayerId, a.id);
  assert.notEqual(resolved.nflPlayerId, b.id);
  createdPlayerIds.push(resolved.nflPlayerId);

  // The season row goes against the NEW id, matched_by 'created-ambiguous' -
  // exactly the write scripts/footballdb-import.mjs performs per row.
  const [seasonRow] = await sql`
    INSERT INTO nfl_player_season_totals (nfl_player_id, season_year, team_key, position, matched_by, raw_name)
    VALUES (${resolved.nflPlayerId}, 1994, 'ZZZ', 'RB', ${resolved.matchedBy}, ${SENTINEL_NAME})
    RETURNING id, nfl_player_id, matched_by`;
  createdSeasonTotalIds.push(seasonRow.id);

  assert.equal(seasonRow.nfl_player_id, resolved.nflPlayerId);
  assert.equal(seasonRow.matched_by, 'created-ambiguous');

  // NEITHER existing candidate gained a season row of their own.
  const attachedToExisting = await sql`
    SELECT count(*) AS n FROM nfl_player_season_totals
     WHERE nfl_player_id IN (${a.id}, ${b.id})`;
  assert.equal(Number(attachedToExisting[0].n), 0);

  // Exactly one NEW nfl_players row exists for this fixture name beyond the
  // two seeded candidates.
  const allWithName = await sql`
    SELECT id FROM nfl_players WHERE normalized_name = ${SENTINEL_NORM}`;
  assert.equal(allWithName.length, 3);
});

test.after(async () => {
  // Teardown by tracked id, never a name/namespace sweep.
  if (createdSeasonTotalIds.length) {
    await sql`DELETE FROM nfl_player_season_totals WHERE id = ANY(${createdSeasonTotalIds})`;
  }
  if (createdPlayerIds.length) {
    await sql`DELETE FROM nfl_players WHERE id = ANY(${createdPlayerIds})`;
  }
});
