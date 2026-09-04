// services/daily-tick/index.mjs — the systemd timer's own entrypoint.
// One-shot: ensures today's v2 edition exists and fires whichever of
// daily-live/daily-revealed is due, then exits. The TIMER owns the 5-minute
// cadence (services/daily-tick/systemd/) - this file runs exactly once.
//
// DATABASE_URL IS SET FROM PROD_DATABASE_URL BEFORE ANY STATIC IMPORT TOUCHES
// lib/db.js. ES imports are hoisted - a script that sets an env var AFTER a
// top-level `import { sql } from '../../lib/db.js'` (or anything that
// transitively imports it, like lib/push/notify.js) is too late: db.js's own
// top-level `neon(process.env.DATABASE_URL)` already ran against whatever
// DATABASE_URL held at process start. This exact trap already bit
// scripts/nfl-historical-backfill.mjs once ("--prod wrote to dev"); every
// import below is dynamic, after the assignment, on purpose.

if (!process.env.PROD_DATABASE_URL) {
  console.error('[daily-tick] PROD_DATABASE_URL missing in environment');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;

const { neon } = await import('@neondatabase/serverless');
const { tick } = await import('../../lib/daily/seasonBoardTick.js');

const sql = neon(process.env.DATABASE_URL);
const now = new Date().toISOString();

try {
  const r = await tick(sql, now);
  console.log(
    `[daily-tick] ${now} ensured=${r.ensured?.edition_date ?? 'n/a'} `
    + `live=${r.live.map((x) => x.edition).join(',') || 'none'} `
    + `revealed=${r.revealed.map((x) => x.edition).join(',') || 'none'}`,
  );
} catch (e) {
  console.error(`[daily-tick] ERROR: ${e.message}`);
  process.exit(1);
}
