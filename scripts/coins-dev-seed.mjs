// scripts/coins-dev-seed.mjs - COINS IN HAND FOR A REVIEWER, ON DEV ONLY.
//
// A preview deploy reads DEV, where almost nobody has played this week, so The
// Drum shows no steppers to review. This mints N coins (source 'dev-seed') into
// the current week for ONE account. REFUSES PROD (lib/email/broadcastRules.js
// databaseFingerprint), and never touches arcade_points.
//
//   set -a && . ./.env.local && set +a
//   node scripts/coins-dev-seed.mjs --user <id> --coins 4
//   node scripts/coins-dev-seed.mjs --user <id> --undo      # removes this script's coins and that user's drops this week
import { sql } from '../lib/db.js';
import { databaseFingerprint } from '../lib/email/broadcastRules.js';
import { ensureWeek } from '../lib/coins/mint.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? null : process.argv[i + 1]; };
if (databaseFingerprint(process.env.DATABASE_URL) !== 'DEV') throw new Error('refusing: DEV only');
const userId = Number(arg('--user'));
if (!Number.isInteger(userId) || userId < 1) throw new Error('--user <id> required');
const week = await ensureWeek(sql, new Date());
if (process.argv.includes('--undo')) {
  const d = await sql`DELETE FROM drum_entries WHERE user_id = ${userId} AND week_id = ${week.id} RETURNING id`;
  const m = await sql`DELETE FROM coin_mint WHERE user_id = ${userId} AND week_id = ${week.id} AND source = 'dev-seed' RETURNING id`;
  console.log(`week ${week.id}: removed ${m.length} seed mint row(s), ${d.length} drop(s) for user ${userId}`);
  process.exit(0);
}
const n = Math.min(10, Math.max(1, Number(arg('--coins') ?? 4)));
const [{ me }] = await sql`SELECT COALESCE(sum(qty), 0)::int AS me FROM coin_mint WHERE user_id = ${userId}`;
await sql`INSERT INTO coin_mint (user_id, week_id, qty, seq, source) VALUES (${userId}, ${week.id}, ${n}, ${me + n}, 'dev-seed')`;
console.log(`week ${week.id}: +${n} coins for user ${userId} (DEV)`);
