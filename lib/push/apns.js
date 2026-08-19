// lib/push/apns.js - the APNs HTTP/2 sender, JWT-signed from env.
//
// DIRECT APNS, NOT A PROVIDER. The Skry pushes through exp.host because Expo
// owns its binary; this is a Capacitor shell, so there is no relay to lean on
// and no reason to want one - APNs' provider API is one HTTP/2 POST per token.
//
// ENV, all four required before a single byte is sent:
//   APNS_KEY      the .p8 file's contents (BEGIN PRIVATE KEY block; \n-escaped
//                 is fine - normalizeKey below unescapes), OR
//   APNS_KEY_PATH a path to the .p8 on disk (the droplet's shape; see
//                 apnsConfig). APNS_KEY wins when both are set.
//   APNS_TOPIC    optional bundle-id override (defaults to the constant)
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
import http2 from 'node:http2';
import { readFileSync } from 'node:fs';

/** The app this pushes to. The Draftvyn binary's bundle id, not the site's.
 * Env-overridable (APNS_TOPIC) because the authoritative bundle id lives in
 * the Mac's Xcode project, not this repo - if they disagree, the env is the
 * fix, not a deploy. */
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
  // APNS_KEY (contents) wins; APNS_KEY_PATH is the droplet's shape - the .p8
  // sits OUTSIDE the repo tree and env holds only a path, so there is no
  // multiline secret to escape and nothing a stray `git add` could ever reach.
  // Vercel has no filesystem to point at, so it uses APNS_KEY.
  let key = normalizeKey(env.APNS_KEY);
  if (!key && env.APNS_KEY_PATH) {
    try { key = normalizeKey(readFileSync(env.APNS_KEY_PATH, 'utf8')); }
    catch { key = ''; } // missing file = not configured, same as no key
  }
  const keyId = String(env.APNS_KEY_ID ?? '').trim();
  const teamId = String(env.APNS_TEAM_ID ?? '').trim();
  const topic = String(env.APNS_TOPIC ?? '').trim() || APNS_TOPIC;
  // TRIMMED AND CASE-FOLDED, after the first armed night produced zero pushes.
  // A dashboard-pasted "1\n" or "True" failing an exact === is precisely the
  // kind of dark failure this module must not have: the gate reads as false,
  // every hook no-ops by design, and nothing anywhere says why. Same trim on
  // APNS_ENV - "production " with a trailing space would silently fall back
  // to the sandbox host and burn real sends on BadDeviceToken.
  const host = HOSTS[String(env.APNS_ENV ?? '').trim() === 'production' ? 'production' : 'sandbox'];
  const flag = String(env.PUSH_ENABLED ?? '').trim().toLowerCase();
  const armed = flag === '1' || flag === 'true' || flag === 'yes';
  const enabled = armed && key.includes('PRIVATE KEY') && keyId.length > 0 && teamId.length > 0;
  return { enabled, key, keyId, teamId, topic, host, sandbox: String(env.APNS_ENV ?? '').trim() !== 'production' };
}

export function pushEnabled(env = process.env) {
  return apnsConfig(env).enabled;
}

/**
 * WHICH FACT IS FAILING - the gate, itemized. Built the morning after the
 * gate read false on a runtime whose dashboard said every var was set, and
 * the ledger could only shrug. Booleans and lengths ONLY: this object goes
 * into sync_runs, and a summary row is forever.
 *
 * pemLines is the tell for the classic paste failure: a .p8 whose newlines
 * were flattened still contains 'PRIVATE KEY' (so `pem` alone passes) but
 * collapses to 1-3 lines instead of ~6-8.
 */
export function gateReport(env = process.env) {
  const cfg = apnsConfig(env);
  return {
    armed: cfg.enabled,
    PUSH_ENABLED: { present: env.PUSH_ENABLED != null, len: String(env.PUSH_ENABLED ?? '').length },
    APNS_KEY: {
      present: env.APNS_KEY != null,
      viaPath: env.APNS_KEY != null ? undefined : env.APNS_KEY_PATH != null,
      len: cfg.key.length,
      pem: cfg.key.includes('PRIVATE KEY'),
      pemLines: cfg.key ? cfg.key.split('\n').length : 0,
    },
    APNS_KEY_ID: { present: env.APNS_KEY_ID != null, len: cfg.keyId.length },
    APNS_TEAM_ID: { present: env.APNS_TEAM_ID != null, len: cfg.teamId.length },
    APNS_ENV: { present: env.APNS_ENV != null, production: !cfg.sandbox },
  };
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
// ONE POST PER TOKEN, OVER REAL HTTP/2.
// ---------------------------------------------------------------------------
// node:http2, NOT fetch - and that is a correction, not a preference. Node's
// fetch (undici) speaks HTTP/1.1 unless a session opts into experimental h2,
// and APNs' provider API REFUSES HTTP/1.1 outright; the first draft of this
// file would have failed its first real send. A fresh session per call is
// deliberate at this fleet size (tens of devices): APNs allows long-lived
// sessions and at thousands of tokens a pooled session is the upgrade, but a
// pool held open from a 15-minute cron is idle-timeout management for no
// measurable win today.
/**
 * @returns {{ok: boolean, status: number, reason: string|null, gone: boolean}}
 *   `gone` means APNs said this token is dead (410, or BadDeviceToken /
 *   Unregistered) - the caller should revoke it. Never throws.
 */
export function sendToToken(cfg, token, payload) {
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
    // A hung connection must resolve, not dangle - the cron above this has a
    // maxDuration and one dead device must not eat it.
    const guard = setTimeout(() => done({ ok: false, status: 0, reason: 'timeout', gone: false }), 10_000);

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${apnsJwt(cfg)}`,
      'apns-topic': cfg.topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
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

/** The aps envelope every notification here uses: alert + badge-free + url. */
export function alertPayload({ title, body, url }) {
  return { aps: { alert: { title, body }, sound: 'default' }, url };
}
