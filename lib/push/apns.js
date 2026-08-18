// lib/push/apns.js - the APNs HTTP/2 sender, JWT-signed from env.
//
// DIRECT APNS, NOT A PROVIDER. The Skry pushes through exp.host because Expo
// owns its binary; this is a Capacitor shell, so there is no relay to lean on
// and no reason to want one - APNs' provider API is one HTTP/2 POST per token.
//
// ENV, all four required before a single byte is sent:
//   APNS_KEY      the .p8 file's contents (BEGIN PRIVATE KEY block; \n-escaped
//                 is fine - normalizeKey below unescapes)
//   APNS_KEY_ID   the 10-char key id from the portal
//   APNS_TEAM_ID  87BX25MUHY
//   APNS_ENV      'production' | 'sandbox' (default sandbox - the safe wrong)
// Plus the arming flag PUSH_ENABLED=1: pushEnabled() is the single gate every
// hook consults, so the hooks ship dark and light up as a pure env change.
//
// FAIL-SOFT IS THE CONTRACT. Nothing in here throws to a caller on a delivery
// problem - a push is a courtesy, and the cron that fires it has real work
// that must not die because Apple had a moment.

import crypto from 'node:crypto';

/** The app this pushes to. The Draftvyn binary's bundle id, not the site's. */
export const APNS_TOPIC = 'com.sportsvyn.draftvyn';

const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

/** \n-escaped env values arrive with literal backslash-n; keys need newlines. */
export function normalizeKey(raw) {
  return String(raw ?? '').replace(/\\n/g, '\n').trim();
}

/** All four env facts, or the reason the sender is dark. */
export function apnsConfig(env = process.env) {
  const key = normalizeKey(env.APNS_KEY);
  const keyId = String(env.APNS_KEY_ID ?? '').trim();
  const teamId = String(env.APNS_TEAM_ID ?? '').trim();
  const host = HOSTS[env.APNS_ENV === 'production' ? 'production' : 'sandbox'];
  const armed = env.PUSH_ENABLED === '1' || env.PUSH_ENABLED === 'true';
  const enabled = armed && key.includes('PRIVATE KEY') && keyId.length > 0 && teamId.length > 0;
  return { enabled, key, keyId, teamId, host, sandbox: env.APNS_ENV !== 'production' };
}

export function pushEnabled(env = process.env) {
  return apnsConfig(env).enabled;
}

// ---------------------------------------------------------------------------
// THE PROVIDER TOKEN - ES256, cached for 50 minutes.
// ---------------------------------------------------------------------------
// Apple requires the token be BETWEEN 20 and 60 minutes old at most: refresh
// more often than hourly, but never per-request (they throttle token churn).
// 50 minutes sits inside both fences with margin for a long cron tick.
const TOKEN_TTL_MS = 50 * 60 * 1000;
let cached = null; // { jwt, at, keyId }

export function apnsJwt({ key, keyId, teamId }, nowMs = Date.now()) {
  if (cached && cached.keyId === keyId && nowMs - cached.at < TOKEN_TTL_MS) return cached.jwt;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'ES256', kid: keyId })}.${b64({ iss: teamId, iat: Math.floor(nowMs / 1000) })}`;
  const sig = crypto
    .sign('sha256', Buffer.from(unsigned), { key: crypto.createPrivateKey(key), dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  const jwt = `${unsigned}.${sig}`;
  cached = { jwt, at: nowMs, keyId };
  return jwt;
}

/** Test seam only. */
export function _clearJwtCache() { cached = null; }

// ---------------------------------------------------------------------------
// ONE POST PER TOKEN.
// ---------------------------------------------------------------------------
// fetch(), not node:http2 by hand: Node's fetch is HTTP/2-capable against
// APNs' ALPN and the request volume here (tens of devices) does not justify
// managing a connection pool. If the fleet grows to thousands, revisit with a
// pooled http2 session.
/**
 * @returns {{ok: boolean, status: number, reason: string|null, gone: boolean}}
 *   `gone` means APNs said this token is dead (410, or BadDeviceToken /
 *   Unregistered) - the caller should revoke it. Never throws.
 */
export async function sendToToken(cfg, token, payload) {
  try {
    const res = await fetch(`${cfg.host}/3/device/${token}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${apnsJwt(cfg)}`,
        'apns-topic': APNS_TOPIC,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 200) return { ok: true, status: 200, reason: null, gone: false };
    let reason = null;
    try { reason = (await res.json())?.reason ?? null; } catch { /* empty body */ }
    const gone = res.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered';
    return { ok: false, status: res.status, reason, gone };
  } catch (e) {
    return { ok: false, status: 0, reason: String(e?.message ?? e), gone: false };
  }
}

/** The aps envelope every notification here uses: alert + badge-free + url. */
export function alertPayload({ title, body, url }) {
  return { aps: { alert: { title, body }, sound: 'default' }, url };
}
