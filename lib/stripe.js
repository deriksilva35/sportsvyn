/**
 * lib/stripe.js — minimal Stripe client over the REST API (no SDK dependency).
 *
 * Why no `stripe` npm package: adding a dep here would desync the committed
 * package-lock against the droplet's linux-rebuilt lockfile and break `npm ci`
 * on Vercel. The REST surface we need (Checkout, Billing Portal, retrieve
 * subscription) is a few form-encoded POSTs, and webhook signature verification
 * is a standard HMAC-SHA256 — all doable with fetch + node:crypto.
 *
 * API version is pinned (2024-06-20) so response shapes are stable — notably
 * subscription.current_period_end at the top level.
 */

import crypto from 'node:crypto';

const BASE = 'https://api.stripe.com/v1';
const API_VERSION = '2024-06-20';

function secretKey() {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error('STRIPE_SECRET_KEY not set');
  return k;
}

// form-encode nested params: {a:{b:1}} -> a[b]=1 ; arrays -> a[0][k]=v
function formEncode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') formEncode(item, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
      });
    } else if (v && typeof v === 'object') {
      formEncode(v, key, out);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return out.join('&');
}

export async function stripeRequest(method, path, params) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': API_VERSION,
    },
    body: params ? formEncode(params) : undefined,
  });
  const json = await res.json();
  if (res.status >= 300) {
    const msg = json?.error?.message ?? `Stripe ${res.status}`;
    const err = new Error(msg);
    err.stripe = json?.error;
    err.status = res.status;
    throw err;
  }
  return json;
}

// ---- Prices --------------------------------------------------------------
// Resolve a price id from its stable lookup_key at runtime. lookup_keys are
// identical across test/live, so the SAME code resolves the test price under a
// test key and the live price under a live key — no per-environment price config.
// Cached in module scope: one Stripe call per lookup_key per cold start. Only
// successful resolutions are cached (a miss is an error path — don't pin it).
const priceIdCache = new Map();
export async function resolvePriceId(lookupKey) {
  if (!lookupKey) return null;
  if (priceIdCache.has(lookupKey)) return priceIdCache.get(lookupKey);
  const res = await stripeRequest(
    'GET',
    `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=1`,
  );
  const id = res?.data?.[0]?.id ?? null;
  if (id) priceIdCache.set(lookupKey, id);
  return id;
}

// ---- Checkout ------------------------------------------------------------
export async function createCheckoutSession({ priceId, userId, email, baseUrl, mode = 'subscription' }) {
  const params = {
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email || undefined,
    client_reference_id: String(userId),
    allow_promotion_codes: true,
    success_url: `${baseUrl}/sim?upgraded=1`,
    cancel_url: `${baseUrl}/membership`,
  };
  if (mode === 'subscription') {
    // A 100%-off promo code must complete with NO card, so only collect a payment
    // method when the amount actually requires one. (Subscription-mode only param.)
    params.payment_method_collection = 'if_required';
  }
  // payment mode (one-time Draft Pass): Stripe skips card collection when a promo
  // zeroes the total; when it doesn't, a card is required (comps then ride the
  // subscription tiers — see the checkout action note).
  return stripeRequest('POST', '/checkout/sessions', params);
}

// ---- Billing Portal ------------------------------------------------------
export async function createBillingPortalSession({ customerId, returnUrl }) {
  return stripeRequest('POST', '/billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl,
  });
}

// ---- Subscriptions -------------------------------------------------------
export async function retrieveSubscription(subscriptionId) {
  return stripeRequest('GET', `/subscriptions/${subscriptionId}`);
}

// Normalize the membership fields we persist from a Stripe subscription object.
export function membershipFieldsFromSubscription(sub) {
  return {
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    priceId: sub.items?.data?.[0]?.price?.id ?? null,
    lookupKey: sub.items?.data?.[0]?.price?.lookup_key ?? null,
    currentPeriodEnd: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };
}

// ---- Webhook signature verification (HMAC-SHA256, no SDK) -----------------
// Stripe-Signature header: "t=<ts>,v1=<sig>,v1=<sig>...". signed payload is
// `${t}.${rawBody}`. Constant-time compare against any v1. 5-minute tolerance.
export function verifyWebhookSignature(rawBody, sigHeader, secret, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  if (!sigHeader || !secret) return { ok: false, reason: 'missing signature or secret' };
  const parts = Object.create(null);
  for (const kv of sigHeader.split(',')) {
    const i = kv.indexOf('=');
    if (i < 0) continue;
    const k = kv.slice(0, i);
    const v = kv.slice(i + 1);
    if (k === 'v1') (parts.v1 ??= []).push(v);
    else parts[k] = v;
  }
  const t = Number(parts.t);
  if (!t || !parts.v1?.length) return { ok: false, reason: 'malformed signature header' };
  if (Math.abs(nowSec - t) > toleranceSec) return { ok: false, reason: 'timestamp outside tolerance' };
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const match = parts.v1.some((sig) => {
    let sigBuf;
    try { sigBuf = Buffer.from(sig, 'hex'); } catch { return false; }
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
  return match ? { ok: true } : { ok: false, reason: 'no matching signature' };
}
