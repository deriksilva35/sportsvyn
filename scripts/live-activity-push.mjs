// scripts/live-activity-push.mjs - push one Live Activity update by hand.
//
// WHY THIS IS COMMITTED AND NOT A SCRATCH FILE. The poller is not wired to
// Live Activities yet (deliberately: relay 2B ends at "a token can be stored,
// and a hand-run script can push an update to it"), so this is the ONLY way
// to prove a real Activity on a real phone takes a real update. It will be
// run again on every future slate that touches the widget, and again the
// first time a content-state field changes.
//
// CREDENTIALS FROM THE ENVIRONMENT, ALWAYS:
//   set -a && . ./.env.local && set +a
//   node scripts/live-activity-push.mjs --match 21569
// No connection string on a command line, no key in an argument. The APNs
// facts come from the same five vars lib/push/apns.js reads
// (APNS_KEY or APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_ENV,
// PUSH_ENABLED), and the database from DATABASE_URL (dev) or, with --prod,
// PROD_DATABASE_URL.
//
// FLAGS
//   --match <id>    which match's live Activities to push (required)
//   --event update  'update' (default) or 'end'
//   --prod          read PROD_DATABASE_URL instead of DATABASE_URL
//   --dry           print the exact headers and body, send nothing
//   --score a-h     override the scoreline, e.g. --score 14-21 (away-home)
//   --period Q3 --clock 7:28   override the clock fields
//
// THE SCORE THE MATCH ROW HOLDS IS THE DEFAULT, because the point of the
// script is to prove the same six fields the poller will send, not to invent
// a scoreboard. The overrides exist for a scheduled game, where the row is
// 0-0 with no period and a frozen card proves nothing.

import { neon } from '@neondatabase/serverless';
import { contentState, updatePayload, endPayload, liveActivityConfig, liveActivityTopic } from '../lib/push/liveActivity.js';
import { gateReport } from '../lib/push/apns.js';
import { liveActivitiesFor, pushLiveActivities } from '../lib/push/liveActivityStore.js';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const prod = flag('prod');
const url = prod ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  console.error(`no ${prod ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} in the environment - source .env.local first`);
  process.exit(1);
}
const sql = neon(url);

const matchId = Number(arg('match'));
if (!Number.isInteger(matchId) || matchId <= 0) {
  console.error('usage: node scripts/live-activity-push.mjs --match <id> [--event update|end] [--prod] [--dry]');
  process.exit(1);
}
const event = arg('event', 'update') === 'end' ? 'end' : 'update';

const [match] = await sql`
  SELECT m.id, m.slug, m.status, m.home_score, m.away_score, m.live_state,
         h.abbreviation AS home_abbr, a.abbreviation AS away_abbr
    FROM matches m
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
   WHERE m.id = ${matchId}`;
if (!match) { console.error(`no match ${matchId} on ${prod ? 'PROD' : 'DEV'}`); process.exit(1); }

const scoreArg = arg('score');
const [awayOverride, homeOverride] = scoreArg ? scoreArg.split('-').map((s) => Number(s.trim())) : [null, null];

const state = contentState({
  awayAbbr: match.away_abbr,
  awayScore: awayOverride ?? match.away_score ?? 0,
  homeAbbr: match.home_abbr,
  homeScore: homeOverride ?? match.home_score ?? 0,
  period: arg('period', match.live_state?.period ?? ''),
  clock: arg('clock', match.live_state?.clock ?? ''),
});

const cfg = liveActivityConfig();
const payload = event === 'end' ? endPayload(state) : updatePayload(state);
const rows = await liveActivitiesFor(sql, matchId);

console.log(`${prod ? 'PROD' : 'DEV'}  match ${match.id}  ${match.slug}  status=${match.status}`);
console.log(`live Activities: ${rows.length}`);
for (const r of rows) console.log(`  ${r.activity_id}  token ${r.push_token.slice(0, 12)}...  user ${r.user_id ?? '-'}`);
console.log('');
console.log(`apns-push-type: liveactivity`);
console.log(`apns-topic: ${liveActivityTopic(cfg)}`);
console.log(`host: ${cfg.host}`);
console.log(JSON.stringify(payload, null, 2));
console.log('');

if (!cfg.enabled) {
  console.log('SENDER DARK - nothing sent. The gate, itemized:');
  console.log(JSON.stringify(gateReport(), null, 2));
  process.exit(0);
}
if (flag('dry')) { console.log('--dry: nothing sent.'); process.exit(0); }

const out = await pushLiveActivities(sql, { matchId, state, event, log: (m) => console.log(`  ${m}`) });
console.log(`sent ${out.sent} · failed ${out.failed} · revoked ${out.revoked} · skipped ${out.skipped} of ${out.activities}`);
