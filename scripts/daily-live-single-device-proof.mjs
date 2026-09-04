// scripts/daily-live-single-device-proof.mjs — prove one real push reaches
// one real device, through the real APNs path, WITHOUT going through
// notifyEvent()'s full fan-out (which sends to every registered device -
// unacceptable for a one-device test). Uses apns.js's own primitives
// directly: apnsConfig, sendToToken, alertPayload.
//
// TARGETS EXACTLY ONE DEVICE, by account email, never a namespace or "the
// first N devices". Reads PROD (read-only for the lookup; the send itself
// is the one write this script makes, to Apple, not to our own DB - no
// sync_runs claim is written here, deliberately, since this bypasses
// notifyEvent's claim mechanism on purpose).
//
// Usage: set -a && . ./.env.local && set +a
//        node scripts/daily-live-single-device-proof.mjs <account-email>

import { neon } from '@neondatabase/serverless';
import { apnsConfig, sendToToken, alertPayload } from '../lib/push/apns.js';
import { copyFor } from '../lib/push/copy.js';

const email = process.argv[2];
if (!email) { console.error('usage: node scripts/daily-live-single-device-proof.mjs <account-email>'); process.exit(1); }
if (!process.env.PROD_DATABASE_URL) { console.error('PROD_DATABASE_URL missing'); process.exit(1); }

const sql = neon(process.env.PROD_DATABASE_URL);
console.log('DB target (PROD):', new URL(process.env.PROD_DATABASE_URL).host);

const u = await sql`SELECT id, email FROM users WHERE lower(email) = lower(${email})`;
if (!u.length) { console.error(`no user for ${email}`); process.exit(1); }
const userId = u[0].id;

const devices = await sql`
  SELECT token, platform, created_at FROM device_tokens
   WHERE user_id = ${userId} AND platform = 'ios' AND revoked_at IS NULL
   ORDER BY created_at DESC`;
if (devices.length !== 1) {
  console.error(`expected exactly 1 active iOS device for user_id=${userId}, found ${devices.length} - refusing to guess which one. HOLD.`);
  process.exit(1);
}
const token = devices[0].token;
console.log(`targeting user_id=${userId}, one device, token last6=${token.slice(-6)}, registered ${devices[0].created_at}`);

const cfg = apnsConfig();
if (!cfg.enabled) { console.error('APNs not enabled (PUSH_ENABLED / key / keyId / teamId incomplete) - HOLD.'); process.exit(1); }
console.log(`APNs config: host=${cfg.host} sandbox=${cfg.sandbox} topic=${cfg.topic}`);

const copy = copyFor('daily-live:proof-2026-09-04');
const payload = alertPayload(copy);
console.log('payload:', JSON.stringify(payload));

const result = await sendToToken(cfg, token, payload);
console.log('APNs result:', JSON.stringify(result));
