// scripts/nba-replay.mjs - replay recorded NBA games through the real live
// poller on DEV and print what it did (lib/nba/replayRun.js). DEV ONLY.
//
//   set -a && . ./.env.local && set +a
//   node scripts/nba-replay.mjs                 # the three recorded games, 30 s steps
//   node scripts/nba-replay.mjs 18447720 --step 60
//
// Re-record or add games with scripts/nba-replay-record.mjs.

import { neon } from '@neondatabase/serverless';
import { runNbaReplay } from '../lib/nba/replayRun.js';
import { REPLAY_GAMES } from '../lib/nba/replay.js';

const args = process.argv.slice(2);
const ids = args.filter((a) => /^\d{6,}$/.test(a));
const stepIdx = args.indexOf('--step');
const stepSec = stepIdx >= 0 ? Number(args[stepIdx + 1]) : 30;
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
if (process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) { console.error('REFUSE: DATABASE_URL is PROD'); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);
const t0 = Date.now();
const out = await runNbaReplay(sql, ids.length ? ids : Object.values(REPLAY_GAMES), { stepSec });
for (const r of out) {
  const ev = r.events.reduce((a, e) => { a[e.event] = (a[e.event] ?? 0) + 1; return a; }, {});
  console.log(`\n${r.id} ${r.label}`);
  console.log(`  polls ${r.polls} (live ${r.livePolls}) | provider calls ${r.calls} | unmapped ${JSON.stringify(r.unmapped)}`);
  console.log(`  statuses ${r.statuses.join(' -> ')}`);
  console.log(`  chips    ${r.shorts.join(' ')}`);
  console.log(`  tenths   ${r.tenths.length} live states held a tenths clock: ${r.tenths.slice(0, 6).join(' ')}`);
  console.log(`  tip      placeholder corrected at ${r.kickoffMoved} -> kickoff_at ${r.kickoffAt} (feed ${r.scheduledTip})`);
  console.log(`  events   ${JSON.stringify(ev)}`);
  for (const e of r.events) console.log(`     ${e.at.slice(11, 19)} ${e.event.padEnd(8)} p${e.period} ${e.clock ?? ''} ${e.away}-${e.home}`);
  console.log(`  final    ${r.final.status} ${r.final.away}-${r.final.home} (recorded ${r.recordedFinal.away}-${r.recordedFinal.home}) | final_seen_at ${r.final.finalSeenAt} | line ${JSON.stringify(r.final.lineScore)}`);
  console.log(`  last     ${JSON.stringify(r.final.lastPlay)}`);
  console.log(`  box      rows ${r.stats.rows}/${r.stats.recordedRows} dnp ${r.stats.dnp} | pts away ${r.stats.awayPts} home ${r.stats.homePts}`);
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
