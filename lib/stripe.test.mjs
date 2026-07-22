// Pure unit tests for lib/stripe.js — webhook signature verification and the
// subscription -> membership field mapping. No network, no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyWebhookSignature, membershipFieldsFromSubscription } from './stripe.js';

const SECRET = 'whsec_test_secret_abc123';
function sign(payload, secret, t) {
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  return `t=${t},v1=${sig}`;
}

test('webhook signature: valid signature verifies', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const t = 1_700_000_000;
  const header = sign(body, SECRET, t);
  assert.deepEqual(verifyWebhookSignature(body, header, SECRET, 300, t), { ok: true });
});

test('webhook signature: verifying the same event twice is idempotent (both pass)', () => {
  const body = JSON.stringify({ id: 'evt_dup', type: 'customer.subscription.updated' });
  const t = 1_700_000_100;
  const header = sign(body, SECRET, t);
  assert.equal(verifyWebhookSignature(body, header, SECRET, 300, t).ok, true);
  assert.equal(verifyWebhookSignature(body, header, SECRET, 300, t).ok, true);
});

test('webhook signature: tampered body fails', () => {
  const body = JSON.stringify({ id: 'evt_2', amount: 100 });
  const t = 1_700_000_200;
  const header = sign(body, SECRET, t);
  const tampered = JSON.stringify({ id: 'evt_2', amount: 999 });
  assert.equal(verifyWebhookSignature(tampered, header, SECRET, 300, t).ok, false);
});

test('webhook signature: wrong secret fails', () => {
  const body = 'payload';
  const t = 1_700_000_300;
  const header = sign(body, SECRET, t);
  assert.equal(verifyWebhookSignature(body, header, 'whsec_wrong', 300, t).ok, false);
});

test('webhook signature: timestamp outside tolerance fails', () => {
  const body = 'payload';
  const signedAt = 1_700_000_000;
  const header = sign(body, SECRET, signedAt);
  const now = signedAt + 10_000; // ~2.7h later, tolerance 300s
  const r = verifyWebhookSignature(body, header, SECRET, 300, now);
  assert.equal(r.ok, false);
  assert.match(r.reason, /tolerance/);
});

test('webhook signature: malformed header / missing secret fail cleanly', () => {
  assert.equal(verifyWebhookSignature('x', 'garbage', SECRET, 300, 1).ok, false);
  assert.equal(verifyWebhookSignature('x', 't=1', SECRET, 300, 1).ok, false); // no v1
  assert.equal(verifyWebhookSignature('x', null, SECRET, 300, 1).ok, false);
  assert.equal(verifyWebhookSignature('x', 't=1,v1=abc', null, 300, 1).ok, false); // no secret
});

test('membershipFieldsFromSubscription: maps fields + converts unix to ISO', () => {
  const sub = {
    id: 'sub_123',
    customer: 'cus_abc',
    status: 'active',
    current_period_end: 1_700_000_000,
    items: { data: [{ price: { id: 'price_month' } }] },
  };
  const f = membershipFieldsFromSubscription(sub);
  assert.equal(f.stripeSubscriptionId, 'sub_123');
  assert.equal(f.stripeCustomerId, 'cus_abc');
  assert.equal(f.status, 'active');
  assert.equal(f.priceId, 'price_month');
  assert.equal(f.currentPeriodEnd, new Date(1_700_000_000 * 1000).toISOString());
});

test('membershipFieldsFromSubscription: customer object + null period tolerated', () => {
  const f = membershipFieldsFromSubscription({
    id: 'sub_x', customer: { id: 'cus_obj' }, status: 'canceled',
    current_period_end: null, items: { data: [] },
  });
  assert.equal(f.stripeCustomerId, 'cus_obj');
  assert.equal(f.priceId, null);
  assert.equal(f.currentPeriodEnd, null);
});
