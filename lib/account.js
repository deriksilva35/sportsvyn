// lib/account.js — permanent account deletion (App Store guideline 5.1.1(v)).
//
// Flow-core: takes the user id EXPLICITLY (the 'use server' action resolves it
// from the session and never trusts a client id). One transaction, idempotent:
// a second call for the same id deletes nothing and still returns ok.
//
// FK MAP (recon of the live schema):
//   ON DELETE CASCADE from users(id) - removed automatically by the users delete:
//     draft_configs.user_id (-> draft_config_keepers, draft_config_members,
//     draft_config_invites, and since 085 drafts.config_id: a MEMBER's run of
//     this owner's league goes with the league, or the delete would fail on
//     the FK), drafts.user_id (-> draft_picks.draft_id, draft_reads.draft_id),
//     draft_config_members.user_id, user_team_follows, user_dashboards,
//     user_player_follows, memberships.user_id, revenuecat_events.user_id
//     (migration 056 - the Apple IAP ledger holds a user reference, so it is
//     CASCADE precisely so it cannot block this delete).
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
 * @param {{ underage?: boolean }} [opts]  underage: also remove device tokens,
 *   live activities, sign-in code rows and newsletter rows (see below)
 */
export async function deleteAccountFor(userId, email, opts = {}) {
  const stmts = [
    sql`DELETE FROM sessions WHERE "userId" = ${userId}`,
    sql`DELETE FROM accounts WHERE "userId" = ${userId}`,
    sql`DELETE FROM tag_follows WHERE user_id = ${userId}`,
  ];
  if (email) stmts.push(sql`DELETE FROM verification_token WHERE identifier = ${email}`);
  // UNDER 13 (age-gate, fri-5): NOTHING IS KEPT. The ordinary deletion leaves
  // device_tokens and live_activities behind with user_id NULLed (their FKs are
  // SET NULL on purpose - a token outlives an account). For a child's account
  // that is the wrong default: an APNs token is a persistent identifier of
  // their device, so it goes too, along with the sign-in code rows and any
  // newsletter row for the same address. All in the same transaction.
  if (opts.underage) {
    stmts.push(sql`DELETE FROM device_tokens WHERE user_id = ${userId}`);
    stmts.push(sql`DELETE FROM live_activities WHERE user_id = ${userId}`);
    if (email) {
      stmts.push(sql`DELETE FROM email_otp WHERE identifier = ${email}`);
      stmts.push(sql`DELETE FROM email_signups WHERE lower(email) = lower(${email})`);
    }
  }
  // The users delete cascades to drafts (-> picks/reads), draft_configs, and the
  // *_follows / dashboards tables. RETURNING lets us report whether it existed.
  stmts.push(sql`DELETE FROM users WHERE id = ${userId} RETURNING id`);

  const results = await sql.transaction(stmts);
  const deletedUser = results[results.length - 1];
  return { ok: true, existed: Array.isArray(deletedUser) ? deletedUser.length > 0 : Boolean(deletedUser?.length) };
}
