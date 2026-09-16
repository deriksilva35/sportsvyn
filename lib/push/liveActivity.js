// lib/push/liveActivity.js - the Live Activity sender. A SIBLING of
// lib/push/apns.js, not a flag on it.
//
// WHY A SIBLING. An alert push and a Live Activity push share the ES256
// provider token and nothing else that matters: different apns-topic (the
// bundle id with a .push-type.liveactivity suffix Apple requires and rejects
// requests without), different apns-push-type, a body with no alert and no
// sound, and a payload whose whole meaning is a content-state dictionary the
// widget decodes into a Swift struct. Threading two of those through
// sendToToken() as options would put a branch in the path that carries every
// score alert we send, to serve a surface that does not ship yet. The JWT is
// imported, not copied - that cache is the one piece Apple throttles.
//
// THE SIX FIELDS ARE THE CONTRACT (LIVE ACTIVITY TOKENS AND UPDATES):
//   { awayAbbr, awayScore, homeAbbr, homeScore, period, clock }
// Exactly these, no more, until both sides agree a seventh. contentState()
// below is the only place a content-state is built, so "no more" is enforced
// by construction rather than by everyone remembering: it reads its six named
// fields off whatever it is handed and drops the rest on the floor.
//
// FAIL-SOFT, same as apns.js: nothing here throws to a caller on a delivery
// problem.

import http2 from 'node:http2';
import { apnsConfig, apnsJwt } from './apns.js';

/**
 * The Live Activity topic: the app's bundle id plus Apple's required suffix.
 * Derived from cfg.topic rather than hard-coded so an APNS_TOPIC override
 * (the bundle id lives in the Mac's Xcode project, not this repo) carries
 * through to both push types at once. With the default APNS_TOPIC this is
 * exactly the contract's
 * com.sportsvyn.draftvyn.push-type.liveactivity.
 */
export function liveActivityTopic(cfg) {
  return `${cfg.topic}.push-type.liveactivity`;
}

const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const str = (v) => (v == null ? '' : String(v));

/**
 * The six, and only the six. Scores are integers because the widget decodes
 * them into Int and a JSON string there is a decode failure, which on a Live
 * Activity shows up as the card silently freezing on its last good state -
 * the single hardest failure to notice from the server side. period and clock
 * stay strings exactly as the poller has them ("Q3", "7:28").
 */
export function contentState(s = {}) {
  return {
    awayAbbr: str(s.awayAbbr),
    awayScore: int(s.awayScore),
    homeAbbr: str(s.homeAbbr),
    homeScore: int(s.homeScore),
    period: str(s.period),
    clock: str(s.clock),
  };
}

/** aps.timestamp is UNIX SECONDS, and Apple drops an update whose timestamp
 * is not newer than the one the widget already holds - so it is the sequence
 * number of this stream, not decoration. */
const unix = (now) => Math.floor((now instanceof Date ? now.getTime() : Number(now ?? Date.now())) / 1000);

/** event: "update" - a score or a quarter. */
export function updatePayload(state, { now = new Date() } = {}) {
  return {
    aps: {
      timestamp: unix(now),
      event: 'update',
      'content-state': contentState(state),
    },
  };
}

/**
 * event: "end" - the whistle. dismissal-date is when the SYSTEM removes the
 * card; the state sent with it is what the reader sees until then, so a final
 * ends with the final score rather than a blank.
 *
 * @param dismissAt Date|number - default 30 minutes out, long enough to walk
 *   away from the game and still find the score on the lock screen.
 */
export function endPayload(state, { now = new Date(), dismissAt = null } = {}) {
  const base = now instanceof Date ? now.getTime() : Number(now ?? Date.now());
  return {
    aps: {
      timestamp: unix(now),
      event: 'end',
      'content-state': contentState(state),
      'dismissal-date': unix(dismissAt ?? new Date(base + 30 * 60 * 1000)),
    },
  };
}

// ---------------------------------------------------------------------------
// ONE POST PER ACTIVITY TOKEN.
// ---------------------------------------------------------------------------
// The transport is apns.js's, deliberately re-written rather than shared: its
// sendToToken() hard-codes the alert headers, and the instruction for this
// relay is a sibling, not a flag. Everything structural is the same and for
// the same reasons - node:http2 because APNs refuses HTTP/1.1 and Node's
// fetch will not speak h2, a 10s guard because a hung connection must resolve
// rather than dangle inside a poller tick, and `gone` covering 410 alongside
// BadDeviceToken / Unregistered.
/**
 * @returns {Promise<{ok:boolean, status:number, reason:string|null, gone:boolean}>}
 *   `gone` means this Activity's token is dead and the row should be revoked,
 *   never retried. Never throws.
 */
export function sendToActivity(cfg, token, payload, { priority = '10' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let client;
    const done = (v) => {
      if (settled) return;
      settled = true;
      try { client?.close(); } catch { /* already gone */ }
      resolve(v);
    };
    try {
      client = http2.connect(cfg.host);
    } catch (e) {
      return done({ ok: false, status: 0, reason: String(e?.message ?? e), gone: false });
    }
    client.on('error', (e) => done({ ok: false, status: 0, reason: String(e?.message ?? e), gone: false }));
    const guard = setTimeout(() => done({ ok: false, status: 0, reason: 'timeout', gone: false }), 10_000);

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${apnsJwt(cfg)}`,
      'apns-topic': liveActivityTopic(cfg),
      'apns-push-type': 'liveactivity',
      'apns-priority': priority,
      'content-type': 'application/json',
    });
    let status = 0;
    let body = '';
    req.on('response', (headers) => { status = headers[':status'] ?? 0; });
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      clearTimeout(guard);
      if (status === 200) return done({ ok: true, status: 200, reason: null, gone: false });
      let reason = null;
      try { reason = JSON.parse(body)?.reason ?? null; } catch { /* empty body */ }
      const gone = status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered';
      done({ ok: false, status, reason, gone });
    });
    req.on('error', (e) => { clearTimeout(guard); done({ ok: false, status: 0, reason: String(e?.message ?? e), gone: false }); });
    req.end(JSON.stringify(payload));
  });
}

/** The same env gate every other push hook consults, re-exported so a caller
 * needs one import to ask "is this armed" and "send this". */
export function liveActivityConfig(env = process.env) {
  return apnsConfig(env);
}
