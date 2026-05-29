// scripts/test-odds-refresh.mjs — exercises the upsert's baseline-vs-refresh
// behavior end-to-end against the real PSG-Arsenal odds feed. DEV only.
//
// Approach: create a TEMP matches row pointing at API-Sports fixture
// 1544371 (PSG vs Arsenal, has live odds), run three upsert scenarios,
// then DELETE both the odds_markets rows and the temp matches row so
// nothing leaks.
//
// Scenarios:
//   1. First insert (no prior current row)   → baseline = current, movement = 0
//   2. Manually tweak baseline to "yesterday's value" → simulates a 24h-old reference
//      Then hourly refresh (stampBaseline=false) → baseline PRESERVED,
//      movement = current − manipulated baseline
//   3. Daily baseline stamp (stampBaseline=true) → baseline = current,
//      movement = 0
//
// Run with: node --env-file=.env.local scripts/test-odds-refresh.mjs

import { sql } from '../lib/db.js';
import { upsertMatchWinnerOdds } from '../lib/odds.js';

const FIXTURE_ID = 1544371;
const TEMP_SLUG = 'temp-test-psg-vs-arsenal-2026-05-30';

let pass = 0;
let fail = 0;
function assert(name, condition, expected = '', actual = '') {
  if (condition) { console.log(`  PASS · ${name}`); pass++; }
  else { console.log(`  FAIL · ${name}  expected=${expected}  actual=${actual}`); fail++; }
}

async function cleanup(matchId) {
  if (!matchId) return;
  await sql`DELETE FROM odds_markets WHERE match_id = ${matchId}`;
  await sql`DELETE FROM matches WHERE id = ${matchId}`;
}

let matchId = null;
try {
  console.log('=== Setup ===');
  // Reuse the friendlies league from earlier seed; if missing, any
  // existing league works since this is throwaway.
  const [league] = await sql`SELECT id FROM leagues WHERE slug = 'international-friendlies' LIMIT 1`;
  if (!league) throw new Error('No league row to attach temp match to. Run import-fixture.mjs first.');

  // Defensive: clean any leftover from a previous failed run.
  const [leftover] = await sql`SELECT id FROM matches WHERE slug = ${TEMP_SLUG} LIMIT 1`;
  if (leftover) {
    await cleanup(leftover.id);
    console.log(`  cleaned leftover match id=${leftover.id} from prior run`);
  }

  const inserted = await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, external_ids)
    VALUES (
      ${league.id}, ${TEMP_SLUG}, now() + interval '1 day', 'scheduled',
      ${'{"api_sports":"' + FIXTURE_ID + '"}'}::jsonb
    )
    RETURNING id
  `;
  matchId = inserted[0].id;
  console.log(`  temp match id=${matchId}, slug=${TEMP_SLUG}`);

  // -------------------------------------------------------------------------
  console.log('\n=== Test 1: first upsert (no prior) → baseline = current, movement = 0 ===');
  const r1 = await upsertMatchWinnerOdds(matchId, FIXTURE_ID, { stampBaseline: false });
  assert('returns priced:true', r1.priced === true, 'true', r1.priced);
  assert('wrote 3 rows',         r1.written === 3,   '3',    r1.written);

  const rows1 = await sql`
    SELECT selection_label, american_odds, implied_probability,
           previous_american_odds, previous_implied_prob,
           movement_24h_odds, movement_24h_prob
    FROM odds_markets
    WHERE match_id = ${matchId} AND is_current = true
    ORDER BY selection_label
  `;
  for (const r of rows1) {
    console.log(`    ${r.selection_label}: am=${r.american_odds} imp=${r.implied_probability} prev_am=${r.previous_american_odds} prev_imp=${r.previous_implied_prob} mv_am=${r.movement_24h_odds} mv_imp=${r.movement_24h_prob}`);
  }
  for (const r of rows1) {
    assert(`[${r.selection_label}] previous_american_odds = current`,  r.previous_american_odds === r.american_odds, r.american_odds, r.previous_american_odds);
    assert(`[${r.selection_label}] movement_24h_odds = 0`,              r.movement_24h_odds === 0, '0', r.movement_24h_odds);
    assert(`[${r.selection_label}] movement_24h_prob = 0`,              Number(r.movement_24h_prob) === 0, '0', r.movement_24h_prob);
  }

  // -------------------------------------------------------------------------
  console.log('\n=== Test 2: manually tweak baseline → simulate yesterday\'s odds ===');
  // Shift the baseline so previous_american is current+50 (longer yesterday → favored more now)
  // and previous_implied is current-2 (less implied yesterday). Realistic shape of a move.
  await sql`
    UPDATE odds_markets
    SET previous_american_odds = american_odds + 50,
        previous_implied_prob = (implied_probability - 2)::numeric(5,2),
        previous_snapshot_at = now() - interval '24 hours'
    WHERE match_id = ${matchId} AND is_current = true
  `;
  const baselines = {};
  const rows2 = await sql`
    SELECT selection_label, american_odds, implied_probability,
           previous_american_odds, previous_implied_prob
    FROM odds_markets WHERE match_id = ${matchId} AND is_current = true
    ORDER BY selection_label
  `;
  for (const r of rows2) {
    baselines[r.selection_label] = {
      baseline_am: r.previous_american_odds,
      baseline_imp: Number(r.previous_implied_prob),
    };
    console.log(`    ${r.selection_label}: current_am=${r.american_odds} baseline_am=${r.previous_american_odds}  current_imp=${r.implied_probability} baseline_imp=${r.previous_implied_prob}`);
  }

  console.log('\n=== Test 3: hourly refresh → baseline PRESERVED, movement = current − baseline ===');
  const r3 = await upsertMatchWinnerOdds(matchId, FIXTURE_ID, { stampBaseline: false });
  assert('hourly refresh returns priced:true', r3.priced === true, 'true', r3.priced);

  const rows3 = await sql`
    SELECT selection_label, american_odds, implied_probability,
           previous_american_odds, previous_implied_prob,
           movement_24h_odds, movement_24h_prob
    FROM odds_markets WHERE match_id = ${matchId} AND is_current = true
    ORDER BY selection_label
  `;
  for (const r of rows3) {
    console.log(`    ${r.selection_label}: current_am=${r.american_odds} prev_am=${r.previous_american_odds} mv_am=${r.movement_24h_odds} mv_imp=${r.movement_24h_prob}`);
  }
  for (const r of rows3) {
    const exp = baselines[r.selection_label];
    assert(`[${r.selection_label}] baseline american preserved (${exp.baseline_am})`,
      r.previous_american_odds === exp.baseline_am, exp.baseline_am, r.previous_american_odds);
    assert(`[${r.selection_label}] baseline implied preserved (${exp.baseline_imp.toFixed(2)})`,
      Math.abs(Number(r.previous_implied_prob) - exp.baseline_imp) < 0.01,
      exp.baseline_imp.toFixed(2), r.previous_implied_prob);
    const expectedMoveAm = r.american_odds - exp.baseline_am;
    assert(`[${r.selection_label}] movement_24h_odds = ${expectedMoveAm}`,
      r.movement_24h_odds === expectedMoveAm, expectedMoveAm, r.movement_24h_odds);
  }

  // -------------------------------------------------------------------------
  console.log('\n=== Test 4: daily baseline stamp (stampBaseline=true) → baseline = current, movement = 0 ===');
  const r4 = await upsertMatchWinnerOdds(matchId, FIXTURE_ID, { stampBaseline: true });
  assert('daily stamp returns priced:true',  r4.priced === true,         'true', r4.priced);
  assert('result indicates stamped_baseline', r4.stamped_baseline === true, 'true', r4.stamped_baseline);

  const rows4 = await sql`
    SELECT selection_label, american_odds, implied_probability,
           previous_american_odds, previous_implied_prob,
           movement_24h_odds, movement_24h_prob
    FROM odds_markets WHERE match_id = ${matchId} AND is_current = true
    ORDER BY selection_label
  `;
  for (const r of rows4) {
    console.log(`    ${r.selection_label}: current_am=${r.american_odds} prev_am=${r.previous_american_odds} mv_am=${r.movement_24h_odds} mv_imp=${r.movement_24h_prob}`);
  }
  for (const r of rows4) {
    assert(`[${r.selection_label}] baseline reset to current`, r.previous_american_odds === r.american_odds, r.american_odds, r.previous_american_odds);
    assert(`[${r.selection_label}] movement_24h_odds = 0`,     r.movement_24h_odds === 0, '0', r.movement_24h_odds);
    assert(`[${r.selection_label}] movement_24h_prob = 0`,     Number(r.movement_24h_prob) === 0, '0', r.movement_24h_prob);
  }

  // -------------------------------------------------------------------------
  console.log('\n=== Test 5: row count + history (should have 1 current + 3 historical per selection) ===');
  // After 3 upserts (T1 first, T3 hourly, T4 daily stamp), each selection has:
  //   1 is_current=true row + 2 historical is_current=false rows = 3 total
  // Note: T2 was a manual UPDATE in place, not an insert, so it doesn't add a row.
  const counts = await sql`
    SELECT selection_label, count(*) FILTER (WHERE is_current = true) AS current_rows,
                            count(*) FILTER (WHERE is_current = false) AS historical_rows
    FROM odds_markets WHERE match_id = ${matchId}
    GROUP BY selection_label
    ORDER BY selection_label
  `;
  for (const r of counts) {
    console.log(`    ${r.selection_label}: current=${r.current_rows} historical=${r.historical_rows}`);
    assert(`[${r.selection_label}] exactly 1 is_current=true row`, Number(r.current_rows) === 1, '1', r.current_rows);
    assert(`[${r.selection_label}] 2 historical rows from 3 upserts`, Number(r.historical_rows) === 2, '2', r.historical_rows);
  }

  // -------------------------------------------------------------------------
  console.log('\n=== Cleanup ===');
  const oddsDel = await sql`DELETE FROM odds_markets WHERE match_id = ${matchId} RETURNING id`;
  const matchDel = await sql`DELETE FROM matches WHERE id = ${matchId} RETURNING id`;
  console.log(`  deleted ${oddsDel.length} odds_markets rows + ${matchDel.length} matches row`);
  assert('odds_markets cleanup', oddsDel.length === 9, '9', oddsDel.length);
  assert('matches cleanup',      matchDel.length === 1, '1', matchDel.length);
  matchId = null;  // mark cleaned

} catch (err) {
  console.error('\nTEST HARNESS CRASHED:', err);
  await cleanup(matchId).catch(() => {});
  process.exit(2);
}

console.log(`\nresult: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
