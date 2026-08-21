// lib/push/push.test.mjs - the push server half: config gating, the JWT, the
// copy contract, and the wiring that makes the hooks safe on a 15-minute tick.
//
// notify.js is NOT imported - it drags lib/db.js in and opens a connection.
// Its claim-before-send ordering is asserted as source, the same way the
// broadcast suite pins its guards: the ordering IS the design ("ledger-
// inversion"), and a refactor that flips it back to send-then-record
// reintroduces the replay bug this exists to prevent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  apnsConfig, pushEnabled, apnsJwt, _clearJwtCache, normalizeKey,
  alertPayload, APNS_TOPIC, gateReport,
} from './apns.js';
import { PUSH_COPY, copyFor } from './copy.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// A real EC P-256 key, generated per run - the JWT test signs with it.
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const FULL_ENV = {
  PUSH_ENABLED: '1', APNS_KEY: PEM, APNS_KEY_ID: 'ABC123DEF4', APNS_TEAM_ID: '87BX25MUHY',
};

// ---------------------------------------------------------------------------
// gating - dark until every fact is present
// ---------------------------------------------------------------------------

test('fully configured and armed -> enabled', () => {
  assert.equal(pushEnabled(FULL_ENV), true);
});

test('any missing fact keeps the sender dark', () => {
  for (const drop of ['PUSH_ENABLED', 'APNS_KEY', 'APNS_KEY_ID', 'APNS_TEAM_ID']) {
    const env = { ...FULL_ENV };
    delete env[drop];
    assert.equal(pushEnabled(env), false, `${drop} missing should disable`);
  }
});

test('the flag alone is not enough - arming without a key stays dark', () => {
  assert.equal(pushEnabled({ PUSH_ENABLED: '1' }), false);
});

test('dashboard-pasted flag values arm: whitespace and case are forgiven', () => {
  // The first armed night produced zero pushes; an exact === on the flag is
  // the kind of dark failure this gate must not have.
  for (const v of ['1', '1\n', ' 1 ', 'true', 'True', 'TRUE', 'yes']) {
    assert.equal(pushEnabled({ ...FULL_ENV, PUSH_ENABLED: v }), true, JSON.stringify(v));
  }
  for (const v of ['0', 'false', '', ' ', 'no', undefined]) {
    assert.equal(pushEnabled({ ...FULL_ENV, PUSH_ENABLED: v }), false, JSON.stringify(v));
  }
});

test('APNS_ENV is trimmed - "production " must not fall back to sandbox', () => {
  assert.doesNotMatch(apnsConfig({ ...FULL_ENV, APNS_ENV: 'production\n' }).host, /sandbox/);
  assert.equal(apnsConfig({ ...FULL_ENV, APNS_ENV: ' production ' }).sandbox, false);
});

test('the close cron records the gate state in its ledger rows', () => {
  const t = stripComments(src('app/api/cron/daily-close/route.js'));
  assert.match(t, /pushArmed: armed/, 'noop rows must carry the gate');
  assert.match(t, /return \{ closed, pushArmed \}/, 'close rows must carry the gate');
});

test('sandbox is the default; production is opt-in', () => {
  assert.match(apnsConfig(FULL_ENV).host, /sandbox/);
  assert.doesNotMatch(apnsConfig({ ...FULL_ENV, APNS_ENV: 'production' }).host, /sandbox/);
});

test('an escaped key from env is normalized back to a real PEM', () => {
  const escaped = PEM.replace(/\n/g, '\\n');
  assert.equal(normalizeKey(escaped), PEM.trim());
  assert.equal(pushEnabled({ ...FULL_ENV, APNS_KEY: escaped }), true);
});

// ---------------------------------------------------------------------------
// the provider JWT
// ---------------------------------------------------------------------------

test('the JWT carries ES256, the key id and the team id, and verifies', () => {
  _clearJwtCache();
  const cfg = apnsConfig(FULL_ENV);
  const jwt = apnsJwt(cfg, 1_700_000_000_000);
  const [h, p, sig] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  assert.deepEqual(header, { alg: 'ES256', kid: 'ABC123DEF4' });
  assert.equal(payload.iss, '87BX25MUHY');
  assert.equal(payload.iat, 1_700_000_000);
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${p}`),
    { key: privateKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  assert.equal(ok, true, 'signature must verify against the key');
});

test('the JWT is cached inside 50 minutes and reminted after', () => {
  _clearJwtCache();
  const cfg = apnsConfig(FULL_ENV);
  const t0 = 1_700_000_000_000;
  const a = apnsJwt(cfg, t0);
  assert.equal(apnsJwt(cfg, t0 + 49 * 60_000), a, 'inside the TTL: same token');
  assert.notEqual(apnsJwt(cfg, t0 + 51 * 60_000), a, 'past the TTL: fresh token');
  _clearJwtCache();
});

test('the topic is the Draftvyn bundle, not the site container', () => {
  assert.equal(APNS_TOPIC, 'com.sportsvyn.draftvyn');
  assert.equal(apnsConfig(FULL_ENV).topic, 'com.sportsvyn.draftvyn');
  // Env-overridable, because the authoritative bundle id lives in the Mac's
  // Xcode project - a mismatch is fixed in env, not in a deploy.
  assert.equal(apnsConfig({ ...FULL_ENV, APNS_TOPIC: 'com.other.app' }).topic, 'com.other.app');
});

test('APNS_KEY_PATH reads the key from disk; APNS_KEY wins when both set', async () => {
  const { writeFileSync, rmSync } = await import('node:fs');
  const p = path.join(REPO, '.tmp-test-key.p8');
  writeFileSync(p, PEM);
  try {
    const env = { PUSH_ENABLED: '1', APNS_KEY_PATH: p, APNS_KEY_ID: 'X', APNS_TEAM_ID: 'Y' };
    assert.equal(pushEnabled(env), true, 'path alone should enable');
    assert.equal(apnsConfig({ ...env, APNS_KEY: PEM }).key, PEM.trim());
    // A missing file is "not configured", never a throw - the gate is the
    // failure surface, not an exception in a cron.
    assert.equal(pushEnabled({ ...env, APNS_KEY_PATH: p + '.gone' }), false);
  } finally { rmSync(p, { force: true }); }
});

// ---------------------------------------------------------------------------
// the copy - short, hyphens only, every event covered
// ---------------------------------------------------------------------------

test('every payload fits the tightest lock-screen cut', () => {
  for (const [k, c] of Object.entries(PUSH_COPY)) {
    assert.ok(c.title.length <= 30, `${k} title too long (${c.title.length})`);
    assert.ok(c.body.length <= 110, `${k} body too long (${c.body.length})`);
    assert.ok(c.url.startsWith('/'), `${k} url must be an in-app path`);
  }
});

test('hyphens only - the house rule applies to a lock screen too', () => {
  for (const [k, c] of Object.entries(PUSH_COPY)) {
    assert.doesNotMatch(c.title + c.body, /[‐-―−]/, `${k} carries a non-hyphen dash`);
  }
});

test('copyFor keys on the prefix and refuses the unknown', () => {
  assert.equal(copyFor('daily-live:2026-08-19'), PUSH_COPY['daily-live']);
  assert.equal(copyFor('daily-revealed:2026-08-19'), PUSH_COPY['daily-revealed']);
  assert.equal(copyFor('pickem-open:1'), PUSH_COPY['pickem-open']);
  assert.equal(copyFor('pickem-reminder:5'), PUSH_COPY['pickem-reminder']);
  assert.equal(copyFor('pickem-settled:5'), PUSH_COPY['pickem-settled']);
  assert.equal(copyFor('mystery:1'), null);
  assert.equal(copyFor(null), null);
});

test("the three Pick 'em pushes land on the board, and their callers exist", () => {
  // Relay 1's recon named the gap: 'THE CALLER DOES NOT EXIST YET'. It does
  // now, in all three places, each behind the pushEnabled gate and caught so
  // push can never fail the cron that carries it.
  for (const k of ['pickem-open', 'pickem-reminder', 'pickem-settled']) {
    assert.equal(PUSH_COPY[k].url, '/pickem', `${k} taps land on the board`);
  }
  const board = src('app/api/cron/pickem-board/route.js');
  assert.match(board, /await notifyPickemOpen\(res\.summary\.id\)\.catch/,
    'creation announces, once, on the fire that created');
  const settle = src('app/api/cron/pickem-settle/route.js');
  assert.match(settle, /await notifyPickemSettled\(settled\)\.catch/,
    'results ride the fire that graded');
  const close = src('app/api/cron/daily-close/route.js');
  assert.match(close, /await notifyPickemReminder\(\)\.catch/,
    'the reminder rides the house 15-minute tick');
  // The reminder derives its window from state - future-bounded both ways,
  // so a board found late is skipped, never announced at noon.
  const notify = stripComments(src('lib/push/notify.js'));
  assert.match(notify, /locks_at > now\(\) AND locks_at <= now\(\) \+ interval '2 hours'/);
  assert.match(notify, /pickem-reminder:\$\{r\.id\}/, 'send-once keys on the board id');
});

test('the alert payload is aps-shaped with the url beside it', () => {
  const p = alertPayload({ title: 'T', body: 'B', url: '/daily' });
  assert.deepEqual(p, { aps: { alert: { title: 'T', body: 'B' }, sound: 'default' }, url: '/daily' });
});

// ---------------------------------------------------------------------------
// notify.js - the claim precedes the send ("ledger-inversion"), as source
// ---------------------------------------------------------------------------

test('the ledger claim is written before any token is read or sent', () => {
  const t = stripComments(src('lib/push/notify.js'));
  const body = t.slice(t.indexOf('export async function notifyEvent'));
  const claim = body.indexOf('INSERT INTO sync_runs');
  const fanout = body.indexOf('FROM device_tokens');
  const send = body.indexOf('sendToToken(');
  assert.ok(claim > -1 && fanout > -1 && send > -1);
  assert.ok(claim < fanout && claim < send,
    'the claim must precede the fan-out - send-then-record replays on crash');
});

test('a lost claim skips the send entirely', () => {
  const t = stripComments(src('lib/push/notify.js'));
  const body = t.slice(t.indexOf('export async function notifyEvent'));
  const lost = body.indexOf('claimed.length === 0');
  const send = body.indexOf('sendToToken(');
  assert.ok(lost > -1 && lost < send, 'no early return between claim and send');
});

test('a dead token is revoked, not deleted', () => {
  const t = stripComments(src('lib/push/notify.js'));
  assert.match(t, /UPDATE device_tokens SET revoked_at = now\(\)/);
  assert.doesNotMatch(t, /DELETE FROM device_tokens/);
});

// ---------------------------------------------------------------------------
// the hooks - wired, gated, and derived from state
// ---------------------------------------------------------------------------

test('daily-close carries both hooks behind the single gate', () => {
  const t = stripComments(src('app/api/cron/daily-close/route.js'));
  assert.match(t, /pushEnabled\(\)/);
  assert.match(t, /notifyDailyLive\(\)/);
  assert.match(t, /notifyDailyRevealed\(/);
  // The live sweep must run BEFORE the noop early-return: a board going live
  // is precisely a tick where nothing is due to close.
  const live = t.indexOf('notifyDailyLive()');
  const noop = t.indexOf("decision: 'noop'");
  assert.ok(live > -1 && noop > -1 && live < noop, 'live sweep is unreachable on quiet ticks');
});

test('revealed fires only for fresh closes, never reruns', () => {
  const t = stripComments(src('app/api/cron/daily-close/route.js'));
  assert.match(t, /c\?\.revealed === true/);
});

test('the live sweep bounds its lookback', () => {
  const t = stripComments(src('lib/push/notify.js'));
  assert.match(t, /opens_at > now\(\) - interval '2 hours'/,
    'an unbounded sweep would announce stale boards after an outage');
});

test("pick 'em's hook exists and keys on the board id", () => {
  const t = stripComments(src('lib/push/notify.js'));
  assert.match(t, /export async function notifyPickemOpen/);
  assert.match(t, /pickem-open:\$\{boardId\}/);
});

// ---------------------------------------------------------------------------
// the endpoints and the pre-warm surfaces - contract points, as source
// ---------------------------------------------------------------------------

test('register revives in place - upsert clears revoked_at', () => {
  const t = stripComments(src('app/api/push/register/route.js'));
  assert.match(t, /ON CONFLICT \(token\) DO UPDATE/);
  assert.match(t, /revoked_at = NULL/);
});

test('both endpoints refuse the unauthenticated', () => {
  for (const rel of ['app/api/push/register/route.js', 'app/api/push/unregister/route.js']) {
    assert.match(stripComments(src(rel)), /status: 401/, rel);
  }
});

test('the OS prompt only ever follows an explicit yes', () => {
  const client = stripComments(src('lib/push/client.js'));
  // requestPermissions lives in enablePush (the explicit-yes path) only;
  // the silent launch path checks, never requests.
  const silent = client.slice(client.indexOf('export async function reRegisterIfGranted'));
  assert.match(silent, /checkPermissions/);
  assert.doesNotMatch(silent, /requestPermissions/);
});

test('a denied OS prompt is recorded as denied, never as enabled', () => {
  for (const rel of [
    'components/onboarding/OnboardingSheet.js',
    'components/push/AnswerNudge.js',
  ]) {
    const t = stripComments(src(rel));
    assert.match(t, /got === 'denied' \? 'denied'/, `${rel} must map denied to denied`);
  }
});

// ---------------------------------------------------------------------------
// gateReport - names the failing fact, leaks no value
// ---------------------------------------------------------------------------

test('a fully armed gate reports armed with every fact green', () => {
  const g = gateReport(FULL_ENV);
  assert.equal(g.armed, true);
  assert.equal(g.APNS_KEY.pem, true);
  assert.ok(g.APNS_KEY.pemLines >= 3, 'a real PEM is multi-line');
});

test('each missing fact is named, not inferred', () => {
  for (const drop of ['PUSH_ENABLED', 'APNS_KEY', 'APNS_KEY_ID', 'APNS_TEAM_ID']) {
    const env = { ...FULL_ENV };
    delete env[drop];
    const g = gateReport(env);
    assert.equal(g.armed, false, drop);
    assert.equal(g[drop].present, false, `${drop} must read absent`);
  }
});

test('the flattened-paste failure is visible: pem true, pemLines tiny', () => {
  const flat = PEM.replace(/\n/g, ' ');
  const g = gateReport({ ...FULL_ENV, APNS_KEY: flat });
  assert.equal(g.APNS_KEY.pem, true, 'the substring is still there');
  assert.ok(g.APNS_KEY.pemLines <= 2, 'and the line count is the tell');
});

test('NO VALUE EVER LEAKS - the serialized report contains no env content', () => {
  const out = JSON.stringify(gateReport(FULL_ENV));
  assert.ok(!out.includes('PRIVATE KEY'), 'key material in the ledger');
  assert.ok(!out.includes(FULL_ENV.APNS_KEY_ID), 'key id in the ledger');
  assert.ok(!out.includes(FULL_ENV.APNS_TEAM_ID), 'team id in the ledger');
});

test('the noop row carries the gate detail only while dark', () => {
  const t = stripComments(src('app/api/cron/daily-close/route.js'));
  assert.match(t, /armed \? \{\} : \{ gate: gateReport\(\) \}/);
});

// ---------------------------------------------------------------------------
// the Vercel-runtime test endpoint - two locks, owner-only, ledgered
// ---------------------------------------------------------------------------

test('push-test refuses without the cron bearer and without an owner target', () => {
  const t = stripComments(src('app/api/cron/push-test/route.js'));
  const auth = t.indexOf('cronAuthorized(request)');
  const owner = t.indexOf('OWNER_EMAILS.includes');
  const send = t.indexOf('sendToToken(');
  assert.ok(auth > -1 && auth < send, 'bearer check must precede the send');
  assert.ok(owner > -1 && owner < send, 'owner check must precede the send');
  assert.match(t, /status: 403/, 'a non-owner target is refused, not ignored');
});

test('push-test is ledgered as a vercel test, claim before send', () => {
  const t = stripComments(src('app/api/cron/push-test/route.js'));
  assert.match(t, /runtime: 'vercel'/);
  const claim = t.indexOf('INSERT INTO sync_runs');
  const send = t.indexOf('sendToToken(');
  assert.ok(claim > -1 && claim < send, 'same claim-first order as notifyEvent');
});

// ---------------------------------------------------------------------------
// the enable flow after the false-enabled defect - check, request, VERIFY
// ---------------------------------------------------------------------------

test('enable is check -> request -> RE-READ, and only the re-read is believed', () => {
  const t = stripComments(src('lib/push/client.js'));
  const body = t.slice(t.indexOf('export async function enablePush'), t.indexOf('export async function reRegisterIfGranted'));
  const check1 = body.indexOf('checkPermissions');
  const req = body.indexOf('requestPermissions');
  const check2 = body.indexOf('checkPermissions', req);
  assert.ok(check1 > -1 && check1 < req, 'must read state before prompting');
  assert.ok(check2 > req, 'must re-read after the prompt - the request result lied once');
});

test('no token is registered before a verified grant', () => {
  const t = stripComments(src('lib/push/client.js'));
  const body = t.slice(t.indexOf('export async function enablePush'), t.indexOf('export async function reRegisterIfGranted'));
  const gate = body.indexOf("if (perm !== 'granted') return 'denied'");
  const reg = body.indexOf('plugin.register()');
  assert.ok(gate > -1 && gate < reg,
    'registering an unauthorized token is the Aug 19 defect - APNs mints them happily');
});

test('the verified permission rides every register call, both paths', () => {
  const t = stripComments(src('lib/push/client.js'));
  const posts = [...t.matchAll(/JSON\.stringify\(\{ token, platform: 'ios', permission/g)];
  assert.equal(posts.length, 2, 'enablePush AND reRegisterIfGranted must both carry it');
});

test('the endpoint stores permission, constrained to plugin-real states', () => {
  const t = stripComments(src('app/api/push/register/route.js'));
  assert.match(t, /'granted', 'denied', 'prompt', 'prompt-with-rationale'/);
  assert.match(t, /permission = EXCLUDED\.permission/, 'the upsert must refresh it - convergence is the audit');
});

// ---------------------------------------------------------------------------
// the notifications row is a TOGGLE driven by device truth
// ---------------------------------------------------------------------------

test('the row renders from checkPermissions, not the server column', () => {
  const t = stripComments(src('components/push/NotificationsRow.js'));
  assert.match(t, /devicePermission\(\)/, 'must ask the OS on mount');
  assert.match(t, /perm === 'granted' && serverChoice === 'enabled'/,
    'ON requires BOTH the fact and the preference');
  assert.match(t, /needs re-enable/, 'the stale-enabled disagreement is named, not hidden');
});

test('the row is interactive in both states - off revokes, on runs the verified flow', () => {
  const t = stripComments(src('components/push/NotificationsRow.js'));
  assert.match(t, /disablePush\(\)/);
  assert.match(t, /savePushChoice\('disabled'\)/);
  assert.match(t, /enablePush\(\)/);
});

test('the control is a SWITCH whose position is the state - no action verbs', () => {
  const t = stripComments(src('components/push/NotificationsRow.js'));
  assert.match(t, /role="switch"/);
  assert.match(t, /aria-checked=\{on\}/);
  assert.ok(!/Turn on|Turn off/.test(t), 'verbs are the old text-toggle - the switch IS the action');
  // Pending must dim WITHOUT flipping: busy is a class, never a state flip.
  assert.match(t, /\$\{busy \? ' busy' : ''\}/);
  assert.ok(!/busy \? ' on'/.test(t), 'the switch lands ON only when the grant verifies');
});

test("'disabled' is a recordable choice, distinct from not-now", () => {
  const t = stripComments(src('app/actions/onboarding.js'));
  assert.match(t, /'enabled', 'not-now', 'denied', 'disabled'/);
});
