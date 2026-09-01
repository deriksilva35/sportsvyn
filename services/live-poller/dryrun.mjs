// services/live-poller/dryrun.mjs — READ-ONLY. Prints the cadence decision and
// what a poll WOULD write, and makes no UPDATE, no INSERT and no emit.
// Usage: set -a && . ./.env.local && set +a && node services/live-poller/dryrun.mjs
import { neon } from '@neondatabase/serverless';
import { cadence, sleepUntilNext } from '../../lib/live/cadence.js';
import { callsToday, applyCap, DEFAULT_CAP } from '../../lib/live/quota.js';
import { pollOnce, cfbdScoreboard, bdlDay, fromCfbd, fromBdl } from './poll.mjs';

const sql = neon(process.env.PROD_DATABASE_URL);
const now = new Date();
console.log('DRY RUN (read-only) at', now.toISOString(), '\n');

for (const lg of [
  { slug: 'cfb', providerKey: 'cfbd_game_id', normalise: fromCfbd, fetcher: () => cfbdScoreboard()() },
  { slug: 'nfl', providerKey: 'bdl_game_id', normalise: fromBdl,
    fetcher: () => bdlDay(now.toISOString().slice(0, 10))() },
]) {
  const slate = await sql`
    SELECT m.status, m.kickoff_at AS "kickoffAt",
           (m.metadata->'detail'->>'final_seen_at') AS "finalSeenAt"
      FROM matches m JOIN leagues l ON l.id = m.league_id AND l.slug = ${lg.slug}
     WHERE m.kickoff_at BETWEEN ${now.toISOString()}::timestamptz - interval '8 hours'
                            AND ${now.toISOString()}::timestamptz + interval '18 hours'`;
  let d = cadence(slate, now);
  const spent = await callsToday(sql, lg.slug, now).catch(() => 0);
  d = applyCap(d, spent, lg.slug);
  console.log(`== ${lg.slug.toUpperCase()} ==`);
  console.log(`   slate in window: ${slate.length}   live: ${d.liveCount}`);
  console.log(`   state: ${d.state}   sleep: ${sleepUntilNext(d, now)}s   next kickoff: ${d.nextKickoffAt ?? '-'}`);
  console.log(`   calls today: ${spent} / ${DEFAULT_CAP[lg.slug]}${d.capped ? '  CAPPED' : ''}`);
  try {
    const r = await pollOnce(sql, { ...lg, fetcher: lg.fetcher, now, dryRun: true });
    console.log(`   considered ${r.considered}, matched ${r.matched}, unmatched ${r.unmatched}, calls ${r.calls}`);
    if (r.unmapped.length) console.log('   UNMAPPED:', r.unmapped.join(', '));
    if (!r.wouldWrite.length) console.log('   would write: nothing');
    for (const w of r.wouldWrite.slice(0, 8)) {
      console.log(`   would write: ${w.slug}  ${w.from} -> ${w.to}  ${w.score}  ${w.liveState ? `Q${w.liveState.period} ${w.liveState.clock}` : 'no chip'}`);
    }
    if (r.wouldWrite.length > 8) console.log(`   ...and ${r.wouldWrite.length - 8} more`);
  } catch (e) { console.log('   poll failed:', e.message); }
  console.log('');
}
