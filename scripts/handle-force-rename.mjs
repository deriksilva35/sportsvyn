#!/usr/bin/env node
// scripts/handle-force-rename.mjs - the human half of report-and-rename.
//
// THE DENYLIST CATCHES THE LAZY CASES AND NOTHING ELSE. Anything with a
// deliberate misspelling, an in-joke, or a slur the list has never heard of
// walks straight through it. This is the path for when a person looks at a
// handle and decides it goes - and it needs to exist BEFORE the first stranger
// claims a name, not after.
//
// WHAT IT DOES, and each part matters:
//   - clears users.handle, so the account falls back to Player <hex>
//   - stamps handle_history.released_at with a REASON, so a forced rename is
//     distinguishable from a voluntary one when somebody appeals
//   - the released_at stamp is also the cooldown: the freed name is blocked
//     from re-claim for 30 days, which is what stops the same person taking it
//     straight back
//   - does NOT set handle_changed_at, so the user can immediately pick a new
//     one. Punishing them with a 30-day silence after we took their name would
//     be a second penalty nobody chose.
//
// REACHES PROD, SO IT READS ITS CREDENTIAL FROM THE ENVIRONMENT. No inline
// connection string, no URL in a default argument.
//   set -a && . ./.env.local && set +a
//   DATABASE_URL="$PROD_DATABASE_URL" node scripts/handle-force-rename.mjs --handle bad_name --reason "reported"
//   ...add --commit to actually write. Without it, this is a dry run.

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]);
    return acc;
  }, []),
);

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
const target = typeof args.handle === 'string' ? args.handle.trim() : null;
const reason = typeof args.reason === 'string' ? args.reason : 'moderation';
const commit = args.commit === true || args.commit === 'true';
if (!target) {
  console.error('usage: --handle <name> [--reason "..."] [--commit]');
  process.exit(1);
}

const sql = neon(url);
// Fingerprint, never the credential itself - the same discipline every script
// that can touch PROD uses.
console.log(`target db fingerprint: ${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)}`);
console.log(`mode: ${commit ? 'COMMIT' : 'DRY RUN (add --commit to write)'}`);

const lower = target.toLowerCase();
const rows = await sql`SELECT id, email, handle, handle_changed_at FROM users WHERE lower(handle) = ${lower}`;
if (!rows.length) {
  console.log(`no account currently holds "${target}"`);
  process.exit(0);
}
const u = rows[0];
const anonHex = crypto.createHmac('sha256', String(process.env.PUZZLE_SEED ?? 'sportsvyn-anon'))
  .update(`anon:${u.id}`).digest('hex').slice(0, 4);

console.log(`  user id       ${u.id}`);
console.log(`  handle        ${u.handle}`);
console.log(`  will become   Player ${anonHex}`);
console.log(`  reason        ${reason}`);
console.log(`  reclaim block 30 days from now`);

if (!commit) { console.log('\ndry run - nothing written'); process.exit(0); }

await sql`UPDATE users SET handle = NULL WHERE id = ${u.id}`;
const closed = await sql`
  UPDATE handle_history SET released_at = now(), reason = ${`forced: ${reason}`}
   WHERE user_id = ${u.id} AND lower(handle) = ${lower} AND released_at IS NULL
   RETURNING id`;
// A handle claimed before this table existed, or one whose row was already
// closed, still needs a released_at to start the cooldown - otherwise the
// freed name is immediately re-claimable and the rename accomplishes nothing.
if (!closed.length) {
  await sql`
    INSERT INTO handle_history (user_id, handle, claimed_at, released_at, reason)
    VALUES (${u.id}, ${u.handle}, now(), now(), ${`forced: ${reason}`})`;
  console.log('  (no open history row - wrote a closed one so the cooldown applies)');
}
console.log(`\nDONE. user ${u.id} now renders as Player ${anonHex}; "${target}" is blocked for 30 days.`);
