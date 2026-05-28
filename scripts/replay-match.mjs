// scripts/replay-match.mjs — compact post-match timeline from sync_log.
// Run with: node --env-file=.env.local scripts/replay-match.mjs [fixtureId]
// Default fixture id: 1503008 (USA vs Senegal friendly).
//
// Collapses consecutive identical-state polls (same status + same score)
// into a "held N polls" line so the timeline highlights the moments
// something changed. Errors are always emitted on their own line.

import { sql } from '../lib/db.js';

const idArg = process.argv[2];
const fixtureId = idArg ? Number(idArg) : 1503008;

if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
  console.error(`Invalid fixture id: ${idArg}`);
  process.exit(1);
}

const rows = await sql`
  SELECT polled_at, status, minute, home_score, away_score, error, raw
  FROM sync_log
  WHERE fixture_id = ${fixtureId}
  ORDER BY polled_at
`;

if (rows.length === 0) {
  console.log(`no polls logged yet for ${fixtureId}`);
  process.exit(0);
}

function fmtRow(row) {
  const t = new Date(row.polled_at).toISOString().slice(11, 19);
  const status = (row.status ?? '—').padEnd(10);
  const minute = row.minute != null ? `${row.minute}'` : '—';
  const score = `${row.home_score ?? '–'}-${row.away_score ?? '–'}`;
  const events =
    row.raw && typeof row.raw === 'object' && row.raw.events_count != null
      ? ` ev=${row.raw.events_count}`
      : '';
  const err = row.error ? ` | ERROR: ${row.error}` : '';
  return `${t}  ${status} ${minute.padEnd(6)} ${score.padStart(7)}${events}${err}`;
}

function sameState(a, b) {
  if (!a || !b) return false;
  if (a.error || b.error) return false;
  return (
    a.status === b.status &&
    a.home_score === b.home_score &&
    a.away_score === b.away_score
  );
}

console.log(`=== Replay for fixture ${fixtureId} ===`);
console.log(`polls=${rows.length}  range=${new Date(rows[0].polled_at).toISOString()} → ${new Date(rows[rows.length - 1].polled_at).toISOString()}`);
console.log('');
console.log('  TIME      STATUS     MIN    SCORE');

let prev = null;
let heldCount = 0;

function flushHeld() {
  if (heldCount > 0) {
    console.log(`   ↳ held ${heldCount} poll${heldCount === 1 ? '' : 's'}`);
    heldCount = 0;
  }
}

for (const row of rows) {
  if (sameState(prev, row)) {
    heldCount++;
  } else {
    flushHeld();
    console.log(fmtRow(row));
    prev = row;
  }
}
flushHeld();
