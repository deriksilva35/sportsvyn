// scripts/test-odds.mjs — assertion tests + live fetch for lib/odds.js.
// Run with: node --env-file=.env.local scripts/test-odds.mjs
// Same posture as test-sync-failure.mjs: a real contract test, kept in
// scripts/ as a regression check.

import {
  decimalToImplied,
  decimalToAmerican,
  consensusOdds,
  devig,
  fetchMatchWinnerOdds,
  upsertMatchWinnerOdds,
} from '../lib/odds.js';
import { sql } from '../lib/db.js';

let pass = 0;
let fail = 0;
function assert(name, condition, expected = '', actual = '') {
  if (condition) {
    console.log(`  PASS · ${name}`);
    pass++;
  } else {
    console.log(`  FAIL · ${name}  expected=${expected}  actual=${actual}`);
    fail++;
  }
}
const within = (a, b, tol) => Math.abs(a - b) < tol;

// ============================================================================
console.log('\n=== 1. devig even market 2.00/2.00/2.00 → 33.33/33.33/33.33 ===');
const even = devig({ home: 2.0, draw: 2.0, away: 2.0 });
assert('home_pct ≈ 33.33', within(even.home_pct, 33.33, 0.1), '33.33', even.home_pct.toFixed(2));
assert('draw_pct ≈ 33.33', within(even.draw_pct, 33.33, 0.1), '33.33', even.draw_pct.toFixed(2));
assert('away_pct ≈ 33.33', within(even.away_pct, 33.33, 0.1), '33.33', even.away_pct.toFixed(2));
assert('sum = 100.00',     within(even.home_pct + even.draw_pct + even.away_pct, 100, 0.01),
       '100.00', (even.home_pct + even.draw_pct + even.away_pct).toFixed(4));
assert('overround = 50%',  within(even.overround_pct, 50, 0.1), '50.0', even.overround_pct.toFixed(2));

// ============================================================================
console.log('\n=== 2. devig heavy favorite 1.20/7.00/12.00 → favorite ~78-80% ===');
const fav = devig({ home: 1.2, draw: 7.0, away: 12.0 });
assert('favorite 78 < home_pct < 80', fav.home_pct > 78 && fav.home_pct < 80,
       '(78, 80)', fav.home_pct.toFixed(2));
assert('sum = 100.00', within(fav.home_pct + fav.draw_pct + fav.away_pct, 100, 0.01),
       '100.00', (fav.home_pct + fav.draw_pct + fav.away_pct).toFixed(4));
console.log(`    (favorite=${fav.home_pct.toFixed(2)}, draw=${fav.draw_pct.toFixed(2)}, away=${fav.away_pct.toFixed(2)}, overround=${fav.overround_pct.toFixed(2)}%)`);

// ============================================================================
console.log('\n=== 3. devig PSG-Arsenal median 2.26/3.30/3.20 → 41.82/28.64/29.54 ===');
const psg = devig({ home: 2.26, draw: 3.30, away: 3.20 });
assert('home_pct ≈ 41.82', within(psg.home_pct, 41.82, 0.1), '41.82', psg.home_pct.toFixed(2));
assert('draw_pct ≈ 28.64', within(psg.draw_pct, 28.64, 0.1), '28.64', psg.draw_pct.toFixed(2));
assert('away_pct ≈ 29.54', within(psg.away_pct, 29.54, 0.1), '29.54', psg.away_pct.toFixed(2));
assert('sum = 100.00',     within(psg.home_pct + psg.draw_pct + psg.away_pct, 100, 0.01),
       '100.00', (psg.home_pct + psg.draw_pct + psg.away_pct).toFixed(4));

// ============================================================================
console.log('\n=== 4. decimalToAmerican conversions ===');
const a226 = decimalToAmerican(2.26);
const a180 = decimalToAmerican(1.80);
const a200 = decimalToAmerican(2.00);
const a120 = decimalToAmerican(1.20);
const a350 = decimalToAmerican(3.50);
assert('2.26 → +126 (±1)', Math.abs(a226 - 126) <= 1, '126', a226);
assert('1.80 → -125 (±1)', Math.abs(a180 - (-125)) <= 1, '-125', a180);
assert('2.00 → +100',      a200 === 100, '100', a200);
assert('1.20 → -500 (±1)', Math.abs(a120 - (-500)) <= 1, '-500', a120);
assert('3.50 → +250',      a350 === 250, '250', a350);

// ============================================================================
console.log('\n=== 5. consensusOdds median picks the median, not the mean ===');
const psgBooks = [
  { home: 2.26, draw: 3.30, away: 3.10 }, // 10Bet
  { home: 2.25, draw: 3.20, away: 3.20 }, // William Hill
  { home: 2.25, draw: 3.30, away: 3.25 }, // Bet365
  { home: 2.34, draw: 3.34, away: 3.28 }, // Marathonbet
  { home: 2.38, draw: 3.25, away: 3.15 }, // Unibet
  { home: 2.25, draw: 3.50, away: 3.10 }, // Betfair
  { home: 2.25, draw: 3.40, away: 3.13 }, // BetVictor
  { home: 2.33, draw: 3.37, away: 3.26 }, // Pinnacle
  { home: 2.26, draw: 3.00, away: 2.82 }, // SBO (the outlier)
  { home: 2.38, draw: 3.39, away: 3.33 }, // 1xBet
  { home: 2.30, draw: 3.30, away: 3.20 }, // Betano
  { home: 2.25, draw: 3.20, away: 3.20 }, // 888Sport
  { home: 2.30, draw: 3.25, away: 3.15 }, // Dafabet
];
const cons = consensusOdds(psgBooks);
assert('home median = 2.26', within(cons.home, 2.26, 0.005), '2.26', cons.home);
assert('draw median = 3.30', within(cons.draw, 3.30, 0.005), '3.30', cons.draw);
assert('away median = 3.20', within(cons.away, 3.20, 0.005), '3.20', cons.away);
// And explicitly: mean differs (Phase 1 reported H mean=2.29, D=3.29, A=3.17)
const meanHome = psgBooks.reduce((a, b) => a + b.home, 0) / psgBooks.length;
assert('mean(home) ≠ median(home)', Math.abs(meanHome - cons.home) > 0.01,
       `not ${cons.home}`, meanHome.toFixed(3));

// ============================================================================
console.log('\n=== 6. live fetch: PSG-Arsenal fixture 1544371 ===');
const real = await fetchMatchWinnerOdds(1544371);
if (!real.priced) {
  console.log(`  >>> NOT PRICED. book_count=${real.book_count}`);
} else {
  console.log(`  book_count:   ${real.book_count}`);
  console.log(`  decimal:      H=${real.decimal.home.toFixed(2)}  D=${real.decimal.draw.toFixed(2)}  A=${real.decimal.away.toFixed(2)}`);
  console.log(`  american:     H=${real.american.home > 0 ? '+' : ''}${real.american.home}  D=${real.american.draw > 0 ? '+' : ''}${real.american.draw}  A=${real.american.away > 0 ? '+' : ''}${real.american.away}`);
  console.log(`  implied %:    H=${real.home_pct.toFixed(2)}  D=${real.draw_pct.toFixed(2)}  A=${real.away_pct.toFixed(2)}  (sum=${(real.home_pct+real.draw_pct+real.away_pct).toFixed(4)})`);
  console.log(`  overround:    ${real.overround_pct.toFixed(2)}%`);
  console.log(`  source_books: ${real.source_books.join(', ')}`);
  console.log(`  fetched_at:   ${real.fetched_at}`);

  // 7. Does the live fetch agree with the Phase 1 preview within 0.1?
  console.log('\n=== 7. live fetch agrees with Phase 1 preview (within 0.1 pct) ===');
  assert('home_pct ≈ 41.82', within(real.home_pct, 41.82, 0.1), '41.82', real.home_pct.toFixed(2));
  assert('draw_pct ≈ 28.64', within(real.draw_pct, 28.64, 0.1), '28.64', real.draw_pct.toFixed(2));
  assert('away_pct ≈ 29.54', within(real.away_pct, 29.54, 0.1), '29.54', real.away_pct.toFixed(2));
}

// ============================================================================
console.log('\n=== 8. upsert attempt: PSG-Arsenal in our matches table? ===');
const matchRow = await sql`
  SELECT id, slug FROM matches WHERE external_ids->>'api_sports' = '1544371' LIMIT 1
`;
if (!matchRow[0]) {
  console.log('  >>> No matches row for fixture 1544371 — SKIPPING upsert.');
  console.log('     (The fetch + math are exercised above; upsert is the only path we cannot exercise.)');
} else {
  console.log(`  found matches row id=${matchRow[0].id} slug=${matchRow[0].slug} — running upsert`);
  const up = await upsertMatchWinnerOdds(matchRow[0].id, 1544371);
  console.log('  upsert result:', up);
}

// ============================================================================
console.log('\n=== 9. canonical "not priced yet" path: USA-Senegal 1503008 ===');
const empty = await fetchMatchWinnerOdds(1503008);
assert('priced = false',  empty.priced === false, 'false', empty.priced);
assert('book_count = 0',  empty.book_count === 0, '0', empty.book_count);
console.log(`  (this confirms the render layer's "no odds yet" case is detectable)`);

// ============================================================================
console.log(`\nresult: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
