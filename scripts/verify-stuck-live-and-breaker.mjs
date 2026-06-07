// scripts/verify-stuck-live-and-breaker.mjs
//
// Dev-only verification for the stuck-live timeout + daily-cap breaker.
// Refuses to run on prod. No commit; this just exercises the new code
// against synthetic dev DB state.
//
// The 5 tests the user spec'd:
//   1. DEAD MATCH FLIPS — 200min-old live match resolves to final (API
//      confirms FT since dev API is unblocked, so 'api_confirmed_final').
//   2. LONG MATCH DOES NOT FALSE-FLIP — 140min-old live match stays live
//      (below the 180min threshold; not even a candidate for sweep).
//   3. CIRCUIT BREAKER TRIPS — synthetic daily-cap error → tripDailyCap
//      writes the sentinel → isDailyCapTripped returns true.
//   4. BREAKER CLEARS AT UTC MIDNIGHT — isBreakerEngagedFor with a
//      "yesterday" trippedFor returns false. Pure unit test of the
//      auto-clear logic; no waiting.
//   5. FIX 1 + FIX 2 INTERACTION — breaker tripped + 200min-old live →
//      sweep resolves it via FALLBACK (timer_forced_final_at set,
//      NO API call made — observable by checking the marker column).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnvLocal(p) {
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvLocal(path.resolve(__dirname, '..', '.env.local'));

const host = new URL(process.env.DATABASE_URL).hostname;
if (host.includes('winter-dawn')) throw new Error(`REFUSE: prod (${host})`);
console.log(`✓ dev host: ${host}\n`);

const { sql } = await import('../lib/db.js');
const {
  STUCK_LIVE_TIMEOUT_MIN,
  sweepStuckLive,
} = await import('../lib/stuckLiveSweep.js');
const {
  isDailyCapTripped,
  tripDailyCap,
  clearDailyCap,
  isBreakerEngagedFor,
  readBreakerSentinel,
} = await import('../lib/cronCircuitBreaker.js');
const { DailyCapError, isDailyCapError } = await import('../lib/apiSports.js');

console.log(`STUCK_LIVE_TIMEOUT_MIN = ${STUCK_LIVE_TIMEOUT_MIN}\n`);

// ============================================================================
// Test scaffolding — pick two finished dev matches we can temporarily flip
// to 'live' with synthetic kickoff times, then restore.
// ============================================================================
async function takeSnapshot(matchId) {
  const r = await sql`SELECT id, status, home_score, away_score, kickoff_at, timer_forced_final_at FROM matches WHERE id = ${matchId}`;
  return r[0];
}
async function restoreSnapshot(snap) {
  await sql`
    UPDATE matches SET
      status = ${snap.status},
      home_score = ${snap.home_score},
      away_score = ${snap.away_score},
      kickoff_at = ${snap.kickoff_at},
      timer_forced_final_at = ${snap.timer_forced_final_at}
    WHERE id = ${snap.id}
  `;
}
async function makeLive(matchId, minutesAgo) {
  const kickoff = new Date(Date.now() - minutesAgo * 60_000);
  await sql`
    UPDATE matches SET status='live', kickoff_at=${kickoff}, timer_forced_final_at=NULL
    WHERE id = ${matchId}
  `;
}

// Pick two final-status dev matches we can temporarily borrow.
const borrowed = await sql`
  SELECT id, slug FROM matches WHERE status = 'final' ORDER BY id DESC LIMIT 2
`;
if (borrowed.length < 2) throw new Error('Need at least 2 final matches on dev to borrow');
const TEST_A = borrowed[0]; // dead-match test
const TEST_B = borrowed[1]; // long-match-no-false-flip test
console.log(`borrowing for tests:`);
console.log(`  TEST_A (id=${TEST_A.id}, slug=${TEST_A.slug}) — dead match (200min ago)`);
console.log(`  TEST_B (id=${TEST_B.id}, slug=${TEST_B.slug}) — long but-still-playing (140min ago)`);

const snapA = await takeSnapshot(TEST_A.id);
const snapB = await takeSnapshot(TEST_B.id);
const breakerSnap = await readBreakerSentinel();
console.log(`pre-test breaker state: ${breakerSnap ? JSON.stringify(breakerSnap.value) : '(no sentinel row)'}\n`);

async function safeRestoreAll() {
  await restoreSnapshot(snapA);
  await restoreSnapshot(snapB);
  await clearDailyCap();
  if (breakerSnap) {
    await sql`INSERT INTO cron_state (key, value, updated_at) VALUES ('poll_live_daily_cap_tripped', ${JSON.stringify(breakerSnap.value)}::jsonb, ${breakerSnap.updated_at}) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`;
  }
}

const results = {};
try {
  // ==========================================================================
  // TEST 1: dead match (200min ago) flips to 'final'
  // ==========================================================================
  console.log('═'.repeat(80));
  console.log('TEST 1 — DEAD MATCH FLIPS (200min ago, breaker clear)');
  console.log('═'.repeat(80));
  await clearDailyCap();
  await makeLive(TEST_A.id, 200);
  const beforeA = await takeSnapshot(TEST_A.id);
  console.log(`  setup: ${TEST_A.slug} status=${beforeA.status}, kickoff=${beforeA.kickoff_at.toISOString()} (${200}min ago)`);
  const sweep1 = await sweepStuckLive({ breakerTripped: false });
  console.log(`  sweep result: ${JSON.stringify(sweep1, null, 2)}`);
  const afterA = await takeSnapshot(TEST_A.id);
  console.log(`  after: status=${afterA.status}, timer_forced_final_at=${afterA.timer_forced_final_at?.toISOString() ?? 'NULL'}`);
  const pass1 = afterA.status === 'final';
  results.test1 = { pass: pass1, outcome: afterA.status, forced: !!afterA.timer_forced_final_at };
  console.log(`  RESULT: ${pass1 ? '✓ PASS' : '✗ FAIL'} — match flipped to '${afterA.status}'\n`);

  // ==========================================================================
  // TEST 2 — THE CRITICAL ONE — 140min match must NOT false-flip
  // ==========================================================================
  console.log('═'.repeat(80));
  console.log('TEST 2 — LONG MATCH DOES NOT FALSE-FLIP (140min, below threshold)');
  console.log('═'.repeat(80));
  await clearDailyCap();
  await makeLive(TEST_B.id, 140);
  const beforeB = await takeSnapshot(TEST_B.id);
  console.log(`  setup: ${TEST_B.slug} status=${beforeB.status}, kickoff=${beforeB.kickoff_at.toISOString()} (140min ago — should not be a sweep candidate)`);
  const sweep2 = await sweepStuckLive({ breakerTripped: false });
  // Verify the 140min match wasn't even a candidate — sweep.swept should
  // be 0 OR (if TEST_A's restore later picks something up, the count
  // may include unrelated ones — we check OUR row specifically).
  const ourInSwept = sweep2.resolved.find((r) => r.slug === TEST_B.slug)
                  || sweep2.wouldNotFlip.find((r) => r.slug === TEST_B.slug);
  console.log(`  sweep ran; was our 140min match included? ${ourInSwept ? 'YES (would be a bug)' : 'no'}`);
  const afterB = await takeSnapshot(TEST_B.id);
  console.log(`  after: status=${afterB.status}, timer_forced_final_at=${afterB.timer_forced_final_at?.toISOString() ?? 'NULL'}`);
  const pass2 = afterB.status === 'live' && !afterB.timer_forced_final_at && !ourInSwept;
  results.test2 = { pass: pass2, outcome: afterB.status, in_sweep_set: !!ourInSwept };
  console.log(`  RESULT: ${pass2 ? '✓ PASS' : '✗ FAIL'} — match stayed live, NOT in sweep set\n`);

  // ==========================================================================
  // TEST 3 — Circuit breaker trips on synthetic daily-cap detection
  // ==========================================================================
  console.log('═'.repeat(80));
  console.log('TEST 3 — CIRCUIT BREAKER TRIPS');
  console.log('═'.repeat(80));
  await clearDailyCap();

  // 3a — pure-detector unit: known shapes
  const apiCapShape = { requests: 'You have reached the request limit for the day, Go to https://...' };
  const apiOtherErr = { someOther: 'Something else broke' };
  const apiEmpty    = null;
  const pass3a =
       isDailyCapError(apiCapShape) === true
    && isDailyCapError(apiOtherErr) === false
    && isDailyCapError(apiEmpty)    === false;
  console.log(`  3a · isDailyCapError on synthetic shapes: ${pass3a ? '✓' : '✗'}`);
  console.log(`     · daily-cap body  → ${isDailyCapError(apiCapShape)} (expect true)`);
  console.log(`     · other-error     → ${isDailyCapError(apiOtherErr)} (expect false)`);
  console.log(`     · empty/null      → ${isDailyCapError(apiEmpty)} (expect false)`);

  // 3b — DailyCapError class shape
  const capErr = new DailyCapError('/fixtures?id=1', apiCapShape);
  const pass3b = capErr instanceof DailyCapError && capErr.name === 'DailyCapError' && capErr.body === apiCapShape;
  console.log(`  3b · DailyCapError class: ${pass3b ? '✓' : '✗'}`);

  // 3c — trip + read flow
  const beforeTrip = await isDailyCapTripped();
  await tripDailyCap({ reason: 'test_3c' });
  const afterTrip  = await isDailyCapTripped();
  const sentinel   = await readBreakerSentinel();
  const pass3c = beforeTrip === false && afterTrip === true && sentinel?.value?.trippedFor === new Date().toISOString().slice(0, 10);
  console.log(`  3c · trip + read flow: ${pass3c ? '✓' : '✗'}`);
  console.log(`     · before trip: isDailyCapTripped = ${beforeTrip} (expect false)`);
  console.log(`     · after trip:  isDailyCapTripped = ${afterTrip} (expect true)`);
  console.log(`     · sentinel value: ${JSON.stringify(sentinel?.value)}`);

  results.test3 = { pass: pass3a && pass3b && pass3c };
  console.log(`  RESULT: ${results.test3.pass ? '✓ PASS' : '✗ FAIL'}\n`);

  // ==========================================================================
  // TEST 4 — Breaker auto-clears at UTC midnight (pure date-comparison test)
  // ==========================================================================
  console.log('═'.repeat(80));
  console.log('TEST 4 — BREAKER CLEARS AT UTC MIDNIGHT (date-comparison logic)');
  console.log('═'.repeat(80));
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const pass4 =
       isBreakerEngagedFor({ trippedFor: today },     today) === true
    && isBreakerEngagedFor({ trippedFor: yesterday }, today) === false
    && isBreakerEngagedFor(null,                       today) === false;
  console.log(`  trippedFor = today      → engaged? ${isBreakerEngagedFor({trippedFor:today}, today)} (expect true)`);
  console.log(`  trippedFor = yesterday  → engaged? ${isBreakerEngagedFor({trippedFor:yesterday}, today)} (expect false)`);
  console.log(`  no sentinel             → engaged? ${isBreakerEngagedFor(null, today)} (expect false)`);
  results.test4 = { pass: pass4 };
  console.log(`  RESULT: ${pass4 ? '✓ PASS' : '✗ FAIL'}\n`);

  // ==========================================================================
  // TEST 5 — Fix 1 + Fix 2 interaction:
  //   breaker tripped + 200min-old live → sweep resolves via fallback
  //   (timer_forced_final_at set, NO API call made)
  // ==========================================================================
  console.log('═'.repeat(80));
  console.log('TEST 5 — INTERACTION: breaker tripped + 200min match → fallback');
  console.log('═'.repeat(80));
  // Set up: leave breaker tripped from TEST 3. Make TEST_A live + 200min ago again.
  const stillTripped = await isDailyCapTripped();
  if (!stillTripped) {
    console.log('  (breaker not still tripped — re-tripping for this test)');
    await tripDailyCap({ reason: 'test_5_setup' });
  }
  await makeLive(TEST_A.id, 200);
  const before5 = await takeSnapshot(TEST_A.id);
  console.log(`  setup: breaker tripped, ${TEST_A.slug} status=live, kickoff 200min ago`);
  const sweep5 = await sweepStuckLive({ breakerTripped: true });
  console.log(`  sweep result outcome for our match:`);
  const ourRes = sweep5.resolved.find((r) => r.slug === TEST_A.slug);
  console.log(`    ${JSON.stringify(ourRes)}`);
  const after5 = await takeSnapshot(TEST_A.id);
  console.log(`  after: status=${after5.status}, timer_forced_final_at=${after5.timer_forced_final_at?.toISOString() ?? 'NULL'}`);
  const pass5 =
       after5.status === 'final'
    && !!after5.timer_forced_final_at   // fallback path marker must be set
    && ourRes?.outcome === 'timer_forced_final'
    && ourRes?.reason === 'breaker_tripped';
  results.test5 = { pass: pass5, outcome: after5.status, forced: !!after5.timer_forced_final_at, reason: ourRes?.reason };
  console.log(`  RESULT: ${pass5 ? '✓ PASS' : '✗ FAIL'}\n`);

} finally {
  // Always restore original state so dev DB is clean.
  await safeRestoreAll();
  console.log('--- dev state restored (match snapshots reverted, breaker cleared/restored) ---');
}

// ============================================================================
// Summary
// ============================================================================
console.log('\n' + '═'.repeat(80));
console.log('SUMMARY');
console.log('═'.repeat(80));
for (const [name, r] of Object.entries(results)) {
  console.log(`  ${name}: ${r.pass ? '✓ PASS' : '✗ FAIL'} ${JSON.stringify(r)}`);
}
const allPass = Object.values(results).every((r) => r.pass);
console.log(`\n${allPass ? '✓ ALL 5 TESTS PASS' : '✗ FAILURES — review above'}`);
