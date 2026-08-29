// lib/cfb/gameStatsStub.test.mjs — the box score keeps its starters.
//
// THE DEFECT THIS CLOSES, measured on the first real 2026 import: 7 of 58
// player-rows for UNC @ TCU had no roster row, and one of them was TCU's
// STARTING QUARTERBACK (20/32, 175 yards). Dropping those rows produced a
// passing table with no passer - a box score that is wrong, not merely thin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTeamEntity } from './gameStatsImport.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const IMP = src('lib/cfb/gameStatsImport.js');

// ------------------------------------------------- the synthetic team entity

test('CFBD\'s "Team" entity is excluded by its NEGATIVE id, not by its name', () => {
  // Observed: TCU carried an athlete named "Team" with id -7595 holding
  // CAR 1, YDS -31 - sacks and kneel-downs. Matching on the name would break
  // on any real player nicknamed Team; the sign is the provider's own marker.
  assert.equal(isTeamEntity(-7595), true);
  assert.equal(isTeamEntity('-7595'), true);
  assert.equal(isTeamEntity(5083569), false);
  assert.equal(isTeamEntity('5083569'), false);
});

test('teamRows is counted APART from noPlayer, so coverage means what it says', () => {
  assert.match(IMP, /if \(isTeamEntity\(r\.providerPlayerId\)\) \{ teamRows\+\+; continue; \}/);
  assert.match(IMP, /teamRows, stubbed,/, 'both ride the run summary');
  // The exclusion must precede the roster lookup, or the entity gets stubbed.
  const loop = IMP.slice(IMP.indexOf('for (const r of rows)'));
  assert.ok(loop.indexOf('isTeamEntity') < loop.indexOf('rmap.get(r.providerPlayerId)'),
    'the team entity is filtered before it can become a player');
});

// --------------------------------------------------- the stub, and its dedup

test('THE DEDUP KEY IS THE ROSTER CRON\'S OWN - a stub is enriched, never twinned', () => {
  // This is the assertion the ruling asked for, and it is a three-way match:
  // the stub's conflict target, the roster importer's conflict target, and the
  // unique index that backs both. If any one of them drifts, Wednesday's cron
  // starts inserting siblings instead of filling in the stub.
  const ROSTER = src('lib/gridiron/rosterImport.js');
  const MIG = src('migrations/076_gridiron_roster.sql');

  const CONFLICT = /ON CONFLICT \(\(external_ids->>'cfbd_player_id'\)\) WHERE external_ids \? 'cfbd_player_id'/;
  assert.match(IMP, CONFLICT, 'the stub conflicts on cfbd_player_id');
  assert.match(ROSTER, /ON CONFLICT \(\(external_ids->>'\$\{providerKey\}'\)\) WHERE external_ids \? '\$\{providerKey\}'/,
    'the roster cron conflicts on the same expression');
  assert.match(MIG, /ON players \(\(external_ids->>'cfbd_player_id'\)\)/);
  assert.match(MIG, /WHERE external_ids \? 'cfbd_player_id'/);
});

test('the stub carries cfbd_player_id - without it the cron cannot find it', () => {
  const fn = IMP.slice(IMP.indexOf('async function stubPlayer'), IMP.indexOf('/** cfbd team name'));
  assert.match(fn, /cfbd_player_id: pid/);
  assert.match(fn, /INSERT INTO players/);
  // It must NOT claim fields the roster owns - position, jersey, height. A stub
  // that invents a position would survive the cron's update as a wrong value.
  assert.doesNotMatch(fn, /position|current_team_jersey_number|height_cm|weight_kg/,
    'the stub asserts only what the box score actually told us');
});

test('the stub is marked as a stub, so it is findable later', () => {
  const fn = IMP.slice(IMP.indexOf('async function stubPlayer'), IMP.indexOf('/** cfbd team name'));
  assert.match(fn, /source: 'cfbd-box-score-stub'/);
  assert.match(fn, /stubbed_at/);
});

test('a DRY RUN never stubs - it counts and writes nothing', () => {
  const loop = IMP.slice(IMP.indexOf('for (const r of rows)'));
  assert.match(loop, /if \(dryRun\) \{ noPlayer\+\+; continue; \}/,
    'dryRun must stay write-free, which is its whole contract');
});

// ------------------------------------------------------- the week-key guard

test('THE WEEK PARAM IS CFBD\'S WEEK, and a contest key fails LOUDLY', async () => {
  // Passing our ISO contest week (35) used to return [] and read as
  // "nothing to do" - a silent empty import. It now throws.
  const { importCfbWeek } = await import('./gameStatsImport.js');
  await assert.rejects(
    () => importCfbWeek(2026, 35, { dryRun: true }),
    /week must be CFBD's week \(1-20\), got 35/,
  );
  await assert.rejects(() => importCfbWeek(2026, 0, { dryRun: true }), /week must be CFBD's week/);
  await assert.rejects(() => importCfbWeek(2026, 21, { dryRun: true }), /week must be CFBD's week/);
});

test('the guard names the fix, not just the fault', () => {
  assert.match(IMP, /derive the week from/,
    'the message has to tell the next caller what to do instead');
});
