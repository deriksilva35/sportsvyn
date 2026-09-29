// services/mlb-advance/index.mjs - the MLB postseason advance job (tue-2).
//
// Runs the postseason import against PROD, writes ONE journal line, and asks a
// human for help only when a series with two known clubs could not be given a
// round. Started by systemd (sportsvyn-mlb-advance@<trigger>.service): the
// 10:00Z timer (@timer) and the live poller's day-over kick (@event), or by hand
// (@manual). See CLAUDE.md, "MLB postseason".
//
// PROD ONLY, BY THE SAME PRELOAD EVERY DROPLET SERVICE USES
// (services/_preload/prod-db.mjs sets DATABASE_URL from PROD_DATABASE_URL before
// any import) - which is also what the import's own guard (fa80e73) requires.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock } from '../../lib/ops/runLock.js';
import { parseImportOutput, journalLine } from '../../lib/mlb/advance.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const trigger = flag('--trigger') ?? 'manual';
const season = Number(flag('--season') ?? new Date().getUTCFullYear());
const LOCK = path.join(process.env.XDG_RUNTIME_DIR || '/tmp', 'sportsvyn-mlb-advance.lock');

if (!process.env.PROD_DATABASE_URL || process.env.DATABASE_URL !== process.env.PROD_DATABASE_URL) {
  console.log(`[mlb-advance] ${trigger} REFUSED: DATABASE_URL is not PROD - run through services/_preload/prod-db.mjs`);
  process.exit(1);
}

const lock = acquireLock(LOCK);
if (!lock.ok) { console.log(`[mlb-advance] ${trigger} SKIPPED: another run holds the lock (pid ${lock.holder})`); process.exit(0); }

let exitCode = 0;
try {
  const r = spawnSync(process.execPath, ['scripts/mlb-postseason-import.mjs', '--prod', '--apply', String(season)], {
    cwd: REPO, env: process.env, encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024,
  });
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const s = parseImportOutput(text);
  console.log(journalLine(s, { trigger }));
  if (r.status !== 0 || !s.applied) {
    exitCode = 1;
    await alert(`[mlb-advance] import did not apply (exit ${r.status ?? r.signal})`, text.split('\n').slice(-30).join('\n'));
  } else if (s.unplaced.length) {
    // THE FAILURE THAT NEEDS A HUMAN: two known clubs, no round. Everything else
    // - placeholders for undecided series, a round that is not whole yet - is
    // the bracket filling in and settles on a later run by itself.
    await alert(`Postseason import: ${s.unplaced.join(', ')} unplaced`, text.split('\n').slice(-40).join('\n'), s.unplaced);
  }
} finally {
  lock.release();
}
process.exit(exitCode);

async function alert(subject, body, unplaced = null) {
  // BOTH CHANNELS, EACH CONTAINED: the email is the existing operator alert
  // (lib/pollers/alerts.js, rate-limited per source); the push reaches the
  // admin account's device (lib/admin/gate.js ADMIN_USER_IDS), once per event id.
  try {
    const { sql } = await import('../../lib/db.js');
    const { maybeAlert } = await import('../../lib/pollers/alerts.js');
    await maybeAlert(sql, { source: 'mlb-advance', subject, body });
  } catch (e) { console.log(`[mlb-advance] email alert failed: ${String(e?.message ?? e).slice(0, 120)}`); }
  if (!unplaced) return;
  try {
    const { notifyPersonalized } = await import('../../lib/push/notify.js');
    const { ADMIN_USER_IDS } = await import('../../lib/admin/gate.js');
    const series = unplaced.join(', ');
    const res = await notifyPersonalized(`ops-postseason-unplaced:${season}:${unplaced.join('+')}`,
      ADMIN_USER_IDS.map((userId) => ({ userId, params: { series } })));
    console.log(`[mlb-advance] push: ${JSON.stringify(res)}`);
  } catch (e) { console.log(`[mlb-advance] push failed: ${String(e?.message ?? e).slice(0, 120)}`); }
}
