// lib/push/renderCopyAlert.test.mjs - NO BRACE EVER LEAVES renderCopy()
// (relay 1b item 2). A recipient with a deliberately missing param must
// produce zero sends for that recipient and exactly one alert row - never a
// push carrying a literal "{pts}" onto a lock screen.
//
// resend.emails.send IS STUBBED for the duration of this file. maybeAlert()
// sends a REAL email to Derik's inbox on an uncaught path - lib/pollers/
// alerts.js's own header names the incident this guards against (~20 real
// sends from an unstubbed test, before anyone noticed). The stub is restored
// after every test.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));

const { sql } = await import('../db.js');
const { notifyPersonalized } = await import('./notify.js');
const { resend } = await import('../resend.js');

// SENTINEL DATA ONLY: a user id and event id that can never be real. The
// event id carries this run's own timestamp so a leftover row from a prior
// run (or unrelated push activity) can never be mistaken for this test's own.
const SENTINEL_USER_ID = -999001;
const EVENT_ID = `draft-settled:sentinel-${Date.now()}`;

const realSend = resend.emails.send.bind(resend.emails);
resend.emails.send = async () => ({ data: { id: 'stubbed' } });
after(() => { resend.emails.send = realSend; });

// apnsConfig() reads process.env fresh on every call (notify.js never caches
// it) - fake-but-well-formed facts only for the span of this test, so the
// gate reads armed without depending on this host's real APNs secrets.
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const FAKE_PUSH_ENV = { PUSH_ENABLED: '1', APNS_KEY: PEM, APNS_KEY_ID: 'ABC123DEF4', APNS_TEAM_ID: '87BX25MUHY' };

const claimedRowIds = [];
const alertRowIds = [];
after(async () => {
  if (claimedRowIds.length) await sql`DELETE FROM sync_runs WHERE id = ANY(${claimedRowIds})`;
  if (alertRowIds.length) await sql`DELETE FROM sync_runs WHERE id = ANY(${alertRowIds})`;
});

test('a recipient missing a required param is skipped, sent nothing, and raises exactly one alert', async () => {
  const savedEnv = {};
  for (const k of Object.keys(FAKE_PUSH_ENV)) savedEnv[k] = process.env[k];
  Object.assign(process.env, FAKE_PUSH_ENV);
  try {
    // maybeAlert() rate-limits by SOURCE ALONE within a 6h window (lib/
    // pollers/alerts.js) - one leftover 'push' alert row from an unrelated
    // failure (or an earlier run of this very test) would make THIS run's
    // alert a silent 'rate_limited' no-op with no new row, which is a real
    // fact about that window and not a defect in the code under test here.
    // Clearing it is scoped to (source='push', kind='alert', this window)
    // only - on the DEV database, where these rows are only ever test
    // debris, never a real production signal PUSH_ENABLED never runs live.
    await sql`DELETE FROM sync_runs WHERE source = 'push' AND kind = 'alert' AND started_at > now() - interval '6 hours'`;

    // draft-settled needs {week}, {pts}, {rank}, {field} - pts is left out.
    const result = await notifyPersonalized(EVENT_ID, [
      { userId: SENTINEL_USER_ID, params: { week: 1, rank: 1, field: 1 } },
    ]);

    assert.equal(result.sent, 0, 'the missing-param recipient must never be sent to');
    assert.equal(result.skipped, 1, 'renderCopy throwing must count as skipped, not silently dropped');

    const claim = await sql`SELECT id FROM sync_runs WHERE source = 'push' AND summary->>'eventId' = ${EVENT_ID}`;
    claimedRowIds.push(...claim.map((r) => r.id));
    assert.equal(claim.length, 1, 'the send-once claim itself is still written exactly once');

    const alerts = await sql`
      SELECT id, summary FROM sync_runs
       WHERE source = 'push' AND kind = 'alert' AND summary->>'subject' LIKE ${`%${EVENT_ID}%`}`;
    alertRowIds.push(...alerts.map((r) => r.id));
    assert.equal(alerts.length, 1, 'exactly one alert row for this event, naming it');
    assert.match(alerts[0].summary.subject, new RegExp(EVENT_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
