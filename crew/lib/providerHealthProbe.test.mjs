// crew/lib/providerHealthProbe.test.mjs - provider-health's BDL probe, the real bin end to end.
// fetch is a stub preloaded with --import (stubPath -> test-tmp/): the DB answers by view, BDL by
// path. No network, no secret. Pure judgement is tested directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubPath } from '../../lib/testing/stubDir.mjs';
import { BDL_ENDPOINTS, judgeProbe } from './bdlProbe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'provider-health');
const KEY = 'FAKEBDLKEY_9f8e7d6c5b4a';
const SUMMARY = /^SUMMARY provider-health status=(ok|regression) providers=\d+ stale=\d+ stalest=\S+ probe=(ok|bad|skipped) ratelimit_low=(-|[a-z,]+)$/;

// bdl: path -> { status, remaining, limit }; anything not listed answers 200 with plenty left.
function run({ bdl = {}, token = true, hang = false } = {}) {
  const stub = stubPath('provider-health-fetch.mjs');
  writeFileSync(stub, `
const BDL = ${JSON.stringify(bdl)};
globalThis.__calls = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.balldontlie.io/')) {
    const p = new URL(url).pathname.slice(1);
    if (init.headers.Authorization !== ${JSON.stringify(KEY)}) return new Response('', { status: 401 });
    if (${JSON.stringify(hang)} && p === 'nba/v1/plays') return new Promise((_, rej) => { setTimeout(() => {}, 6000); init.signal.addEventListener('abort', () => rej(new DOMException('t', 'TimeoutError'))); });
    const o = BDL[p] ?? {};
    return new Response('{}', { status: o.status ?? 200, headers: { 'x-ratelimit-remaining': String(o.remaining ?? 590), 'x-ratelimit-limit': String(o.limit ?? 600) } });
  }
  const q = JSON.parse(init.body).queries.at(-1).query;
  const rows = /provider_freshness_v/.test(q) ? [{ provider: 'bdl', max_age_min: 30, expected: false, age_min: 2 }] : [];
  return new Response(JSON.stringify({ results: [{ rows }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
`);
  const dir = mkdtempSync(path.join(tmpdir(), 'crew-ph-'));
  writeFileSync(path.join(dir, 'crew-reader.env'), 'CREW_READER_URL=postgres://reader:not-a-secret@db.invalid/neondb\n');
  if (token) writeFileSync(path.join(dir, 'bdl.token'), `${KEY}\n`);
  try {
    return spawnSync(process.execPath, ['--import', stub, BIN], {
      encoding: 'utf8', timeout: 15_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, CREW_SECRETS_DIR: dir },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(stub, { force: true }); }
}
const last = (r) => r.stdout.trimEnd().split('\n').at(-1);

test('the endpoint list covers the NBA live routes and every sport the poller reads', () => {
  const names = BDL_ENDPOINTS.map((e) => e.endpoint);
  for (const n of ['nba/v1/games', 'nba/v1/box_scores/live', 'nba/v1/plays', 'nba/v1/stats', 'nfl/v1/games', 'ncaaf/v1/games', 'mlb/v1/games']) {
    assert.ok(names.includes(n), n);
  }
  assert.equal(new Set(names).size, names.length);
});

test('judgeProbe: 401/403/429 are bad; 500 and a silent endpoint are not; low is per sport under 10%', () => {
  const j = judgeProbe([
    { sport: 'nba', endpoint: 'nba/v1/plays', status: 401, remaining: 5, limit: 600 },
    { sport: 'nba', endpoint: 'nba/v1/games', status: 200, remaining: 400, limit: 600 },
    { sport: 'nfl', endpoint: 'nfl/v1/games', status: 429, remaining: 0, limit: 600 },
    { sport: 'mlb', endpoint: 'mlb/v1/games', status: 500, remaining: 59, limit: 600 },
    { sport: 'ncaaf', endpoint: 'ncaaf/v1/games', status: 0, remaining: null, limit: null },
    { sport: 'ncaaf', endpoint: 'ncaaf/v1/player_stats', status: 200, remaining: 60, limit: 600 },
  ]);
  assert.deepEqual(j.bad.map((b) => `${b.endpoint}:${b.status}`), ['nba/v1/plays:401', 'nfl/v1/games:429']);
  assert.deepEqual(j.low.map((l) => `${l.sport}:${l.remaining}`), ['nba:5', 'nfl:0', 'mlb:59']);
  assert.equal(j.silent, 1);
});

test('provider-health, all BDL ok: exit 0, probe=ok, key never printed', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(last(r), SUMMARY);
  assert.match(last(r), /status=ok .* probe=ok ratelimit_low=-$/);
  assert.match(r.stdout, /bdl probe 12 endpoints: all ok/);
  assert.ok(!(r.stdout + r.stderr).includes(KEY));
});

test('provider-health: a 401 on /nba/v1/box_scores/live is STALE and names the endpoint', () => {
  const r = run({ bdl: { 'nba/v1/box_scores/live': { status: 401 } } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(last(r), SUMMARY);
  assert.match(last(r), /status=regression providers=1 stale=1 stalest=bdl:nba\/v1\/box_scores\/live:401 probe=bad/);
  assert.match(r.stdout, /BAD nba\/v1\/box_scores\/live:401/);
});

test('provider-health: 403 and 429 on other endpoints are stale too', () => {
  for (const [ep, status] of [['nba/v1/plays', 403], ['nfl/v1/stats', 429], ['mlb/v1/games', 429]]) {
    const r = run({ bdl: { [ep]: { status } } });
    assert.equal(r.status, 1, ep);
    assert.match(last(r), new RegExp(`stalest=bdl:${ep.replace(/\//g, '\\/')}:${status} `));
  }
});

test('provider-health: low rate limit is reported per sport, informational (exit 0)', () => {
  const r = run({ bdl: { 'nba/v1/games': { remaining: 30, limit: 600 }, 'nfl/v1/games': { remaining: 60, limit: 600 } } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ratelimit LOW nba remaining=30 limit=600/);
  assert.ok(!/ratelimit LOW nfl/.test(r.stdout), 'exactly 10% is not under 10%');
  assert.match(last(r), /probe=ok ratelimit_low=nba$/);
});

test('provider-health: no bdl.token skips the probe (exit 0, probe=skipped); a hung endpoint does not fail the run', () => {
  const none = run({ token: false });
  assert.equal(none.status, 0, none.stderr);
  assert.match(last(none), /probe=skipped ratelimit_low=-$/);
  assert.match(none.stdout, /bdl probe skipped/);
  const hung = run({ hang: true });
  assert.equal(hung.status, 0, hung.stderr + hung.stdout);
  assert.match(hung.stdout, /\(no answer from 1\)/);
});
