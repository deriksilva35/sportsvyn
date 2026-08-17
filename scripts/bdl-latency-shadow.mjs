#!/usr/bin/env node
// scripts/bdl-latency-shadow.mjs - the only measurement of BDL's LIVE latency
// we can take before Week 1.
//
// WHY IT MATTERS. Every settlement in the product depends on BDL delivering
// NFL stat lines in season, and BDL HAS NEVER DONE IT. The whole 2015-2025
// corpus arrived in a single backfill on 2026-07-20; the Tuesday sweep has run
// three times and returned apiStatRows: 0 every time, because there were no
// regular-season games. The first real evidence would otherwise be Sep 15,
// with four ranked games already depending on it.
//
// A preseason slate is not a perfect proxy - BDL may cover preseason
// differently from the regular season, and if it returns nothing that is
// ambiguous rather than damning. But it is the only live NFL data between now
// and Week 1, and an ambiguous reading beats no reading.
//
// SHADOW ONLY. No contest, no settle, no writes of any kind. It watches finals
// land and reports, per game, how long after the final whistle each source had
// numbers:
//   nfl_player_game_stats  BDL      - what settlement actually reads
//   gridiron_player_lines  API-Sports - the proven path, as the control
//
// Run:
//   set -a && . ./.env.local && set +a
//   DATABASE_URL="$PROD_DATABASE_URL" node scripts/bdl-latency-shadow.mjs --hours 14

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] ?? true]);
  return a;
}, []));

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = neon(url);
const hours = Number(args.hours ?? 14);
const everyMin = Number(args.every ?? 20);

console.log(`db fingerprint: ${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)}`);
console.log(`SHADOW ONLY - no writes. watching ${hours}h, sampling every ${everyMin}m`);

const seen = new Map();   // matchId -> { bdlAt, apiAt }

async function sample() {
  const rows = await sql`
    SELECT m.id,
           at.abbreviation || '@' || ht.abbreviation AS label,
           m.status, m.kickoff_at,
           m.metadata->'detail'->>'final_seen_at' AS final_seen_at,
           (SELECT count(*)::int FROM nfl_player_game_stats s WHERE s.match_id = m.id) AS bdl,
           (SELECT count(*)::int FROM gridiron_player_lines p WHERE p.match_id = m.id) AS api
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
     WHERE l.slug = 'nfl'
       AND m.kickoff_at > now() - interval '20 hours'
       AND m.kickoff_at < now() + interval '6 hours'
     ORDER BY m.kickoff_at`;

  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`\n--- ${stamp}Z ---`);
  for (const g of rows) {
    const prev = seen.get(g.id) ?? {};
    const now = Date.now();
    const ref = g.final_seen_at ? Date.parse(g.final_seen_at) : null;

    if (g.bdl > 0 && !prev.bdlAt) prev.bdlAt = now;
    if (g.api > 0 && !prev.apiAt) prev.apiAt = now;
    seen.set(g.id, prev);

    const mins = (t) => (t && ref ? `+${Math.round((t - ref) / 60000)}m after final` : '-');
    console.log(
      `  ${String(g.label).padEnd(10)}${g.status.padEnd(10)}`
      + `BDL ${String(g.bdl).padStart(4)} ${mins(prev.bdlAt).padEnd(20)}`
      + `API-S ${String(g.api).padStart(4)} ${mins(prev.apiAt)}`,
    );
  }
}

const until = Date.now() + hours * 3_600_000;
await sample();
while (Date.now() < until) {
  await new Promise((r) => setTimeout(r, everyMin * 60_000));
  await sample();
}

console.log('\n=== VERDICT ===');
let bdlAny = false;
for (const [id, v] of seen) {
  if (v.bdlAt) bdlAny = true;
  console.log(`  match ${id}: BDL ${v.bdlAt ? 'DELIVERED' : 'never'} · API-Sports ${v.apiAt ? 'delivered' : 'never'}`);
}
console.log(bdlAny
  ? '\nBDL delivered in season. Settlement can read it; note the lag above.'
  : '\nBDL delivered NOTHING for this slate. AMBIGUOUS - it may not cover preseason'
    + '\nat all. It is NOT proof it will fail in Week 1, and it IS a reason to have'
    + '\nthe gridiron_player_lines fallback ready before Sep 15.');
