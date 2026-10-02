// lib/soccer/eplDedupe.test.mjs - one row per EPL fixture (thu-24): which row
// stays, what happens to references, refusals, and the run itself on DEV
// against a pair this file makes (season 2099, a fixture id no real row
// carries) and removes. The parent runs the script on PROD at merge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from '../db.js';
import { groupPairs, keptFirst, findEplDuplicates, matchForeignKeys, planPair, applyPair, dedupeEpl, describePlan } from './eplDedupe.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('THE KEPT ROW is the provider\'s: newest sync, then the higher id', () => {
  const rows = [
    { id: 24649, fixture: '1557412', data_provider_synced_at: '2026-09-02T13:25:00Z' },
    { id: 28832, fixture: '1557412', data_provider_synced_at: '2026-09-28T13:25:00Z' },
    { id: 1, fixture: '9', data_provider_synced_at: null },
    { id: 2, fixture: '9', data_provider_synced_at: null },
  ];
  const pairs = groupPairs(rows);
  assert.equal(pairs[0].keep.id, 28832); assert.deepEqual(pairs[0].stale.map((r) => r.id), [24649]);
  assert.equal(pairs[1].keep.id, 2, 'no sync on either: the later row');
  assert.ok(keptFirst({ id: 1, data_provider_synced_at: '2026-09-02' }, { id: 2, data_provider_synced_at: null }) < 0);
});

test('A RESTRICT reference or a soft one REFUSES the pair; SET NULL is left to the database', async () => {
  const fake = Object.assign(async (strings) => {
    const q = strings.join('?');
    if (/FROM contests/.test(q)) return [{ n: 1 }];
    return [{ n: 0 }];
  }, { query: async (q, [id]) => [{ n: /survivor_picks|articles/.test(q) && id === 2 ? 3 : 0 }] });
  const plan = await planPair(fake, { fixture: '9', keep: { id: 1 }, stale: [{ id: 2 }] },
    [{ table: 'survivor_picks', column: 'match_id', onDelete: 'r' }, { table: 'articles', column: 'match_id', onDelete: 'n' }]);
  assert.deepEqual(plan.stale[0].refuse, ['survivor_picks: 3 (restrict)', 'contests: 1 (soft reference)']);
  assert.equal(plan.stale[0].nulled[0].table, 'articles');
  const done = await applyPair(fake, plan);
  assert.deepEqual(done, [{ id: 2, refused: plan.stale[0].refuse }], 'nothing is written for a refused row');
});

test('THE SYNC NO LONGER FORKS: a fixture id already on a row is updated in place, slug kept', () => {
  const epl = src('lib/soccer/epl.js');
  const fn = epl.slice(epl.indexOf('export async function upsertEplFixtures'), epl.indexOf('export async function syncEpl'));
  const lookup = fn.indexOf("external_ids->>'api_sports' = ${String(f.fixture.id)}");
  assert.ok(lookup > 0 && lookup < fn.indexOf('INSERT INTO matches'), 'find by fixture id before inserting');
  assert.match(fn, /UPDATE matches SET[\s\S]*WHERE id = \$\{existing\[0\]\.id\}/);
  assert.doesNotMatch(fn.slice(fn.indexOf('UPDATE matches SET'), fn.indexOf('WHERE id = ${existing[0].id}')), /slug =/, 'a reschedule keeps the link');
});

test('THE SCRIPT: dry run by default, PROD only by flag, credential from env', () => {
  const s = src('scripts/epl-dedupe-fixtures.mjs');
  assert.match(s, /const APPLY = args\.includes\('--apply'\)/);
  assert.match(s, /PROD \? process\.env\.PROD_DATABASE_URL : process\.env\.DATABASE_URL/);
  assert.match(s, /dedupeEpl\(sql, \{ season, apply: APPLY \}\)/);
  assert.doesNotMatch(s, /postgres(ql)?:\/\//, 'no connection string in the file');
});

// ---------------------------------------------------------------------------
// DEV: a real pair, moved and deleted
// ---------------------------------------------------------------------------

const SEASON = 2099;
const FX = '998877001';
const tag = `zz-epl-dedupe-${process.pid}`;
let keepId; let staleId; let lgId;

before(async () => {
  const lg = await sql`SELECT id FROM leagues WHERE slug = 'epl'`;
  lgId = lg[0].id;
  const t = await sql`SELECT id FROM teams WHERE league_id = ${lgId} ORDER BY id LIMIT 2`;
  const ext = JSON.stringify({ api_sports: FX });
  const r = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, external_ids, data_provider_synced_at)
    VALUES (${lgId}, ${`${tag}-2099-09-19`}, ${t[0].id}, ${t[1].id}, '2099-09-19T14:00Z', 'scheduled', ${SEASON}, ${ext}::jsonb, '2099-09-02T13:25Z'),
           (${lgId}, ${`${tag}-2099-09-20`}, ${t[0].id}, ${t[1].id}, '2099-09-20T13:00Z', 'final', ${SEASON}, ${ext}::jsonb, '2099-09-28T13:25Z')
    RETURNING id, slug`;
  staleId = r.find((x) => x.slug.endsWith('19')).id;
  keepId = r.find((x) => x.slug.endsWith('20')).id;
  // The stale row's timeline: the kept row has none, so it MOVES.
  await sql`INSERT INTO match_events (match_id, minute, event_type, team_side) VALUES (${staleId}, 5, 'Goal', 'home')`;
  // Both have broadcasters: the stale one's are DROPPED with it.
  await sql`INSERT INTO match_broadcasters (match_id, country_code, broadcaster_name, broadcaster_type)
            VALUES (${staleId}, 'US', 'Peacock', 'streaming'), (${keepId}, 'US', 'USA', 'tv')`;
});

after(async () => {
  await sql`DELETE FROM matches WHERE slug LIKE ${`${tag}%`}`;
  const left = await sql`SELECT count(*)::int AS n FROM matches WHERE slug LIKE ${`${tag}%`}`;
  assert.equal(left[0].n, 0, 'teardown removed the pair');
});

test('DEV: the pair is found, planned, applied - events moved, broadcasters dropped, stale row gone - and a second run finds nothing', async () => {
  const pairs = await findEplDuplicates(sql, { season: SEASON });
  assert.equal(pairs.length, 1); assert.equal(pairs[0].keep.id, keepId); assert.deepEqual(pairs[0].stale.map((r) => r.id), [staleId]);

  const fks = await matchForeignKeys(sql);
  assert.ok(fks.some((f) => f.table === 'odds_markets' && f.onDelete === 'c'));
  const plan = await planPair(sql, pairs[0], fks);
  assert.deepEqual(plan.stale[0].move.map((m) => [m.table, m.n]), [['match_events', 1]]);
  assert.deepEqual(plan.stale[0].drop.map((m) => [m.table, m.n]), [['match_broadcasters', 1]]);
  assert.deepEqual(plan.stale[0].refuse, []);
  assert.match(describePlan(plan), new RegExp(`stale ${staleId} .* move match_events 1 / drop match_broadcasters 1`));

  const dry = await dedupeEpl(sql, { season: SEASON });
  assert.equal(dry.results, null, 'a dry run writes nothing');
  assert.equal((await sql`SELECT count(*)::int AS n FROM matches WHERE id = ${staleId}`)[0].n, 1);

  const run = await dedupeEpl(sql, { season: SEASON, apply: true });
  assert.equal(run.results[0].done[0].id, staleId);
  assert.equal((await sql`SELECT count(*)::int AS n FROM matches WHERE id = ${staleId}`)[0].n, 0, 'stale row deleted');
  assert.equal((await sql`SELECT count(*)::int AS n FROM match_events WHERE match_id = ${keepId}`)[0].n, 1, 'its timeline moved to the kept row');
  assert.deepEqual((await sql`SELECT broadcaster_name FROM match_broadcasters WHERE match_id = ${keepId}`).map((r) => r.broadcaster_name), ['USA']);
  assert.equal((await dedupeEpl(sql, { season: SEASON })).pairs, 0, 'idempotent: nothing left to do');
});
