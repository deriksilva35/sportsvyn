// scripts/mlb-resync.mjs - the MLB schedule re-sync (lib/mlb/resync.js) by hand,
// over a named window. DRY RUN BY DEFAULT. The cron (/api/cron/mlb-schedule)
// runs the same function on its own window; this is for a repair, or a rainout
// that cannot wait for the next tick.
//
//   set -a && . ./.env.local && set +a
//   node scripts/mlb-resync.mjs --prod 2026-09-22 2026-09-27            # plan
//   node scripts/mlb-resync.mjs --prod --apply 2026-09-22 2026-09-27    # write
//
// Prints every row it changes: slug old -> new, kickoff old -> new, status.

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { resyncMlbSchedule } from '../lib/mlb/resync.js';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const [from, to] = args.filter((a) => !a.startsWith('--'));
if (!from || !to) { console.error('REFUSE: name a window, e.g. 2026-09-22 2026-09-27'); process.exit(1); }

const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) { console.error('REFUSE: database url missing in env'); process.exit(1); }
const sql = neon(url);
console.log(`TARGET ${new URL(url).host} | FP ${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)} | ${APPLY ? 'APPLY' : 'DRY RUN'} | ${from} .. ${to}`);

const r = await resyncMlbSchedule(sql, { from, to, dryRun: !APPLY, log: console.log });
if (r.reason) { console.error(`REFUSE: ${r.reason}`); process.exit(1); }
const t = (x) => (x ? String(x).slice(0, 16).replace('T', ' ') : '-');
console.log(`\nfetched ${r.fetched} | BDL calls ${r.calls} | inserted ${r.inserted} | updated ${r.updated} | refused ${r.refused.length} | series-staged ${r.stagedFromSeries}`);
console.log(`\nCHANGED ROWS (${r.changes.length})`);
for (const c of r.changes) {
  console.log(`  ${c.action.padEnd(6)} id=${c.id ?? 'new'} bdl=${c.bdl}${c.liveOnFeed ? ' (live on BDL: state left to the poller)' : ''}`);
  console.log(`         slug    ${c.slugFrom ?? '-'} -> ${c.slugTo}`);
  console.log(`         kickoff ${t(c.kickoffFrom)} -> ${t(c.kickoffTo)}Z`);
  console.log(`         status  ${c.statusFrom ?? '-'} -> ${c.statusTo}`);
}
for (const c of r.cancelled) console.log(`  CANCEL id=${c.id} bdl=${c.bdl} ${c.slug} (${c.statusFrom} -> cancelled; BDL 404)`);
for (const u of r.unlisted) console.log(`  unlisted id=${u.id} bdl=${u.bdl} ${u.moved ? `moved to ${u.moved}` : `404, kept ${u.kept}`}`);
if (r.refused.length) console.log(`\nREFUSED: ${JSON.stringify(r.refused)}`);
console.log(APPLY ? '\nAPPLIED.' : '\nDRY RUN ONLY.');
