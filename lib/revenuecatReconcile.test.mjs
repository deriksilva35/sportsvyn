// lib/revenuecatReconcile.test.mjs — the reconcile decision layer.
//
// This code REVOKES paid access, so the tests are weighted toward the ways it
// could wrongly do that. The two rules that carry the risk:
//
//   1. A FAILED LOOKUP IS NEVER "NOT ENTITLED". If a RevenueCat outage read as
//      "nobody owns anything", one reconcile pass would revoke every Apple
//      customer at once. Every failure mode below must produce ok:false and zero
//      writes.
//   2. STRIPE ROWS ARE UNTOUCHABLE. Revoke is scoped to source='apple'; a web
//      buyer keeps their grant whatever RevenueCat says about their Apple id.
//
// Pure + network-stubbed: no DB, no live key. The DB write (applyReconcile) is
// exercised in membership.test.mjs against DEV.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  parseSubscriberEntitlement, reconcilePlan, fetchSubscriber,
  RC_API_BASE, RECONCILE_TYPES, REVENUECAT_SECRET_KEY_ENV, REVENUECAT_ENTITLEMENT_ENV,
  DEFAULT_PASS_PRODUCT_ID,
} from './revenuecat.js';

const PROD = DEFAULT_PASS_PRODUCT_ID;
const WINDOW = '2027-02-16T04:59:00.000Z';   // DRAFT_PASS_EXPIRES_AT
const NOW = new Date('2026-08-03T20:00:00Z');

const subscriber = (over = {}) => ({
  subscriber: { entitlements: {}, non_subscriptions: {}, subscriptions: {}, ...over },
});
const parse = (body, o = {}) =>
  parseSubscriberEntitlement(body, { productId: PROD, fallbackExpiry: WINDOW, now: NOW, ...o });

// ---------------------------------------------------------------------------
// Reading the subscriber
// ---------------------------------------------------------------------------

test('a lifetime non-consumable entitlement is entitled, clamped to the product window', () => {
  // RevenueCat reports expires_date null for a non-consumable ("forever"). Our
  // product is sold as access through the Super Bowl, so the row must carry the
  // same expiry a Stripe pass would - not infinity.
  const r = parse(subscriber({ entitlements: { pass: { expires_date: null, product_identifier: PROD } } }));
  assert.equal(r.entitled, true);
  assert.equal(r.expiresAt, WINDOW);
});

test('a dated entitlement in the future is entitled and keeps RevenueCat expiry', () => {
  const r = parse(subscriber({ entitlements: { pass: { expires_date: '2027-01-01T00:00:00Z', product_identifier: PROD } } }));
  assert.equal(r.entitled, true);
  assert.equal(r.expiresAt, '2027-01-01T00:00:00.000Z');
});

test('an expired entitlement is NOT entitled', () => {
  const r = parse(subscriber({ entitlements: { pass: { expires_date: '2026-01-01T00:00:00Z', product_identifier: PROD } } }));
  assert.equal(r.entitled, false);
});

test('an entitlement for a DIFFERENT product does not count', () => {
  const r = parse(subscriber({ entitlements: { other: { expires_date: null, product_identifier: 'com.someone.else' } } }));
  assert.equal(r.entitled, false);
});

test('ENTITLEMENTS are the authority - a stale non_subscriptions entry does NOT entitle', () => {
  // This is the whole revoke direction. After a transfer the receipt moves; if a
  // leftover non_subscriptions record on the losing account counted as ownership,
  // the old account would keep access forever and one purchase would grant
  // unlimited memberships.
  const r = parse(subscriber({
    entitlements: {},
    non_subscriptions: { [PROD]: [{ id: 'x', purchase_date: '2026-08-02T21:25:00Z', store: 'app_store' }] },
  }));
  assert.equal(r.entitled, false);
  assert.match(r.evidence, /non_subscriptions\[.*\]=1/, 'the evidence should still record what was seen');
});

test('an explicit entitlement id, when configured, is matched by NAME', () => {
  const body = subscriber({ entitlements: { sim: { expires_date: null, product_identifier: 'anything' } } });
  assert.equal(parse(body, { entitlementId: 'sim' }).entitled, true);
  assert.equal(parse(body, { entitlementId: 'nope' }).entitled, false);
});

test('junk bodies are not entitled and do not throw', () => {
  for (const b of [null, undefined, {}, { subscriber: null }, { subscriber: 'x' }, { subscriber: { entitlements: 'x' } }]) {
    const r = parse(b);
    assert.equal(r.entitled, false, `entitled on ${JSON.stringify(b)}`);
    assert.equal(typeof r.evidence, 'string');
  }
});

// ---------------------------------------------------------------------------
// The plan — both directions
// ---------------------------------------------------------------------------

const ent = { entitled: true, expiresAt: WINDOW };
const notEnt = { entitled: false, expiresAt: null };
const row = (source, over = {}) => ({ user_id: 9, kind: 'pass', tier: 'pass', status: 'active', source, expires_at: WINDOW, ...over });

test('entitled + no row -> grant', () => {
  const p = reconcilePlan({ rc: ent, row: null });
  assert.equal(p.action, 'grant');
  assert.equal(p.expiresAt, WINDOW);
});

test('entitled + existing row -> update', () => {
  assert.equal(reconcilePlan({ rc: ent, row: row('apple') }).action, 'update');
  assert.equal(reconcilePlan({ rc: ent, row: row('stripe') }).action, 'update');
});

test('NOT entitled + apple row -> REVOKE (the receipt transferred away)', () => {
  const p = reconcilePlan({ rc: notEnt, row: row('apple') });
  assert.equal(p.action, 'revoke');
  assert.match(p.reason, /apple-sourced/);
});

test('NOT entitled + STRIPE row -> none. A web buyer is never revoked.', () => {
  const p = reconcilePlan({ rc: notEnt, row: row('stripe') });
  assert.equal(p.action, 'none');
  assert.match(p.reason, /stripe-sourced - left alone/);
});

test('NOT entitled + no row -> none', () => {
  assert.equal(reconcilePlan({ rc: notEnt, row: null }).action, 'none');
});

test('the revoke can only ever be planned for an apple row', () => {
  // Exhaustive over the sources the column allows plus the legacy null.
  for (const s of ['stripe', null, undefined]) {
    assert.notEqual(reconcilePlan({ rc: notEnt, row: row(s) }).action, 'revoke', `revoked a ${s} row`);
  }
  assert.equal(reconcilePlan({ rc: notEnt, row: row('apple') }).action, 'revoke');
});

// ---------------------------------------------------------------------------
// fetchSubscriber — the failure rules
// ---------------------------------------------------------------------------

const okRes = (body, status = 200) => ({ status, json: async () => body, text: async () => JSON.stringify(body) });

test('the request goes to the documented endpoint with a Bearer key', async () => {
  let seen = null;
  await fetchSubscriber(5, { key: 'sk_test', fetchImpl: async (url, init) => { seen = { url, init }; return okRes(subscriber()); } });
  assert.equal(seen.url, `${RC_API_BASE}/subscribers/5`);
  assert.equal(seen.init.headers.Authorization, 'Bearer sk_test');
});

test('404 is a SUCCESS meaning "owns nothing", not an error', async () => {
  // RevenueCat not knowing an app user id is a definite answer, and treating it
  // as an error would block the grant path for every first-time buyer.
  const r = await fetchSubscriber(5, { key: 'sk', fetchImpl: async () => ({ status: 404, text: async () => 'not found' }) });
  assert.equal(r.ok, true);
  assert.equal(r.status, 404);
  assert.equal(parse(r.body).entitled, false);
});

test('EVERY failure mode returns ok:false so the caller writes nothing', async () => {
  const cases = {
    '500': async () => ({ status: 500, text: async () => 'boom' }),
    '401': async () => ({ status: 401, text: async () => 'bad key' }),
    '429': async () => ({ status: 429, text: async () => 'slow down' }),
    'network throw': async () => { throw new Error('ECONNRESET'); },
    'unparseable json': async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }),
  };
  for (const [label, fetchImpl] of Object.entries(cases)) {
    const r = await fetchSubscriber(5, { key: 'sk', fetchImpl });
    assert.equal(r.ok, false, `${label} was treated as success`);
    assert.equal(typeof r.error, 'string');
  }
});

test('a missing secret key is an ERROR, never an empty entitlement', async () => {
  // The dangerous misconfiguration: deploy without the key, reconcile reads
  // "nobody owns anything", and every Apple row gets revoked.
  const r = await fetchSubscriber(5, { key: undefined, fetchImpl: async () => okRes(subscriber()) });
  assert.equal(r.ok, false);
  assert.match(r.error, /REVENUECAT_SECRET_KEY/);
});

test('a timeout aborts and reports, rather than hanging or resolving empty', async () => {
  const r = await fetchSubscriber(5, {
    key: 'sk', timeoutMs: 20,
    fetchImpl: (url, init) => new Promise((_, rej) => {
      init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /timeout/);
});

test('an empty app user id is refused before any request is made', async () => {
  let called = false;
  const r = await fetchSubscriber('  ', { key: 'sk', fetchImpl: async () => { called = true; return okRes(subscriber()); } });
  assert.equal(r.ok, false);
  assert.equal(called, false, 'it hit the network with no user id');
});

// ---------------------------------------------------------------------------
// Ledger typing
// ---------------------------------------------------------------------------

test('reconcile ledger types are distinct from every RevenueCat event type', async () => {
  const { GRANT_EVENT_TYPES, REVOKE_EVENT_TYPES } = await import('./revenuecat.js');
  const rcTypes = new Set([...GRANT_EVENT_TYPES, ...REVOKE_EVENT_TYPES, 'TRANSFER', 'SUBSCRIBER_ALIAS', 'TEST']);
  for (const t of Object.values(RECONCILE_TYPES)) {
    assert.ok(!rcTypes.has(t), `${t} collides with a RevenueCat event type`);
    assert.match(t, /^RECONCILE_/);
  }
  assert.deepEqual(Object.keys(RECONCILE_TYPES).sort(), ['grant', 'revoke', 'update']);
});

test('the env var names are the ones documented to Vercel', () => {
  assert.equal(REVENUECAT_SECRET_KEY_ENV, 'REVENUECAT_SECRET_KEY');
  assert.equal(REVENUECAT_ENTITLEMENT_ENV, 'REVENUECAT_SIM_ENTITLEMENT');
  assert.ok(!REVENUECAT_SECRET_KEY_ENV.startsWith('NEXT_PUBLIC_'), 'the secret key must never be public');
});

// ---------------------------------------------------------------------------
// TRANSFER — the event that stranded the device
// ---------------------------------------------------------------------------

test('transferPartyIds reads BOTH sides of a transfer', async () => {
  const { transferPartyIds } = await import('./revenuecat.js');
  // The real 08-03 delivery carried no app_user_id and no product_id; the parties
  // live in these arrays, which is why normalizeEvent could never attribute it.
  assert.deepEqual(transferPartyIds({ event: { transferred_from: ['3'], transferred_to: ['5'] } }), [3, 5]);
  assert.deepEqual(transferPartyIds({ event: { transferred_to: ['5'] } }), [5]);
});

test('transferPartyIds drops what it cannot attribute, and de-duplicates', async () => {
  const { transferPartyIds } = await import('./revenuecat.js');
  assert.deepEqual(transferPartyIds({ event: { transferred_from: ['$RCAnonymousID:zz'], transferred_to: ['5', '5'] } }), [5]);
  assert.deepEqual(transferPartyIds({ event: { transferred_from: ['abc', '', null], transferred_to: [] } }), []);
  // Junk bodies must not throw - this runs before normalizeEvent in the route.
  for (const b of [null, undefined, {}, { event: {} }, { event: { transferred_from: 'nope' } }]) {
    assert.deepEqual(transferPartyIds(b), []);
  }
});

test('TRANSFER is not in the grant or revoke sets - it is reconciled, not guessed', async () => {
  const { GRANT_EVENT_TYPES, REVOKE_EVENT_TYPES, TRANSFER_EVENT_TYPE } = await import('./revenuecat.js');
  assert.equal(TRANSFER_EVENT_TYPE, 'TRANSFER');
  assert.ok(!GRANT_EVENT_TYPES.has('TRANSFER'), 'TRANSFER must not blanket-grant');
  assert.ok(!REVOKE_EVENT_TYPES.has('TRANSFER'), 'TRANSFER must not blanket-revoke');
});

test('the webhook route reconciles both parties and never 500s on one failure', () => {
  const s = readFileSync(new URL('../app/api/revenuecat/webhook/route.js', import.meta.url), 'utf8');
  assert.match(s, /TRANSFER_EVENT_TYPE/, 'the route must special-case TRANSFER');
  // It must run BEFORE normalizeEvent, which would reject the event as
  // unattributable (no app_user_id).
  assert.ok(s.indexOf('TRANSFER_EVENT_TYPE') < s.indexOf('normalizeEvent(body)'),
    'the TRANSFER branch must precede normalization');
  assert.match(s, /for \(const uid of parties\)/, 'both parties must be reconciled');
  // The per-party try/catch: both the success and the failure path push a result,
  // so a throw on one side cannot abandon the other or 500 the whole delivery.
  const loop = s.slice(s.indexOf('for (const uid of parties)'), s.indexOf('// Ledger the event itself'));
  assert.match(loop, /try \{/, 'each party must be attempted independently');
  assert.match(loop, /catch \(err\)/, 'a throwing party must be caught');
  assert.equal((loop.match(/results\.push/g) ?? []).length, 2, 'both success and failure must record a result');
  assert.ok(!/throw/.test(loop), 'the loop must not rethrow - that would 500 the delivery');
});

test('the reconcile endpoint takes NO body - the user comes from the session', () => {
  const s = readFileSync(new URL('../app/api/revenuecat/reconcile/route.js', import.meta.url), 'utf8');
  assert.match(s, /const session = await auth\(\)/, 'must resolve the session');
  assert.match(s, /session\?\.user\?\.id/, 'user id must come from the session');
  assert.ok(!/req\.json\(\)|request\.json\(\)|searchParams/.test(s),
    'the endpoint must not read a user id from the request - it would be forgeable');
  assert.match(s, /status: 401/, 'signed-out callers must be refused');
  assert.match(s, /status: 429/, 'must be rate limited');
});
