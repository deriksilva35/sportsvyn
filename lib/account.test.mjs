// lib/account.test.mjs — account deletion end to end, against DEV. node --test.
// Creates a user with a row in EVERY table the deletion must clear (auth adapter
// rows with no FK, a custom config + a draft referencing it, picks, a read,
// a verification token), deletes, and asserts zero rows remain everywhere.
// Run: node --test lib/account.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '.env.local'));

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const acct = await import('./account.js');

const MARK = 'acctdel-%@example.invalid';
async function wipe() {
  // best-effort cleanup on failure: cascade from users, plus the no-FK tables.
  const users = await sql`SELECT id, email FROM users WHERE email LIKE ${MARK}`;
  for (const u of users) {
    await sql`DELETE FROM sessions WHERE "userId" = ${u.id}`;
    await sql`DELETE FROM accounts WHERE "userId" = ${u.id}`;
    await sql`DELETE FROM tag_follows WHERE user_id = ${u.id}`;
    await sql`DELETE FROM verification_token WHERE identifier = ${u.email}`;
    await sql`DELETE FROM users WHERE id = ${u.id}`;
  }
}
before(wipe);
after(wipe);

async function count(q) { return (await q)[0].n; }

test('deleteAccountFor removes the user and every owned row, leaving no orphans', async () => {
  const email = `acctdel-${Date.now()}@example.invalid`;
  const userId = (await sql`INSERT INTO users (name, email) VALUES ('Acct Del', ${email}) RETURNING id`)[0].id;

  // auth adapter rows (NO FK to users)
  await sql`INSERT INTO sessions ("userId", expires, "sessionToken") VALUES (${userId}, now() + interval '7 days', ${'tok-' + userId})`;
  await sql`INSERT INTO accounts ("userId", type, provider, "providerAccountId") VALUES (${userId}, 'oidc', 'apple', ${'apple-' + userId})`;
  await sql`INSERT INTO verification_token (identifier, expires, token) VALUES (${email}, now() + interval '1 day', ${'vt-' + userId})`;

  // a user-owned custom config + a draft referencing it (exercises the
  // drafts.config_id path where both cascade from the users delete) + a pick + a read
  const cfgId = (await sql`
    INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots, pick_timer_seconds, is_preset, source)
    VALUES (${userId}, 'Custom', 12, 'ppr', '{"QB":1,"RB":2,"WR":2,"TE":1,"FLEX":1,"K":1,"DST":1,"BN":6}'::jsonb, 60, false, 'manual')
    RETURNING id`)[0].id;
  const draftId = (await sql`
    INSERT INTO drafts (user_id, config_id, status, pick_position, is_auto, pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at)
    VALUES (${userId}, ${cfgId}, 'completed', 5, false, '2026-07-15', 'ppr', 12, now())
    RETURNING id`)[0].id;
  await sql`INSERT INTO draft_picks (draft_id, round, overall_pick, roster_slot, ffc_player_id, player_name, position, picked_by, adp_at_pick, picked_at)
            VALUES (${draftId}, 1, 5, 'RB', 'ffc-1', 'Test Back', 'RB', 'user', 5.0, now())`;
  await sql`INSERT INTO draft_reads (draft_id, grade, grade_score, prose_source) VALUES (${draftId}, 'A-', 90, 'fallback')`;

  // tag_follows only if a tag exists to reference (loose user_id, real tag_id FK)
  const tag = (await sql`SELECT id FROM tags LIMIT 1`)[0];
  if (tag) await sql`INSERT INTO tag_follows (user_id, tag_id) VALUES (${userId}, ${tag.id}) ON CONFLICT DO NOTHING`;

  // sanity: rows exist before deletion
  assert.equal(await count(sql`SELECT count(*)::int n FROM drafts WHERE user_id = ${userId}`), 1);
  assert.equal(await count(sql`SELECT count(*)::int n FROM draft_picks WHERE draft_id = ${draftId}`), 1);

  // DELETE
  const res = await acct.deleteAccountFor(userId, email);
  assert.equal(res.ok, true);
  assert.equal(res.existed, true);

  // zero rows remain, everywhere
  assert.equal(await count(sql`SELECT count(*)::int n FROM users WHERE id = ${userId}`), 0, 'users');
  assert.equal(await count(sql`SELECT count(*)::int n FROM accounts WHERE "userId" = ${userId}`), 0, 'accounts');
  assert.equal(await count(sql`SELECT count(*)::int n FROM sessions WHERE "userId" = ${userId}`), 0, 'sessions');
  assert.equal(await count(sql`SELECT count(*)::int n FROM verification_token WHERE identifier = ${email}`), 0, 'verification_token');
  assert.equal(await count(sql`SELECT count(*)::int n FROM draft_configs WHERE user_id = ${userId}`), 0, 'draft_configs');
  assert.equal(await count(sql`SELECT count(*)::int n FROM drafts WHERE user_id = ${userId}`), 0, 'drafts');
  assert.equal(await count(sql`SELECT count(*)::int n FROM draft_picks WHERE draft_id = ${draftId}`), 0, 'draft_picks (cascade)');
  assert.equal(await count(sql`SELECT count(*)::int n FROM draft_reads WHERE draft_id = ${draftId}`), 0, 'draft_reads (cascade)');
  assert.equal(await count(sql`SELECT count(*)::int n FROM tag_follows WHERE user_id = ${userId}`), 0, 'tag_follows');
});

test('deleteAccountFor is idempotent (second call removes nothing, still ok)', async () => {
  const email = `acctdel-idem-${Date.now()}@example.invalid`;
  const userId = (await sql`INSERT INTO users (name, email) VALUES ('Acct Del', ${email}) RETURNING id`)[0].id;
  const first = await acct.deleteAccountFor(userId, email);
  assert.equal(first.existed, true);
  const second = await acct.deleteAccountFor(userId, email);
  assert.equal(second.ok, true);
  assert.equal(second.existed, false, 'no user row the second time');
});
