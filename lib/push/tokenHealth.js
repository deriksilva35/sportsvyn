// lib/push/tokenHealth.js - ONE PLACE THAT KNOWS WHETHER A TOKEN IS ALIVE.
//
// ============================================================================
// THE DEFECT THIS CLOSES, DATED
// ============================================================================
// 15-18 Sep 2026: a device token APNs rejected on every single event was
// revoked by the sender and then brought back to life by the next app launch,
// every day, for three days. The reader received nothing and the ledger said
// "sent 49, failed 0". Both halves of that were working as written:
//
//   dispatch.js  revoked the token on `gone`
//   notify.js    revoked the token on `gone`
//   register     cleared revoked_at on every launch, unconditionally
//
// Nothing was wrong with any one of them. What was missing was MEMORY: a
// single revoked_at cannot tell a token that died once from one that has died
// eleven times, so the third party in the loop - the register route - had no
// basis on which to refuse.
//
// TWO WRITE SITES, ONE FUNCTION. The game path and the cron path both record
// every send here. They had two copies of the revoke statement before this and
// would have needed two copies of the strike arithmetic; the one that drifts is
// always the one nobody is looking at.
//
// STRIKES ARE PER TOKEN, NEVER PER DEVICE, and that is what makes the refusal
// safe. A phone whose token is genuinely dead receives a NEW token string from
// APNs on reinstall or re-permission - 73AC73E8... on 18 Sep at 01:15, which
// took every push afterwards. A new token is a new row at zero strikes. This
// blocks the corpse; it cannot block the device.

import { pushWarn } from './warn.js';

/**
 * Consecutive rejections after which register stops reviving a token.
 *
 * TWO, NOT ONE. A single rejection can be transient - APNs answering oddly, or
 * a token caught mid-reissue - and refusing a device after one bad night would
 * be worse than the bug this fixes. Two consecutive, with no successful send
 * between them, is not transient. The token that started all this had eleven.
 */
export const STRIKE_LIMIT = 2;

/**
 * Record the outcome of one send against the token row.
 *
 * ok        -> strikes reset to 0. last_rejected_at is LEFT ALONE: it is
 *              history, and "this token died in September and recovered" is
 *              worth being able to read.
 * gone      -> strikes + 1, last_rejected_at stamped, revoked_at stamped.
 * neither   -> nothing. A timeout or a 500 from APNs is our problem or the
 *              network's, not evidence about this device, and counting it
 *              would eventually refuse a device over an outage.
 *
 * NEVER THROWS. Every caller is mid-send-loop with a scoreboard to write; a
 * bookkeeping failure must not cost the push that came after it.
 *
 * @returns {Promise<{strikes: number, revoked: boolean}|null>}
 */
export async function recordSend(sql, token, res) {
  if (!token || !res) return null;
  try {
    if (res.ok) {
      const [row] = await sql`
        UPDATE device_tokens SET strikes = 0
         WHERE token = ${token} AND strikes <> 0
         RETURNING strikes`;
      return { strikes: 0, revoked: false, reset: Boolean(row) };
    }
    if (!res.gone) return null;
    const [row] = await sql`
      UPDATE device_tokens
         SET strikes = strikes + 1, last_rejected_at = now(), revoked_at = now()
       WHERE token = ${token}
       RETURNING strikes`;
    const strikes = Number(row?.strikes ?? 0);
    // A token that has just struck out is worth a line in the log the moment
    // it happens, because the next thing that touches it is a launch that will
    // be refused - and a refusal nobody can explain is its own bug report.
    if (strikes >= STRIKE_LIMIT) {
      pushWarn('tokenStruckOut', { detail: `${String(token).slice(0, 12)}… strikes=${strikes} reason=${res.reason ?? res.error ?? 'gone'}` });
    }
    return { strikes, revoked: true };
  } catch {
    return null;
  }
}

/**
 * May register revive this token row?
 *
 * A row that does not exist yet is revivable by definition - it is a first
 * registration, and the caller inserts it.
 */
export function canRevive(row) {
  if (!row) return true;
  return Number(row.strikes ?? 0) < STRIKE_LIMIT;
}
