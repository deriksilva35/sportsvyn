// lib/mlb/probablesRefresh.test.mjs - the 36-hour starters pass (tue-4).
//
// The merge is pure. The pass runs against real DEV rows: scheduled MLB games a
// few hours from NOW (a fixture about open games is written relative to now),
// slugs carrying "test" so scripts/dev-orphan-sweep.mjs lists any a killed run
// leaves behind. BDL is a stub that answers from a table - no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../db.js';
import { mergeProbables, refreshMlbProbables, HORIZON_HOURS } from './probablesRefresh.js';

const SALE = { id: '736', name: 'Chris Sale', hand: 'L' };
const LUZ = { id: '5113', name: 'Jesus Luzardo', hand: 'L' };

test('THE MERGE: a reading replaces its side, keeps the other, and says null when nothing changes', () => {
  assert.equal(mergeProbables(null, null), null, 'nothing read, nothing written');
  assert.deepEqual(mergeProbables(null, { away: LUZ, home: null }), { away: LUZ, home: null }, 'one side announced is worth writing');
  assert.deepEqual(mergeProbables({ away: LUZ, home: null }, { away: null, home: SALE }), { away: LUZ, home: SALE }, 'a reading missing a side does not wipe it');
  assert.equal(mergeProbables({ away: LUZ, home: SALE }, { away: LUZ, home: SALE }), null, 'identical: no write, no updated_at churn');
  assert.equal(mergeProbables({ away: LUZ, home: SALE }, { away: null, home: null }), null);
  const scratch = { id: '9', name: 'Spencer Schwellenbach', hand: 'R' };
  assert.deepEqual(mergeProbables({ away: LUZ, home: SALE }, { away: null, home: scratch }), { away: LUZ, home: scratch }, 'a new name is a scratch and replaces');
  assert.deepEqual(mergeProbables({ away: { id: '5113', name: 'Jesus Luzardo' }, home: null }, { away: LUZ, home: null }), { away: LUZ, home: null }, 'the hand arriving later is a change');
});

const TAG = `mlbprob-test-${process.pid}`;
let league; let home; let away; let homeAbbr; let awayAbbr; const made = [];
const BDL_NEAR = `99${process.pid}1`; const BDL_FAR = `99${process.pid}2`;

async function game(slug, kickoff, bdl) {
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, season_phase, stage, external_ids)
    VALUES (${league}, ${`${TAG}-${slug}`}, ${home}, ${away}, ${kickoff}, 'scheduled', 2099, 'POST', 'wild_card',
            ${JSON.stringify({ bdl_game_id: bdl })}::jsonb)
    RETURNING id`;
  made.push(m.id); return m.id;
}
const probablesOf = async (id) => (await sql`SELECT metadata->'probables' AS p FROM matches WHERE id = ${id}`)[0].p;

before(async () => {
  [{ id: league }] = await sql`SELECT id FROM leagues WHERE slug = 'mlb' LIMIT 1`;
  const teams = await sql`SELECT id, abbreviation FROM teams WHERE league_id = ${league} AND abbreviation IS NOT NULL ORDER BY id LIMIT 2`;
  [{ id: home, abbreviation: homeAbbr }, { id: away, abbreviation: awayAbbr }] = teams;
});
after(async () => {
  await sql`DELETE FROM matches WHERE id = ANY(${made}::int[])`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${TAG}-%`}`;
  assert.equal(n, 0, 'the fixture tears itself down');
});

test('THE PASS writes the horizon from one fetch, never wipes, and leaves a game past 36 h alone', async () => {
  const now = new Date();
  const near = await game('near', new Date(now.getTime() + 9 * 3600_000).toISOString(), BDL_NEAR);
  const far = await game('far', new Date(now.getTime() + (HORIZON_HOURS + 6) * 3600_000).toISOString(), BDL_FAR);

  const row = (gameId, abbr, p) => ({
    game_id: Number(gameId), is_probable_pitcher: true, position: 'SP', batting_order: null,
    team: { abbreviation: abbr },
    player: { id: Number(p.id), full_name: p.name, bats_throws: `L/${p.hand}` },
  });
  const asked = [];
  let answer = [row(BDL_NEAR, awayAbbr, LUZ), row(BDL_NEAR, homeAbbr, SALE), row(BDL_FAR, homeAbbr, SALE)];
  const fetchRows = async (ids) => { asked.push(ids.map(String)); return answer.filter((r) => ids.map(String).includes(String(r.game_id))); };

  const r1 = await refreshMlbProbables({ now, fetchRows });
  assert.equal(asked.length, 1, 'one fetch for the whole horizon');
  assert.ok(asked[0].includes(BDL_NEAR), 'the game nine hours out is asked about - the poller would not see it for five more');
  assert.ok(!asked[0].includes(BDL_FAR), 'a game past the horizon is not');
  assert.ok(r1.wrote >= 1);
  assert.deepEqual(await probablesOf(near), { away: LUZ, home: SALE }, 'written in the shape every reader holds, with the hand');
  assert.equal(await probablesOf(far), null);

  // BDL drops the home side for one fetch: the stored side survives.
  answer = [row(BDL_NEAR, awayAbbr, LUZ)];
  const r2 = await refreshMlbProbables({ now, fetchRows });
  assert.deepEqual(await probablesOf(near), { away: LUZ, home: SALE }, 'no wipe');
  assert.equal(r2.wrote, 0, 'and no write at all - nothing changed');
});
