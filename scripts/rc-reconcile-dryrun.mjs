// scripts/rc-reconcile-dryrun.mjs — ask RevenueCat what given users own and
// report exactly what reconcileFromRevenueCat() WOULD change. Writes nothing.
//
//   node scripts/rc-reconcile-dryrun.mjs 3 5              (dry run, default)
//   APPLY=1 node scripts/rc-reconcile-dryrun.mjs 3 5      (actually writes)
//
// Requires REVENUECAT_SECRET_KEY (v1 secret key, Vercel Production) and
// PROD_DATABASE_URL. Reads .env.local first, then the real environment, so the
// key can be supplied inline without being written to disk:
//
//   REVENUECAT_SECRET_KEY=sk_xxx node scripts/rc-reconcile-dryrun.mjs 3 5
//
// The DB it reports against is PROD_DATABASE_URL, because that is where the
// device's account lives. It sets DATABASE_URL from it for the duration of the
// process so lib/membership.js reads the same database it would in production.

import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const s = line.trim(); if (!s || s.startsWith('#')) continue;
  const eq = s.indexOf('='); if (eq < 0) continue;
  const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;   // real env wins
}

const APPLY = process.env.APPLY === '1';
const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
if (!ids.length) { console.error('usage: node scripts/rc-reconcile-dryrun.mjs <userId> [userId...]'); process.exit(1); }

if (!process.env.PROD_DATABASE_URL) { console.error('PROD_DATABASE_URL not set'); process.exit(1); }
// Point the app's db client at PROD for this process.
process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;

if (!process.env.REVENUECAT_SECRET_KEY) {
  console.error('\nREVENUECAT_SECRET_KEY is not set in this environment.');
  console.error('It is Production-only in Vercel, so it is not in .env.local. Supply it inline:');
  console.error('  REVENUECAT_SECRET_KEY=sk_xxx node scripts/rc-reconcile-dryrun.mjs ' + ids.join(' '));
  console.error('\nRefusing to continue: a reconcile without the key would look like "owns nothing".');
  process.exit(2);
}

const { reconcileFromRevenueCat } = await import('../lib/revenuecat.js');
const { sql } = await import('../lib/db.js');

console.log(`MODE: ${APPLY ? '*** APPLY (WILL WRITE) ***' : 'DRY RUN (no writes)'}`);
console.log(`DB:   ${(await sql`SELECT current_database() d`)[0].d} via PROD_DATABASE_URL\n`);

for (const userId of ids) {
  const who = (await sql`SELECT id, email FROM users WHERE id = ${userId}`)[0];
  console.log('='.repeat(74));
  console.log(`USER ${userId}  ${who ? who.email : '(no such user)'}`);
  console.log('='.repeat(74));

  const r = await reconcileFromRevenueCat(userId, { dryRun: !APPLY });

  if (!r.ok) {
    console.log(`  RESULT: ERROR - ${r.error}`);
    console.log('  WROTE:  nothing (a failed lookup is never read as "not entitled")\n');
    continue;
  }

  console.log(`  RevenueCat HTTP ${r.rcStatus}`);
  console.log(`  entitled: ${r.rc.entitled}`);
  console.log(`  expiresAt: ${r.rc.expiresAt ?? 'n/a'}`);
  console.log(`  evidence: ${r.rc.evidence}`);
  console.log(`  matched entitlement: ${r.rc.matched ?? 'none'}`);
  console.log('  CURRENT ROW:');
  console.log(r.before
    ? `    kind=${r.before.kind} tier=${r.before.tier} status=${r.before.status} source=${r.before.source} expires_at=${r.before.expires_at}\n` +
      `    stripe_customer_id=${r.before.stripe_customer_id} stripe_subscription_id=${r.before.stripe_subscription_id}`
    : '    (no membership row)');
  console.log(`  PLAN: ${r.plan.action.toUpperCase()} - ${r.plan.reason}`);
  if (r.plan.action !== 'none') console.log(`  WOULD SET expires_at = ${r.plan.expiresAt ?? 'now() (revoke)'}`);
  console.log(`  WROTE: ${r.wrote ? `yes (user ${r.applied})` : 'nothing'}`);

  if (APPLY) {
    const after = (await sql`SELECT kind,tier,status,source,expires_at,stripe_customer_id,stripe_subscription_id FROM memberships WHERE user_id=${userId}`)[0];
    console.log('  ROW AFTER:');
    console.log(after
      ? `    kind=${after.kind} tier=${after.tier} status=${after.status} source=${after.source} expires_at=${after.expires_at}\n` +
        `    stripe_customer_id=${after.stripe_customer_id} stripe_subscription_id=${after.stripe_subscription_id}`
      : '    (no membership row)');
  }
  console.log();
}

console.log('--- entitlement as the app would compute it now ---');
const { entitlementsFromRow } = await import('../lib/membership.js');
for (const u of await sql`SELECT id, email FROM users ORDER BY id`) {
  const row = (await sql`SELECT * FROM memberships WHERE user_id = ${u.id}`)[0] ?? null;
  console.log(`  user ${u.id} (${u.email}): ${JSON.stringify(entitlementsFromRow(row))} row=${row ? row.kind + '/' + row.source : 'NONE'}`);
}
