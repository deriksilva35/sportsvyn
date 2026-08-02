// lib/revenuecat.test.mjs — the Apple IAP webhook's pure half.
//
// This endpoint GRANTS PAID ENTITLEMENTS to whoever it believes the caller is, on
// the strength of one shared secret and one integer in the body. So the tests
// that matter are the ones about being wrong: an unconfigured secret must close
// the door rather than open it, an unattributable purchase must be refused rather
// than guessed at, and a refund must not be silently ignored because the product
// id was missing.
//
// Pure module - no DB, no network. The DB-backed grant/revoke/idempotency tests
// live in membership.test.mjs beside the Stripe ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVENUECAT_WEBHOOK_SECRET_ENV, PASS_PRODUCT_ID_ENV, DEFAULT_PASS_PRODUCT_ID,
  GRANT_EVENT_TYPES, REVOKE_EVENT_TYPES,
  webhookAuthorized, normalizeEvent, parseAppUserId, passProductId,
} from './revenuecat.js';

const SECRET = 'rcwh_test_secret_abc123';
const PROD = DEFAULT_PASS_PRODUCT_ID;

const evt = (over = {}) => ({
  event: {
    id: 'rc_evt_1',
    type: 'NON_RENEWING_PURCHASE',
    app_user_id: '42',
    product_id: PROD,
    environment: 'PRODUCTION',
    ...over,
  },
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test('the exact configured secret authorizes', () => {
  assert.equal(webhookAuthorized(SECRET, SECRET), true);
});

test('a Bearer-prefixed secret authorizes (the RC field takes a raw string)', () => {
  assert.equal(webhookAuthorized(`Bearer ${SECRET}`, SECRET), true);
});

test('an UNCONFIGURED secret closes the endpoint, it does not open it', () => {
  // The expensive failure: deploying without REVENUECAT_WEBHOOK_SECRET set and
  // having the endpoint accept anonymous callers who can then grant themselves
  // the Pass. Absent config must mean "refuse everything".
  for (const secret of [undefined, null, '', 0, false]) {
    assert.equal(webhookAuthorized(SECRET, secret), false, `secret ${String(secret)} allowed a caller`);
    assert.equal(webhookAuthorized('anything', secret), false);
  }
});

test('a wrong, empty, or missing header is refused', () => {
  for (const h of [undefined, null, '', 'wrong', 'Bearer wrong', `${SECRET} `, ` ${SECRET}`]) {
    assert.equal(webhookAuthorized(h, SECRET), false, `header ${JSON.stringify(h)} authorized`);
  }
});

test('comparing secrets of different lengths does not throw', () => {
  // timingSafeEqual throws on unequal buffer lengths; hashing first is what keeps
  // a short header from becoming a 500 (and a length oracle).
  assert.doesNotThrow(() => webhookAuthorized('x', SECRET));
  assert.equal(webhookAuthorized('x', SECRET), false);
  assert.equal(webhookAuthorized(`${SECRET}${SECRET}`, SECRET), false);
});

// ---------------------------------------------------------------------------
// The app_user_id contract
// ---------------------------------------------------------------------------

test('app_user_id must be a positive decimal users.id', () => {
  assert.equal(parseAppUserId('42'), 42);
  assert.equal(parseAppUserId(' 42 '), 42);
});

test('a RevenueCat ANONYMOUS id is refused, never guessed at', () => {
  // This is the single likeliest integration bug: the app purchases before
  // calling Purchases.logIn(userId), so the money is real and the account is
  // unknown. Refusing makes it a loud 400 in the logs instead of a silent grant
  // to a user id we invented.
  assert.equal(parseAppUserId('$RCAnonymousID:8a9b0c1d2e3f'), null);
});

test('non-numeric, zero, negative, and unsafe ids are refused', () => {
  for (const bad of ['', '   ', 'abc', '4.2', '-1', '0', '1e3', '0x2a', '42abc',
    '99999999999999999999', null, undefined, 42, {}]) {
    assert.equal(parseAppUserId(bad), null, `accepted ${String(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// Event normalization
// ---------------------------------------------------------------------------

test('NON_RENEWING_PURCHASE of the Pass grants (the locked product type)', () => {
  // The design is a NON-RENEWING subscription, and that is the event RevenueCat
  // actually fires for one - not INITIAL_PURCHASE.
  const n = normalizeEvent(evt(), {});
  assert.equal(n.ok, true);
  assert.equal(n.action, 'grant');
  assert.equal(n.event.userId, 42);
  assert.equal(n.event.productId, PROD);
});

test('INITIAL_PURCHASE of the Pass also grants (product type is store-side config)', () => {
  const n = normalizeEvent(evt({ type: 'INITIAL_PURCHASE' }), {});
  assert.equal(n.action, 'grant');
  assert.equal(n.event.userId, 42);
});

test('SANDBOX purchases grant - App Review buys in sandbox', () => {
  // Dropping sandbox events would mean the reviewer's test purchase unlocks
  // nothing and the app is rejected a third time on the same guideline.
  const n = normalizeEvent(evt({ environment: 'SANDBOX' }), {});
  assert.equal(n.action, 'grant');
  assert.equal(n.event.environment, 'SANDBOX');
});

test('a purchase of some OTHER product is ignored, not granted', () => {
  const n = normalizeEvent(evt({ product_id: 'com.sportsvyn.draftvyn.something_else' }), {});
  assert.equal(n.ok, true);
  assert.equal(n.action, 'ignore');
});

test('the product id is env-overridable', () => {
  assert.equal(passProductId({}), DEFAULT_PASS_PRODUCT_ID);
  assert.equal(passProductId({ [PASS_PRODUCT_ID_ENV]: 'com.other.pass' }), 'com.other.pass');
  assert.equal(passProductId({ [PASS_PRODUCT_ID_ENV]: '  ' }), DEFAULT_PASS_PRODUCT_ID);
  const n = normalizeEvent(evt({ product_id: 'com.other.pass' }), { [PASS_PRODUCT_ID_ENV]: 'com.other.pass' });
  assert.equal(n.action, 'grant');
});

test('CANCELLATION, REFUND and EXPIRATION all revoke', () => {
  for (const type of ['CANCELLATION', 'REFUND', 'EXPIRATION']) {
    const n = normalizeEvent(evt({ type }), {});
    assert.equal(n.action, 'revoke', `${type} did not revoke`);
    assert.equal(n.event.userId, 42);
  }
});

test('a revoke is NOT product-filtered - failing to revoke is the costly direction', () => {
  // Revocation events can arrive with a null or unexpected product_id. Ignoring
  // those would leave a refunded customer holding the Pass.
  const n = normalizeEvent(evt({ type: 'CANCELLATION', product_id: null }), {});
  assert.equal(n.action, 'revoke');
});

test('unknown event types are IGNORED with ok:true, not errors', () => {
  // RevenueCat retries non-2xx forever. TRANSFER/SUBSCRIBER_ALIAS/TEST must be
  // acknowledged or they queue up indefinitely.
  for (const type of ['TRANSFER', 'SUBSCRIBER_ALIAS', 'TEST', 'BILLING_ISSUE', 'RENEWAL']) {
    const n = normalizeEvent(evt({ type }), {});
    assert.equal(n.ok, true, `${type} produced an error`);
    assert.equal(n.action, 'ignore', `${type} was not ignored`);
  }
});

test('an unattributable PURCHASE is an error, not a silent ignore', () => {
  // It has to be loud: someone paid and got nothing.
  const n = normalizeEvent(evt({ app_user_id: '$RCAnonymousID:zz' }), {});
  assert.equal(n.ok, false);
  assert.match(n.reason, /app_user_id/);
});

test('malformed bodies are rejected without throwing', () => {
  for (const body of [null, undefined, {}, { event: null }, { event: 'x' },
    { event: { type: 'NON_RENEWING_PURCHASE' } },          // no id
    { event: { id: 'x' } }]) {                              // no type
    const n = normalizeEvent(body, {});
    assert.equal(n.ok, false, `accepted ${JSON.stringify(body)}`);
    assert.equal(typeof n.reason, 'string');
  }
});

test('the Pass grants under EVERY purchase label RevenueCat might use', () => {
  // The product is configured in App Store Connect as a NON-CONSUMABLE, but which
  // event type RevenueCat emits for it is store-side configuration nobody deploys
  // code to change. A label we do not accept means a paying customer with no
  // entitlement, so the set is deliberately wide.
  for (const type of ['NON_RENEWING_PURCHASE', 'NON_CONSUMABLE_PURCHASE', 'INITIAL_PURCHASE', 'ONE_TIME_PURCHASE']) {
    const n = normalizeEvent(evt({ type }), {});
    assert.equal(n.ok, true, `${type} errored`);
    assert.equal(n.action, 'grant', `${type} did not grant`);
    assert.equal(n.event.userId, 42);
  }
});

test('widening the type set stays safe because grants are PRODUCT-filtered', () => {
  // This is what makes the wide set defensible: no matter how a purchase event is
  // labelled, it can only grant if it carries OUR product id.
  for (const type of ['NON_CONSUMABLE_PURCHASE', 'ONE_TIME_PURCHASE', 'INITIAL_PURCHASE']) {
    const n = normalizeEvent(evt({ type, product_id: 'com.someone.else' }), {});
    assert.equal(n.action, 'ignore', `${type} granted for a foreign product`);
  }
});

test('RENEWAL still never grants - the Pass does not renew', () => {
  assert.ok(!GRANT_EVENT_TYPES.has('RENEWAL'));
  assert.equal(normalizeEvent(evt({ type: 'RENEWAL' }), {}).action, 'ignore');
});

test('event type sets are disjoint and name what the code relies on', () => {
  for (const t of GRANT_EVENT_TYPES) assert.ok(!REVOKE_EVENT_TYPES.has(t), `${t} both grants and revokes`);
  assert.ok(GRANT_EVENT_TYPES.has('NON_RENEWING_PURCHASE'));
  assert.ok(REVOKE_EVENT_TYPES.has('CANCELLATION'));
  // RENEWAL must NOT grant: this product does not renew, and treating a renewal
  // as a grant would extend a Pass that was meant to be one-time.
  assert.ok(!GRANT_EVENT_TYPES.has('RENEWAL'));
});

test('the env var names are the ones documented to Vercel', () => {
  assert.equal(REVENUECAT_WEBHOOK_SECRET_ENV, 'REVENUECAT_WEBHOOK_SECRET');
  assert.equal(PASS_PRODUCT_ID_ENV, 'APPLE_PASS_PRODUCT_ID');
  assert.ok(!REVENUECAT_WEBHOOK_SECRET_ENV.startsWith('NEXT_PUBLIC_'), 'the secret must never be public');
});
