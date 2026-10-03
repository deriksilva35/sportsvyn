// lib/auth/ageGateDb.js - the age gate's database half. Every write door calls
// ageGateRefusal() (server actions) or ageGateResponse() (API routes) right
// after its signed-out check; lib/auth/ageGateDoors.test.mjs walks app/ and
// fails on a door that does not.
//
// FAILS CLOSED. The handle gate (lib/onboarding.js userHasHandle) fails open,
// because a wrong "no" there puts a modal in front of someone. A wrong "yes"
// here lets an unscreened account play, so a failed read refuses the write -
// and a write that would have run against the same database would almost
// certainly have failed anyway.

import { sql as defaultSql } from '../db.js';
import { deleteAccountFor } from '../account.js';
import { gateVerdict, judgeAnswer, REASON_UNDERAGE } from './ageGate.js';

/** The refusal every gated server action returns. The client reads `reason`. */
export const AGE_GATE_REFUSAL = Object.freeze({
  ok: false, reason: 'age_gate', next: '/age', message: 'Confirm your date of birth first.',
});

/** The one read: this user's date of birth. Never selected anywhere public. */
async function readDob(userId, db) {
  // ::text - a DATE parsed into a JS Date lands at LOCAL midnight, which is
  // the previous day anywhere west of UTC. The string is exact.
  const rows = await db`SELECT date_of_birth::text AS date_of_birth FROM users WHERE id = ${Number(userId)} LIMIT 1`;
  return rows[0] ?? null;
}

/**
 * null when the user may write; the refusal object when not. A null userId is
 * NOT this function's business (every door already refuses signed-out callers
 * with its own reason) and returns null.
 */
export async function ageGateRefusal(userId, db = defaultSql) {
  if (userId == null) return null;
  let row;
  try { row = await readDob(userId, db); } catch { return AGE_GATE_REFUSAL; }
  return gateVerdict(row).ok ? null : AGE_GATE_REFUSAL;
}

/** API-route form: a 403 Response, or null to carry on. */
export async function ageGateResponse(userId, db = defaultSql) {
  const refused = await ageGateRefusal(userId, db);
  if (!refused) return null;
  return Response.json({ error: 'age_gate', next: '/age' }, { status: 403 });
}

/** Has this account already answered (and passed)? For /age and /age/check. */
export async function hasPassed(userId, db = defaultSql) {
  if (userId == null) return false;
  try { return gateVerdict(await readDob(userId, db)).ok; } catch { return false; }
}

/** A blocked retry deletes the account only when sign-up just made it. */
export const FRESH_ACCOUNT_MS = 24 * 60 * 60 * 1000;

/**
 * Apply one answer from the age screen. The action (app/actions/age.js) owns
 * cookies; this owns the database, so it can be driven from a test.
 *
 *   stored    13+ : date_of_birth written once (never overwritten)
 *   invalid   not a real date : nothing written, the form says so
 *   underage  under 13, OR this browser/install was already refused:
 *             the account is deleted in one transaction (lib/account.js,
 *             underage) - except a blocked retry on an account older than a
 *             day, which is signed out but kept (it may be a parent's account
 *             on a shared browser; it stays unable to play until answered
 *             from another browser).
 *
 * The submitted date is NEVER stored or logged on the underage path.
 *
 * @returns {Promise<{ outcome: 'stored'|'invalid'|'underage', reason?: string, deleted?: boolean }>}
 */
export async function applyAnswer(db, { userId, email = null, createdAt = null, fields, blocked = false, now = new Date() }) {
  if (userId == null) return { outcome: 'invalid', reason: 'signed_out' };
  const row = await readDob(userId, db);
  if (!row) return { outcome: 'invalid', reason: 'no_account' };
  // ALREADY ANSWERED: the prompt is once. A second submission changes nothing.
  if (gateVerdict(row, now).ok) return { outcome: 'stored', already: true };

  const verdict = judgeAnswer(fields, { blocked, now });
  if (verdict.ok) {
    await db`UPDATE users SET date_of_birth = ${verdict.iso}::date
              WHERE id = ${Number(userId)} AND date_of_birth IS NULL`;
    return { outcome: 'stored' };
  }
  if (verdict.reason !== REASON_UNDERAGE) return { outcome: 'invalid', reason: verdict.reason };

  const fresh = createdAt == null || (now.getTime() - new Date(createdAt).getTime()) < FRESH_ACCOUNT_MS;
  const del = !blocked || fresh;
  if (del) await deleteAccountFor(Number(userId), email, { underage: true });
  else await db`DELETE FROM sessions WHERE "userId" = ${Number(userId)}`;
  return { outcome: 'underage', deleted: del };
}

/** The account facts applyAnswer needs, read by id (email for the cascade). */
export async function accountFacts(userId, db = defaultSql) {
  const rows = await db`SELECT id, email, created_at FROM users WHERE id = ${Number(userId)} LIMIT 1`;
  return rows[0] ?? null;
}
