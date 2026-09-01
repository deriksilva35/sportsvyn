// lib/push/dispatch.js — from one game event to N notifications.
//
// A RIDER ON THE POLLER, NOT A SECOND POLLER. It is handed the transitions the
// live loop already saw and never asks a provider anything. That is what keeps
// "the alert fires within a minute" true: the loop that noticed is the loop
// that sends.
//
// THE DEDUPE IS A UNIQUE INDEX, NOT A MEMORY. systemd restarts this process by
// design, and a dispatcher remembering its sends in memory would re-notify
// every in-flight game on every crash - the one failure mode that gets an app
// deleted. push_sends (device_id, event_key) is unique, so a repeat send
// CONFLICTS and never happens, rather than being merely unlikely.

import { resolvePrefs, wants, eventKey } from './prefs.js';
import { pushPayload } from './payload.js';
import { webSender, iosSender, isAuthFailure } from './senders.js';

/**
 * Everyone who should hear about this game, with their resolved prefs.
 *
 * FOLLOWERS OF EITHER SIDE. A game is two teams' game and a follower of the
 * loser asked for it just as much.
 */
export async function audienceFor(sql, match) {
  const rows = await sql`
    SELECT DISTINCT ON (d.token)
           d.token, d.user_id, d.platform, d.endpoint, d.p256dh, d.auth,
           tp.master AS t_master, tp.kickoff AS t_kickoff, tp.score AS t_score,
           tp.quarter AS t_quarter, tp.close AS t_close, tp.final_only AS t_final_only,
           mp.master AS m_master, mp.kickoff AS m_kickoff, mp.score AS m_score,
           mp.quarter AS m_quarter, mp.close AS m_close, mp.final_only AS m_final_only
      FROM user_team_follows f
      JOIN device_tokens d ON d.user_id = f.user_id AND d.revoked_at IS NULL
      LEFT JOIN alert_prefs tp
             ON tp.user_id = f.user_id AND tp.scope = 'team' AND tp.scope_id = f.team_id
      LEFT JOIN alert_prefs mp
             ON mp.user_id = f.user_id AND mp.scope = 'match' AND mp.scope_id = ${match.id}
     WHERE f.team_id IN (${match.home_team_id}, ${match.away_team_id})
     ORDER BY d.token`;
  return rows.map((r) => ({
    userId: r.user_id, platform: r.platform,
    // ONE ROW, TWO TRANSPORTS. `token` is the identity every 070 query joins
    // on and, for a web row, is the endpoint URL again; `endpoint` is what the
    // web sender actually posts to. iOS reads token and ignores the rest.
    token: r.token, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth,
    prefs: resolvePrefs({
      teamPref: r.t_master == null ? null : {
        master: r.t_master, kickoff: r.t_kickoff, score: r.t_score,
        quarter: r.t_quarter, close: r.t_close, final_only: r.t_final_only },
      matchPref: r.m_master == null ? null : {
        master: r.m_master, kickoff: r.m_kickoff, score: r.m_score,
        quarter: r.m_quarter, close: r.m_close, final_only: r.m_final_only },
    }),
  }));
}

/**
 * Dispatch one event. Returns a summary; writes push_sends rows.
 *
 * THE CLAIM IS TAKEN BEFORE THE SEND, NOT AFTER. The row goes in first and the
 * send follows; a crash between the two loses one notification, while claiming
 * afterwards would send twice on every crash. Losing one is recoverable by the
 * next event thirty seconds later; sending twice is not recoverable at all.
 */
export async function dispatch(sql, { match, event, state = {}, senders = null, log = () => {} }) {
  const out = { event, matchId: match?.id ?? null, audience: 0, eligible: 0, sent: 0, failed: 0, revoked: 0, skipped: 0, authFailure: false };
  const key = eventKey(event, match?.id, state);
  if (!key) return out;

  const audience = await audienceFor(sql, match);
  out.audience = audience.length;
  if (!audience.length) return out;

  const payload = pushPayload(event, { ...match, ...state });
  if (!payload) return out;

  const send = senders ?? { web: webSender(), ios: iosSender() };

  for (const d of audience) {
    if (!wants(d.prefs, event)) continue;
    out.eligible += 1;

    // CLAIM FIRST. ON CONFLICT DO NOTHING returns no row, which is the signal
    // that somebody - a previous poll, or this process before it restarted -
    // already has this one.
    const claimed = await sql`
      INSERT INTO push_sends (device_token, match_id, event_key)
      VALUES (${d.token}, ${match.id}, ${key})
      ON CONFLICT (device_token, event_key) DO NOTHING
      RETURNING id`;
    if (!claimed.length) { out.skipped += 1; continue; }

    const fn = send[d.platform];
    const res = fn ? await fn(d, payload) : { ok: false, status: 0, error: `no sender for ${d.platform}` };
    if (res.skipped) { out.skipped += 1; }
    else if (res.ok) { out.sent += 1; }
    else { out.failed += 1; }
    if (isAuthFailure(res)) out.authFailure = true;

    await sql`UPDATE push_sends SET ok = ${Boolean(res.ok)}, status_code = ${res.status ?? null},
                error = ${res.error ?? null} WHERE id = ${claimed[0].id}`;

    if (res.gone) {
      // REVOKED, NOT DELETED. A dead endpoint is not a withdrawn consent, and
      // the row is the only evidence of which it was.
      // REVOCATION STAYS 070'S SINGLE PATH: revoked_at on the token row, which
      // is also what the iOS notifier writes and what revive-in-place clears.
      await sql`UPDATE device_tokens SET revoked_at = now() WHERE token = ${d.token}`;
      out.revoked += 1;
    }
  }
  log(`[push] ${event} match=${match.id} audience=${out.audience} eligible=${out.eligible} sent=${out.sent} skipped=${out.skipped} failed=${out.failed}`);
  return out;
}
