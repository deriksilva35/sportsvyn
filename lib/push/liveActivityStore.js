// lib/push/liveActivityStore.js - the live_activities table, and the fan-out
// that reads it. Separate from liveActivity.js (which is payloads and one
// HTTP/2 POST and touches no database) so the sender stays testable without a
// connection and this stays testable without a network.
//
// PARSING LIVES HERE, NOT IN THE ROUTES. Both routes are thin on purpose: the
// shape of the contract is a fact about the system, and a fact about the
// system belongs where it can be unit-tested without standing up a Request.

import { sendToActivity, updatePayload, endPayload, liveActivityConfig } from './liveActivity.js';

// An Activity id is a UUID as the app sees it. Bounded and charset-strict
// rather than a UUID regex: Apple documents the type, not the format, and a
// value we merely fail to recognise is not a value worth 400-ing over. Same
// posture as device_tokens' token bound.
const ACTIVITY_ID_RE = /^[0-9a-zA-Z_:-]{8,128}$/;
// The Activity push token is hex, like a device token, and longer - 160 chars
// is typical against a device token's 64.
const TOKEN_RE = /^[0-9a-fA-F]{16,512}$/;

/**
 * POST body -> the row's fields, or the reason it is malformed.
 * @returns {{ok:true, value:{activityId,pushToken,matchId,startedAt}}|{ok:false, reason:string}}
 */
export function parseRegister(body) {
  const activityId = String(body?.activityId ?? '').trim();
  if (!ACTIVITY_ID_RE.test(activityId)) return { ok: false, reason: 'bad activityId' };
  const pushToken = String(body?.pushToken ?? '').trim();
  if (!TOKEN_RE.test(pushToken)) return { ok: false, reason: 'bad pushToken' };
  const matchId = Number(body?.matchId);
  if (!Number.isInteger(matchId) || matchId <= 0) return { ok: false, reason: 'bad matchId' };
  // startedAt is the APP's clock. It is stored as sent rather than replaced
  // with now(): an Activity started in a tunnel registers when the signal
  // comes back, and the gap between started_at and created_at is the only
  // record that it happened.
  const startedAt = body?.startedAt == null ? new Date() : new Date(body.startedAt);
  if (Number.isNaN(startedAt.getTime())) return { ok: false, reason: 'bad startedAt' };
  return { ok: true, value: { activityId, pushToken, matchId, startedAt } };
}

/** @returns {{ok:true, value:{activityId:string}}|{ok:false, reason:string}} */
export function parseEnd(body) {
  const activityId = String(body?.activityId ?? '').trim();
  if (!ACTIVITY_ID_RE.test(activityId)) return { ok: false, reason: 'bad activityId' };
  return { ok: true, value: { activityId } };
}

/**
 * REVIVE-IN-PLACE, 070's rule applied to Activities. Apple hands the same
 * Activity a NEW push token through pushTokenUpdates whenever it feels like
 * it, and the app re-registers when it does; that must update this row, not
 * insert a second one for the same Activity. A re-register also clears
 * ended_at and revoked_at: the app only re-registers an Activity it still
 * holds, so its own word is better evidence than our last failed send.
 */
export async function registerActivity(sql, { activityId, pushToken, userId, matchId, startedAt }) {
  const [row] = await sql`
    INSERT INTO live_activities (activity_id, push_token, user_id, match_id, started_at)
    VALUES (${activityId}, ${pushToken}, ${userId == null ? null : Number(userId)},
            ${Number(matchId)}, ${startedAt.toISOString()})
    ON CONFLICT (activity_id) DO UPDATE
      SET push_token = EXCLUDED.push_token,
          user_id    = EXCLUDED.user_id,
          match_id   = EXCLUDED.match_id,
          started_at = EXCLUDED.started_at,
          updated_at = now(),
          ended_at   = NULL,
          revoked_at = NULL
    RETURNING activity_id, push_token, user_id, match_id, started_at, ended_at, revoked_at`;
  return row ?? null;
}

/**
 * The app says this Activity is gone. IDEMPOTENT AND QUIET: ending an
 * Activity that is already ended, or one this account never registered,
 * returns ok either way. The route must not become an oracle for which
 * Activity ids exist, and an app that retries an end call on a flaky
 * connection is doing the right thing.
 *
 * `ended`, though, is the truth - it says whether THIS call is what stopped
 * the pushes, which is the only fact worth logging.
 */
export async function endActivity(sql, { activityId, userId = null }) {
  // TWO STATEMENTS RATHER THAN ONE WITH A NULLABLE PREDICATE. A single query
  // carrying "(:uid IS NULL OR user_id = :uid)" needs a cast to survive a
  // NULL parameter, and a cast in a WHERE clause is where an ownership check
  // quietly stops checking. The branch is legible; the cast would not be.
  const rows = userId == null
    ? await sql`
        UPDATE live_activities SET ended_at = now(), updated_at = now()
         WHERE activity_id = ${activityId} AND ended_at IS NULL
        RETURNING activity_id`
    : await sql`
        UPDATE live_activities SET ended_at = now(), updated_at = now()
         WHERE activity_id = ${activityId} AND ended_at IS NULL
           AND (user_id IS NULL OR user_id = ${Number(userId)})
        RETURNING activity_id`;
  return { ended: rows.length > 0 };
}

/** Every Activity still alive for one match. The partial index's query. */
export async function liveActivitiesFor(sql, matchId) {
  return sql`
    SELECT activity_id, push_token, user_id, match_id, started_at
      FROM live_activities
     WHERE match_id = ${Number(matchId)}
       AND ended_at IS NULL AND revoked_at IS NULL
     ORDER BY created_at ASC`;
}

/** 070'S SINGLE REVOCATION PATH, applied here: a dead token is stamped, not
 * deleted and not retried. WHEN it died is the debugging fact. */
export async function revokeActivity(sql, activityId) {
  await sql`UPDATE live_activities SET revoked_at = now(), updated_at = now()
             WHERE activity_id = ${activityId} AND revoked_at IS NULL`;
}

/**
 * WHICH TRANSITIONS MOVE A CARD - the Part C ruling, in one function.
 *
 *   score or quarter -> 'update'      final -> 'end'      anything else -> null
 *
 * NEVER PER POLL. The clock on the card is stale by at most one poll, which is
 * the staleness /scores and the game page already carry, and Q4 with no time
 * showing is the one state where the missing number changes what the score
 * means. Roughly 15-20 pushes a game, which is what the budget supports.
 *
 * KICKOFF AND CLOSE DO NOT MOVE IT. A kickoff is 0-0 with no clock worth
 * showing, and 'close' is an editorial judgement about a game, not a change to
 * any of the six fields - pushing on either would spend the budget on a card
 * that looks identical afterwards.
 *
 * AT MOST ONE PUSH PER POLL, and the final is one OF the stream rather than on
 * top of it: a poll that sees the last score and the whistle together sends a
 * single 'end' carrying the final score, not an update chased by an end.
 */
export function activityEventFor(transitions = []) {
  const kinds = new Set((transitions ?? []).map((t) => t?.event));
  if (kinds.has('final')) return 'end';
  if (kinds.has('score') || kinds.has('quarter')) return 'update';
  return null;
}

/**
 * ONE MATCH'S ACTIVITIES, ONE PUSH EACH.
 *
 * @param event 'update' | 'end'
 * @param state the six fields; contentState() trims anything else
 * @param send  the transport, injectable so a test can drive 410 without a
 *              network. Defaults to the real APNs POST.
 * @returns a summary shaped like dispatch()'s: counts only, safe for a ledger.
 *
 * NEVER THROWS. A Live Activity is a courtesy on a lock screen and the poller
 * tick that calls this has a scoreboard to write.
 */
export async function pushLiveActivities(sql, {
  matchId, state, event = 'update', now = new Date(), env = process.env,
  send = sendToActivity, log = () => {},
} = {}) {
  const out = { matchId: matchId ?? null, event, activities: 0, sent: 0, failed: 0, revoked: 0, skipped: 0 };
  const cfg = liveActivityConfig(env);
  const rows = await liveActivitiesFor(sql, matchId);
  out.activities = rows.length;
  if (!rows.length) return out;
  // THE GATE IS CHECKED AFTER THE READ, not before: knowing that four
  // Activities WOULD have been pushed is the fact that tells a dark night
  // apart from an empty one.
  if (!cfg.enabled) { out.skipped = rows.length; return out; }

  const payload = event === 'end'
    ? endPayload(state, { now })
    : updatePayload(state, { now });

  for (const r of rows) {
    let res;
    try {
      res = await send(cfg, r.push_token, payload);
    } catch (e) {
      res = { ok: false, status: 0, reason: String(e?.message ?? e), gone: false };
    }
    if (res?.ok) {
      out.sent += 1;
      await sql`UPDATE live_activities SET updated_at = now()
                 WHERE activity_id = ${r.activity_id}`;
      if (event === 'end') {
        await sql`UPDATE live_activities SET ended_at = now(), updated_at = now()
                   WHERE activity_id = ${r.activity_id} AND ended_at IS NULL`;
      }
      continue;
    }
    out.failed += 1;
    if (res?.gone) {
      await revokeActivity(sql, r.activity_id);
      out.revoked += 1;
    }
    log(`[live-activity] ${event} failed activity=${r.activity_id} status=${res?.status ?? 0} reason=${res?.reason ?? 'none'}`);
  }
  return out;
}
