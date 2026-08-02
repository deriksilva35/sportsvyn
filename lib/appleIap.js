// lib/appleIap.js — the Apple IAP kill switch and client-facing config.
//
// PURE and CLIENT-SAFE (no React, no next/*, no node:* imports) so the server
// pages, the client bridge, the gate card, and a node test all read the same
// answer. lib/revenuecat.js imports the product id from here rather than the
// other way round, precisely because that module pulls in node:crypto for the
// webhook HMAC and can never be reached from a client component.
//
// WHY A FLAG AT ALL. The server half of Apple IAP (migration 056, the RevenueCat
// webhook) shipped before the purchase binary. A buy button rendered into a build
// with no StoreKit code is a dead control on a purchase surface, which is a worse
// 3.1.1 answer than the suppressed card it replaces.
//
// DEFAULT OFF, and off means the shipped suppressed card renders byte-for-byte as
// it does today. components/sim/shellPurchase.test.mjs - the 3.1.1 gate suite -
// runs against the flag in its default state and must stay green.

export const APPLE_IAP_ENABLED_ENV = 'APPLE_IAP_ENABLED';
export const APPLE_RC_KEY_ENV = 'REVENUECAT_APPLE_PUBLIC_KEY';
export const PASS_PRODUCT_ID_ENV = 'APPLE_PASS_PRODUCT_ID';

// The App Store product id for the Draft Pass, as configured in App Store Connect
// and RevenueCat. Overridable by env so it can be corrected without a deploy of
// this file, but a default exists so a missing env var cannot mean "any product".
export const DEFAULT_PASS_PRODUCT_ID = 'com.sportsvyn.draftvyn.pass';

// Explicit opt-in only. Anything else - unset, '', '0', 'false', 'no', a typo -
// is OFF. A flag that gates a purchase surface must never be enabled by accident,
// so the truthy set is closed and small rather than "not falsy".
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function appleIapEnabled(env = process.env) {
  const raw = env?.[APPLE_IAP_ENABLED_ENV];
  if (typeof raw !== 'string') return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * The RevenueCat Apple PUBLIC SDK key (the `appl_...` one). This is genuinely
 * public - it ships to the client by design, the same way a Stripe publishable
 * key does - but it is still read SERVER-SIDE and threaded as a prop rather than
 * exposed as NEXT_PUBLIC_. Two reasons:
 *   · NEXT_PUBLIC_ is inlined into the client bundle at BUILD time, so the value
 *     would be frozen into a build artifact; read server-side it is a pure env
 *     change, which is how APPLE_IAP_ENABLED and APP_STORE_URL already work.
 *   · It then reaches only the shell pages that can actually purchase, instead of
 *     every page of the website.
 *
 * VALIDATED, NOT TRUSTED: RevenueCat's Apple keys are `appl_`-prefixed. A key
 * that is empty, a placeholder, or (the expensive mistake) the SECRET key pasted
 * by accident returns null, which fails the whole buy path CLOSED - a suppressed
 * card - rather than rendering a button that dies inside StoreKit.
 */
export function revenueCatApplePublicKey(env = process.env) {
  const raw = env?.[APPLE_RC_KEY_ENV];
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s.startsWith('appl_') || s.length < 10) return null;
  return s;
}

export function passProductId(env = process.env) {
  const raw = env?.[PASS_PRODUCT_ID_ENV];
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s || DEFAULT_PASS_PRODUCT_ID;
}

/**
 * The single server-side answer to "can this render a buy control, and with what
 * configuration". Pages call this once and thread the result.
 *
 * `enabled` requires BOTH the flag AND a usable key. Keeping those coupled here
 * is what makes a half-configured environment fail closed: the flag flipped on
 * with no key set produces a suppressed card, never a button that cannot work.
 */
export function appleIapConfig(env = process.env) {
  const apiKey = revenueCatApplePublicKey(env);
  return {
    enabled: appleIapEnabled(env) && apiKey != null,
    apiKey,
    productId: passProductId(env),
  };
}
