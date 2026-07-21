// lib/account.js — permanent account deletion (App Store guideline 5.1.1(v)).
//
// Flow-core: takes the user id EXPLICITLY (the 'use server' action resolves it
// from the session and never trusts a client id). One transaction, idempotent:
// a second call for the same id deletes nothing and still returns ok.
//
// FK MAP (recon of the live schema):
//   ON DELETE CASCADE from users(id) - removed automatically by the users delete:
//     draft_configs.user_id, drafts.user_id (-> draft_picks.draft_id,
//     draft_reads.draft_id), user_team_follows, user_dashboards,
//     user_player_follows.
//   NO foreign key to users - MUST be deleted explicitly or they orphan:
//     sessions."userId", accounts."userId" (the Auth.js pg-adapter tables carry
//     no FK), tag_follows.user_id (loose, FK "added later" per migration 015).
//     verification_token has no user column at all - it is keyed by the email
//     identifier, so pending magic-link tokens for this address are cleared too.

import { sql } from './db.js';

/**
 * Delete a user and ALL their data. Returns { ok: true, existed } where
 * `existed` is whether a users row was actually removed (false on a repeat call).
 * @param {number} userId
 * @param {string|null} email  the user's email, to clear verification tokens
 */
export async function deleteAccountFor(userId, email) {
  const stmts = [
    sql`DELETE FROM sessions WHERE "userId" = ${userId}`,
    sql`DELETE FROM accounts WHERE "userId" = ${userId}`,
    sql`DELETE FROM tag_follows WHERE user_id = ${userId}`,
  ];
  if (email) stmts.push(sql`DELETE FROM verification_token WHERE identifier = ${email}`);
  // The users delete cascades to drafts (-> picks/reads), draft_configs, and the
  // *_follows / dashboards tables. RETURNING lets us report whether it existed.
  stmts.push(sql`DELETE FROM users WHERE id = ${userId} RETURNING id`);

  const results = await sql.transaction(stmts);
  const deletedUser = results[results.length - 1];
  return { ok: true, existed: Array.isArray(deletedUser) ? deletedUser.length > 0 : Boolean(deletedUser?.length) };
}
