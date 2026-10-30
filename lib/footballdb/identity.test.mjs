// lib/footballdb/identity.test.mjs — the footballdb identity resolver.
//
// RULING UNDER TEST (fri-11): a same-name tie is broken by team-season
// context; a tie context cannot break is AMBIGUOUS and writes NOTHING - no
// new player, never attached to a candidate. The old ruling minted a new
// player per ambiguous row ('created-ambiguous'); on PROD that left 106
// unreferenced duplicates (197716-197821) that made more names ambiguous.
//
// The pure cases need no database. The DEV case uses sentinel rows only,
// torn down by tracked id, never a name sweep.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../db.js';
import { normalizeName } from '../gridiron/nameMatch.js';
import { resolveAndPersistIdentity, resolveByContext, resolveIdentity, franchiseOf, addEvidence } from './identity.js';

const ev = (pairs) => {
  const m = new Map();
  for (const [id, year, team] of pairs) addEvidence(m, id, year, team);
  return m;
};

test('franchiseOf folds relocations and old names, leaves today\'s keys alone', () => {
  assert.equal(franchiseOf('San Diego Chargers'), 'LAC');
  assert.equal(franchiseOf('Houston Oilers'), 'TEN');
  assert.equal(franchiseOf('Oakland Raiders'), 'LV');
  assert.equal(franchiseOf('LV'), 'LV');
  assert.equal(franchiseOf('NE'), 'NE');
});

test('team fit: the candidate on the same franchise the season before wins (Jim Harbaugh, SD 1999 -> 2000)', () => {
  const evidence = ev([[134118, 1999, 'San Diego Chargers'], [134118, 1998, 'BAL']]);
  const r = resolveByContext([{ id: 134118 }, { id: 149161 }], { year: 2000, team: 'LAC', evidence });
  assert.deepEqual(r, { outcome: 'exact', nflPlayerId: 134118, via: 'team' });
});

test('era fit: a trade breaks the team link, the only candidate active nearby wins', () => {
  const evidence = ev([[1, 1999, 'SF'], [2, 2015, 'NYJ']]);
  assert.deepEqual(resolveByContext([{ id: 1 }, { id: 2 }], { year: 2000, team: 'LV', evidence }),
    { outcome: 'exact', nflPlayerId: 1, via: 'era' });
});

test('true namesakes on one team-year are ambiguous (skipped), never guessed', () => {
  const evidence = ev([[1, 2001, 'NO'], [2, 1999, 'NO']]);
  const r = resolveByContext([{ id: 1 }, { id: 2 }], { year: 2000, team: 'NO', evidence });
  assert.equal(r.outcome, 'ambiguous');
  assert.deepEqual(r.fits.sort(), [1, 2]);
});

test('every candidate from another era -> a new player; a candidate with no evidence keeps it ambiguous', () => {
  const far = ev([[1, 1985, 'SF'], [2, 2018, 'NYJ']]);
  assert.deepEqual(resolveByContext([{ id: 1 }, { id: 2 }], { year: 2000, team: 'SF', evidence: far }), { outcome: 'created' });
  const blind = ev([[1, 1985, 'SF']]);
  assert.equal(resolveByContext([{ id: 1 }, { id: 2 }], { year: 2000, team: 'SF', evidence: blind }).outcome, 'ambiguous');
});

test('resolveIdentity: one candidate is exact without context; a tie without context stays ambiguous', () => {
  const idx = new Map([['solo guy', [{ id: 9, position: 'RB' }]], ['two guys', [{ id: 1, position: 'QB' }, { id: 2, position: 'QB' }]]]);
  assert.equal(resolveIdentity('Solo Guy', 'RB', idx).nflPlayerId, 9);
  assert.equal(resolveIdentity('Two Guys', 'QB', idx).outcome, 'ambiguous');
  const r = resolveIdentity('Two Guys', 'QB', idx, { year: 2000, team: 'CHI', evidence: ev([[2, 1999, 'CHI']]) });
  assert.equal(r.outcome, 'exact');
  assert.equal(r.nflPlayerId, 2);
});

const SENTINEL_NAME = 'Zzz Sentinel Ambiguous Testfixture';
const SENTINEL_NORM = normalizeName(SENTINEL_NAME);
const createdPlayerIds = [];

test('DEV: an ambiguous name with --apply writes nothing - no new player, no attach', async () => {
  const [a] = await sql`
    INSERT INTO nfl_players (first_name, last_name, full_name, normalized_name, position)
    VALUES ('Zzz', 'SentinelA', ${SENTINEL_NAME}, ${SENTINEL_NORM}, 'RB')
    RETURNING id`;
  const [b] = await sql`
    INSERT INTO nfl_players (first_name, last_name, full_name, normalized_name, position)
    VALUES ('Zzz', 'SentinelB', ${SENTINEL_NAME}, ${SENTINEL_NORM}, 'WR')
    RETURNING id`;
  createdPlayerIds.push(a.id, b.id);

  const candidateIndex = new Map([[SENTINEL_NORM, [{ id: a.id, position: 'RB' }, { id: b.id, position: 'WR' }]]]);
  // Both seeded candidates are on the same team around this season: real namesakes.
  const evidence = ev([[a.id, 1993, 'ZZZ'], [b.id, 1995, 'ZZZ']]);
  const resolved = await resolveAndPersistIdentity(sql, SENTINEL_NAME, 'RB', candidateIndex,
    { apply: true, context: { year: 1994, team: 'ZZZ', evidence } });

  assert.equal(resolved.outcome, 'ambiguous');
  assert.equal(resolved.matchedBy, null);
  assert.equal(resolved.nflPlayerId, null);
  assert.deepEqual(resolved.candidateIds.sort(), [a.id, b.id].sort());

  const allWithName = await sql`SELECT id FROM nfl_players WHERE normalized_name = ${SENTINEL_NORM}`;
  assert.equal(allWithName.length, 2, 'no player was minted');
});

test.after(async () => {
  if (createdPlayerIds.length) await sql`DELETE FROM nfl_players WHERE id = ANY(${createdPlayerIds})`;
});
