// scripts/test-sync-failure.mjs
// Forced-failure test of the sync_log error path. Calls syncFixture()
// with a fixture id API-Sports doesn't recognize, expects a thrown
// error, then asserts that exactly one sync_log row was written with
// `error` populated and score/raw all null. Cleans up after.
//
// Run with: node --env-file=.env.local scripts/test-sync-failure.mjs
// DEV-only. Safe to re-run.

import { sql } from '../lib/db.js';
import { syncFixture } from '../lib/syncFixture.js';

const TEST_ID = 99999999;

let pass = 0;
let fail = 0;
function assert(name, condition) {
  if (condition) {
    console.log(`  PASS · ${name}`);
    pass++;
  } else {
    console.log(`  FAIL · ${name}`);
    fail++;
  }
}

console.log(`=== sync_log error-path test (fixture ${TEST_ID}) ===`);

// (b) baseline count
const before = await sql`SELECT count(*)::int AS n FROM sync_log WHERE fixture_id = ${TEST_ID}`;
console.log(`baseline sync_log rows: ${before[0].n}  (expect 0)`);

// (c) call syncFixture expecting it to throw
let threw = null;
try {
  await syncFixture(TEST_ID);
} catch (err) {
  threw = err;
}
if (threw) {
  console.log(`sync threw as expected: ${threw.message}`);
} else {
  console.log(`sync DID NOT throw — this contradicts the expected error path`);
}

// (d) re-query and print rows
const after = await sql`
  SELECT id, fixture_id, polled_at, status, minute, home_score, away_score, raw, error
  FROM sync_log
  WHERE fixture_id = ${TEST_ID}
  ORDER BY polled_at
`;
console.log(`\nsync_log rows for ${TEST_ID}: ${after.length}`);
for (const r of after) {
  console.log({
    id: r.id,
    fixture_id: r.fixture_id,
    status: r.status,
    minute: r.minute,
    home_score: r.home_score,
    away_score: r.away_score,
    raw: r.raw,
    error: r.error,
  });
}

// (e) assertions
console.log('\nassertions:');
assert('syncFixture threw', threw !== null);
assert('exactly 1 sync_log row exists', after.length === 1);
const row = after[0] ?? {};
assert('error IS NOT NULL', row.error != null && row.error !== '');
assert('home_score IS NULL',  row.home_score === null);
assert('away_score IS NULL',  row.away_score === null);
assert('raw IS NULL',         row.raw === null);

// (f) cleanup — leave no residue
const deleted = await sql`DELETE FROM sync_log WHERE fixture_id = ${TEST_ID} RETURNING id`;
console.log(`\ncleanup: deleted ${deleted.length} row${deleted.length === 1 ? '' : 's'}`);

console.log(`\nresult: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
