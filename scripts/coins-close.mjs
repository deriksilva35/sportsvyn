// scripts/coins-close.mjs - THE DRAWING BY HAND (Rules v0.1 s7: a drawing that
// could not run at the Close runs when the fault is fixed, with the coins as
// they stood at the Close).
//
// DRY RUN IS THE DEFAULT: prints the week, the seed and the would-be winners,
// writes nothing, mails nobody. --apply draws for real (push + email included).
//
//   set -a && . ./.env.local && set +a
//   node scripts/coins-close.mjs                                   # DEV, dry run
//   DATABASE_URL="$PROD_DATABASE_URL" node scripts/coins-close.mjs # PROD, dry run
//   ... --apply
import { sql } from '../lib/db.js';
import { runClose } from '../lib/coins/close.js';
import { makeResultsSender } from '../lib/coins/resultsEmail.js';
import { notifyPersonalized } from '../lib/push/notify.js';

const apply = process.argv.includes('--apply');
console.log(`TARGET ${new URL(process.env.DATABASE_URL).host} · ${apply ? 'APPLY' : 'DRY RUN (nothing written)'}`);
const r = await runClose({ db: sql, dryRun: !apply, ...(apply ? { send: makeResultsSender(), notify: notifyPersonalized } : {}) });
console.log(JSON.stringify(r, null, 2));
