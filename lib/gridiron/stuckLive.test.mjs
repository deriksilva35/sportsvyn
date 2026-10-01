// lib/gridiron/stuckLive.test.mjs — the gridiron stuck-live net (tue-15).
// Both arms: the provider must say it is over AND the row must be quiet 30 min.
// Run: node --test lib/gridiron/stuckLive.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictFor, etDate, providerStatuses, sweepStuckGridiron, STALE_MIN, NET_LEAGUES } from './stuckLive.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = new Date('2026-10-04T22:00:00Z');
const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();

test('ARM 1 - the provider must say it is over: final or vanished, nothing else', () => {
  for (const s of ['final', 'vanished']) assert.equal(verdictFor({ providerStatus: s, lastWriteAt: ago(45), now: NOW }), 'force', s);
  for (const s of ['live', 'scheduled', 'unreachable', 'postponed', 'unknown', null, undefined]) {
    assert.equal(verdictFor({ providerStatus: s, lastWriteAt: ago(600), now: NOW }), 'leave', String(s));
  }
});

test('ARM 2 - we must have been quiet 30 minutes: a fresh write always wins', () => {
  assert.equal(STALE_MIN, 30);
  assert.equal(verdictFor({ providerStatus: 'final', lastWriteAt: ago(29), now: NOW }), 'leave');
  assert.equal(verdictFor({ providerStatus: 'final', lastWriteAt: ago(30), now: NOW }), 'force');
  assert.equal(verdictFor({ providerStatus: 'vanished', lastWriteAt: ago(5), now: NOW }), 'leave');
  assert.equal(verdictFor({ providerStatus: 'final', lastWriteAt: null, now: NOW }), 'leave', 'no write time is not evidence');
});

test('TIME SINCE KICKOFF NEVER FORCES: the verdict does not even take it', () => {
  // A weather-delayed game 9 hours after kickoff that the provider calls live.
  assert.equal(verdictFor({ providerStatus: 'live', lastWriteAt: ago(90), now: NOW, kickoffAt: ago(540) }), 'leave');
  const src = readFileSync(path.join(REPO, 'lib/gridiron/stuckLive.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src.slice(src.indexOf('export async function sweepStuckGridiron')), /kickoff_at\s*</, 'no kickoff threshold in the sweep');
});

test('BDL files NFL games by ET date: a 00:20Z kickoff is the previous day', () => {
  assert.equal(etDate('2026-10-05T00:20:00Z'), '2026-10-04');
  assert.equal(etDate('2026-10-04T17:00:00Z'), '2026-10-04');
});

test('providerStatuses: found, vanished, and an erroring feed is unreachable (never vanished)', async () => {
  const cands = [
    { id: 1, league_slug: 'cfb', kickoff_at: ago(300), external_ids: { cfbd_game_id: 11 } },
    { id: 2, league_slug: 'cfb', kickoff_at: ago(300), external_ids: { cfbd_game_id: 22 } },
    { id: 3, league_slug: 'nfl', kickoff_at: ago(300), external_ids: { bdl_game_id: 33 } },
    { id: 4, league_slug: 'nfl', kickoff_at: ago(300), external_ids: {} },
  ];
  let cfbCalls = 0;
  const said = await providerStatuses(cands, {
    fetchCfb: async () => { cfbCalls += 1; return [{ id: '11', status: 'final', home: 31, away: 17 }]; },
    fetchNfl: async () => { throw new Error('BDL 503'); },
  });
  assert.deepEqual(said.get(1), { status: 'final', home: 31, away: 17 });
  assert.deepEqual(said.get(2), { status: 'vanished' });
  assert.deepEqual(said.get(3), { status: 'unreachable' }, 'a 503 is silence, not absence');
  assert.deepEqual(said.get(4), { status: 'unreachable' }, 'no provider id, nothing to ask');
  assert.equal(cfbCalls, 1, 'one CFBD call per sweep');
});

// A fake tagged-template client: the SELECT returns the candidates, the UPDATE
// records what it was asked to force (and honours a "fresh write" id list).
function fakeSql(candidates, { freshIds = [] } = {}) {
  const updates = [];
  const fn = async (strings, ...values) => {
    const q = strings.join('?');
    if (/^\s*SELECT/.test(q)) return candidates;
    if (/^\s*UPDATE matches/.test(q)) {
      const id = values[2];
      updates.push({ id, home: values[0], away: values[1] });
      return freshIds.includes(id) ? [] : [{ id }];
    }
    throw new Error(`unexpected query: ${q.slice(0, 60)}`);
  };
  fn.updates = updates;
  return fn;
}

test('THE SWEEP forces only provider-over rows, writes the provider score, and yields to a racing write', async () => {
  const cands = [
    { id: 1, slug: 'over', league_slug: 'cfb', kickoff_at: ago(240), updated_at: ago(45), external_ids: { cfbd_game_id: 1 } },
    { id: 2, slug: 'still-live', league_slug: 'cfb', kickoff_at: ago(600), updated_at: ago(45), external_ids: { cfbd_game_id: 2 } },
    { id: 3, slug: 'gone', league_slug: 'cfb', kickoff_at: ago(1500), updated_at: ago(1300), external_ids: { cfbd_game_id: 3 } },
    { id: 4, slug: 'raced', league_slug: 'cfb', kickoff_at: ago(240), updated_at: ago(45), external_ids: { cfbd_game_id: 4 } },
  ];
  const sql = fakeSql(cands, { freshIds: [4] });
  const out = await sweepStuckGridiron(sql, {
    now: NOW,
    fetchCfb: async () => [
      { id: '1', status: 'final', home: 28, away: 21 },
      { id: '2', status: 'live' },
      { id: '4', status: 'final', home: 3, away: 0 },
    ],
  });
  assert.deepEqual(out.forced.map((f) => f.slug), ['over', 'gone']);
  assert.deepEqual(out.left, [{ slug: 'still-live', provider: 'live' }]);
  assert.deepEqual(sql.updates.find((u) => u.id === 1), { id: 1, home: 28, away: 21 }, 'the provider final score is written');
  assert.deepEqual(sql.updates.find((u) => u.id === 3), { id: 3, home: null, away: null }, 'vanished keeps our score');
  assert.ok(sql.updates.some((u) => u.id === 4) && !out.forced.some((f) => f.slug === 'raced'), 'a row written meanwhile is not forced');
});

test('THE SQL: gridiron only, quiet 30 min in BOTH the candidate query and the UPDATE guard', () => {
  assert.deepEqual([...NET_LEAGUES], ['nfl', 'cfb']);
  const s = readFileSync(path.join(REPO, 'lib/gridiron/stuckLive.js'), 'utf8');
  const guard = /updated_at < \$\{now\.toISOString\(\)\}::timestamptz - \(\$\{STALE_MIN\} \|\| ' minutes'\)::interval/g;
  assert.equal((s.match(guard) ?? []).length, 2);
  assert.match(s, /WHERE id = \$\{m\.id\}\s+AND status = 'live'/);
});

test('THE CRON: */5, Bearer-gated, recorded', () => {
  const crons = JSON.parse(readFileSync(path.join(REPO, 'vercel.json'), 'utf8')).crons;
  assert.equal(crons.find((c) => c.path === '/api/cron/stuck-live')?.schedule, '*/5 * * * *');
  const r = readFileSync(path.join(REPO, 'app/api/cron/stuck-live/route.js'), 'utf8');
  assert.match(r, /cronAuthorized\(request\)/);
  assert.match(r, /recordRun\(sql/);
  assert.match(r, /sweepStuckGridiron\(sql/);
});
