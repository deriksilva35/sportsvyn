// crew/lib/gameWatch.test.mjs - thu-4: game-watch, the real bin end to end. The database is a fetch
// stub preloaded with --import (written to test-tmp/ via stubPath), keyed on the view each query
// reads, so no network and no secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubPath } from '../../lib/testing/stubDir.mjs';
import { summarize, SQL } from './gameWatch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'game-watch');
const SUMMARY = /^SUMMARY game-watch g1=(\d+) g2=(\d+) g3=(\d+) g4=(\d+) g5=(\d+) g6=(\d+) status=(ok|regression)$/;

// `rows`: view name -> rows; `missing`: a view that does not exist (the database answers 400).
function runGameWatch(rows = {}, { missing = null, args = [], secrets = true } = {}) {
  const stub = stubPath('game-watch-fetch.mjs');
  writeFileSync(stub, `
const ROWS = ${JSON.stringify(rows)};
const MISSING = ${JSON.stringify(missing)};
globalThis.fetch = async (url, init) => {
  const q = JSON.parse(init.body).queries.at(-1).query;
  const view = (q.match(/crew_stats\\.([a-z0-9_]+)/) ?? [])[1];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (view === MISSING) return json(400, { code: '42P01', message: 'relation "crew_stats.' + view + '" does not exist' });
  return json(200, { results: [{ rows: ROWS[view] ?? [] }] });
};
`);
  const dir = mkdtempSync(path.join(tmpdir(), 'crew-gw-'));
  if (secrets) writeFileSync(path.join(dir, 'crew-reader.env'), 'CREW_READER_URL=postgres://reader:not-a-secret@db.invalid/neondb\n');
  try {
    return spawnSync(process.execPath, ['--import', stub, BIN, ...args], {
      encoding: 'utf8', timeout: 15_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CREW_SECRETS_DIR: dir },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(stub, { force: true });
  }
}
const lines = (r) => r.stdout.trimEnd().split('\n');

test('game-watch quiet: exit 0, SUMMARY all zeros, status=ok', () => {
  const r = runGameWatch();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lines(r).length, 1);
  assert.equal(lines(r)[0], 'SUMMARY game-watch g1=0 g2=0 g3=0 g4=0 g5=0 g6=0 status=ok');
});

const FIRING = [
  ['g1_lock_unstarted', { contest_id: 7, game_type: 'pickem', match_id: 42, slug: 'a-vs-b', minutes_past: 31 }, /^G1 page 42 contest=7 pickem match=a-vs-b still_scheduled minutes_past=31$/, 'g1'],
  ['g2_card_incomplete', { contest_id: 9, game_type: 'october', games: '3', pickable: '0', dangling: '0', hours_open: 13, why: 'no pickable game before lock' }, /^G2 page 9 october no_pickable_game_before_lock games=3 pickable=0 dangling=0 hours_open=13$/, 'g2'],
  ['g3_kickoff_midnight_untbd', { match_id: 55, league: 'cfb', slug: 'x-y', minutes_to_kickoff: 3457 }, /^G3 warn 55 cfb x-y midnight_et_no_tbd minutes_to_kickoff=3457$/, 'g3'],
  ['g4_board_unsettled', { contest_id: 11, game_type: 'pickem', games: '4', finals: '4', hours_since_last_final: 7 }, /^G4 warn 11 pickem games=4 finals=4 hours_since_last_final=7$/, 'g4'],
  ['g5_retention_not_ok', { run_id: null, kind: null, hours_since_start: null, why: 'no run recorded' }, /^G5 warn data-retention no_run_recorded kind=- hours_since_start=-$/, 'g5'],
  ['live_matches_v', { match_id: 99, league_slug: 'cfb', minutes_frozen: 44, home_score: 0, away_score: 0, period: '1', clock: '13:40' }, /^G6 live 99 cfb frozen_min=44 score=0-0 period=1 clock=13:40$/, 'g6'],
];

for (const [view, row, want, g] of FIRING) {
  test(`game-watch ${g.toUpperCase()} fires: its line, its count, exit 1`, () => {
    const r = runGameWatch({ [view]: [row] });
    assert.equal(r.status, 1, r.stderr);
    const out = lines(r);
    assert.equal(out.length, 2);
    assert.match(out[0], want);
    const m = out[1].match(SUMMARY);
    assert.ok(m, out[1]);
    assert.equal(m[7], 'regression');
    const counts = m.slice(1, 7).map(Number);
    assert.deepEqual(counts, [1, 2, 3, 4, 5, 6].map((n) => (`g${n}` === g ? 1 : 0)));
  });
}

test('game-watch severities follow watch-rules.md', () => {
  const sev = (rows) => summarize(rows).lines[0].split(' ')[1];
  assert.equal(sev({ g1: [{ match_id: 1, minutes_past: 30 }] }), 'warn');
  assert.equal(sev({ g1: [{ match_id: 1, minutes_past: 31 }] }), 'page');
  assert.equal(sev({ g2: [{ contest_id: 1, dangling: 2, hours_open: 99, why: 'dangling match_id' }] }), 'warn');
  assert.equal(sev({ g2: [{ contest_id: 1, dangling: 0, hours_open: 12 }] }), 'warn');
  assert.equal(sev({ g3: [{ match_id: 1, minutes_to_kickoff: 1440 }] }), 'page');
  assert.equal(sev({ g3: [{ match_id: 1, minutes_to_kickoff: 1441 }] }), 'warn');
  assert.equal(sev({ g4: [{ contest_id: 1, hours_since_last_final: 24 }] }), 'page');
  assert.equal(sev({ g5: [{ why: 'last run not ok', hours_since_start: 3 }] }), 'page');
  assert.equal(sev({ g5: [{ why: 'last run older than 26h', hours_since_start: 30 }] }), 'warn');
  assert.equal(sev({ g5: [{ why: 'last run older than 26h', hours_since_start: 51 }] }), 'page');
  assert.equal(summarize({ g6: [{ match_id: 3, minutes_frozen: 20 }] }).lines[0].split(' ').slice(0, 3).join(' '), 'G6 live 3');
});

test('game-watch reads only the crew_stats views, G6 over live_matches_v, with the halftime exclusion', () => {
  for (const [g, sql] of Object.entries(SQL)) assert.match(sql, /FROM crew_stats\.[a-z0-9_]+/, g);
  assert.match(SQL.g6, /crew_stats\.live_matches_v/);
  assert.match(SQL.g6, /interval '15 minutes'/);
  assert.match(SQL.g6, /ILIKE 'HT%'/);
});

test('game-watch: a missing view exits 2 with reason=<kind>:<host>', () => {
  const r = runGameWatch({}, { missing: 'g3_kickoff_midnight_untbd' });
  assert.equal(r.status, 2);
  assert.match(lines(r).at(-1), /^SUMMARY game-watch status=error reason=(unreachable|auth|not_found|timeout):db\.invalid$/);
  assert.ok(!r.stdout.includes('not-a-secret'));
});

test('game-watch: no secret file is exit 2; any argument is exit 2 before the database is touched', () => {
  const none = runGameWatch({}, { secrets: false });
  assert.equal(none.status, 2);
  assert.match(lines(none).at(-1), /^SUMMARY game-watch status=error reason=auth:crew-reader\.env$/);
  for (const args of [['--apply'], ['5'], ['g1']]) {
    const r = runGameWatch({}, { args });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(lines(r).at(-1), /^SUMMARY game-watch status=error reason=not_found:args$/);
  }
});
