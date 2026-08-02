// lib/revenuecat.js — the RevenueCat webhook's pure half: authorization, event
// normalization, and the product/user contracts.
//
// PURE (no DB, no next/*) so the route stays a thin shell and every decision here
// is unit-testable - route handlers cannot be imported under node --test because
// of the @/ alias, which is the same reason lib/pollers/cronAuth.js exists.
//
// WHY REVENUECAT AND NOT STOREKIT DIRECTLY: Apple's server notifications require
// JWS verification against Apple's CA chain and a separate sandbox/production
// endpoint split. RevenueCat normalizes both into one webhook with a shared
// secret, which is a few lines here instead of a certificate pipeline. The app
// side (a later binary) talks to RevenueCat's SDK; this server only ever sees
// their webhook.
//
// ============================ THE APP_USER_ID CONTRACT =======================
// THE NATIVE APP MUST SET RevenueCat's appUserID TO THE SIGNED-IN users.id,
// as a decimal string, BEFORE calling purchase.
//
//   Purchases.configure(apiKey: ..., appUserID: String(sportsvynUserId))
//
// This is the ONLY link between an Apple payment and a Sportsvyn account. There
// is no email in the webhook and no way to recover the account from a receipt, so
// a purchase made while RevenueCat still holds its generated anonymous id
// ($RCAnonymousID:...) lands on a user we cannot resolve. Those are REJECTED here
// (not guessed at) and logged, so the failure is visible instead of silently
// granting the Pass to nobody.
//
// If the user signs in AFTER launching, the app must call Purchases.logIn(userId)
// before showing the buy button. Anonymous ids are explicitly refused below.

import crypto from 'node:crypto';
// The product id lives in lib/appleIap.js, which is pure and client-safe. It has
// to: the purchase bridge is a client module and can never import THIS file,
// which pulls in node:crypto for the HMAC. One constant, one env var, both sides.
import { PASS_PRODUCT_ID_ENV, DEFAULT_PASS_PRODUCT_ID, passProductId } from './appleIap.js';

export const REVENUECAT_WEBHOOK_SECRET_ENV = 'REVENUECAT_WEBHOOK_SECRET';
export { PASS_PRODUCT_ID_ENV, DEFAULT_PASS_PRODUCT_ID, passProductId };

// RevenueCat's anonymous id prefix. A purchase carrying one of these cannot be
// attributed to an account - see the contract note above.
const ANON_PREFIX = '$RCAnonymousID:';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------
// GRANT. The product is ONE thing - the Draft Pass - but which event type
// RevenueCat fires for it depends on how it is configured in App Store Connect,
// and that is store-side configuration nobody deploys code to change:
//   NON_RENEWING_PURCHASE   non-renewing subscription (the original locked design).
//                           THIS IS THE ONE REVENUECAT ACTUALLY DOCUMENTS for a
//                           non-consumable, and the one to expect in practice.
//   NON_CONSUMABLE_PURCHASE \ defensive aliases for the same event. RevenueCat's
//   NON_CONSUMABLE          / published type list contains neither, but the
//                           product IS a non-consumable and the cost of being
//                           wrong is asymmetric (see below), so both spellings
//                           are honoured rather than guessed at.
//   INITIAL_PURCHASE        auto-renewable path, and the generic first-purchase
//                           shape some integrations emit
//   ONE_TIME_PURCHASE       defensive: the same idea under a different name
//
// WIDENING THIS SET IS SAFE BECAUSE GRANTS ARE PRODUCT-FILTERED. Only an event
// carrying OUR product id can grant anything (see normalizeEvent below), so the
// worst case of an extra type is that we honour a purchase of the Pass that
// arrived under an unexpected label - which is exactly the outcome we want. The
// expensive direction is the other one: a paying customer with no entitlement
// because the label did not match.
//
// RENEWAL IS DELIBERATELY ABSENT. The Pass does not renew, and treating a renewal
// as a grant would silently extend a one-time purchase. A test pins that.
export const GRANT_EVENT_TYPES = new Set([
  'NON_RENEWING_PURCHASE',
  'NON_CONSUMABLE_PURCHASE',
  'NON_CONSUMABLE',
  'INITIAL_PURCHASE',
  'ONE_TIME_PURCHASE',
]);

// REVOKE. For a NON-RENEWING product a CANCELLATION is a refund or a revocation,
// so it takes access away immediately. NOTE: that reasoning does NOT hold for an
// auto-renewable subscription, where CANCELLATION only means "auto-renew off" and
// access should survive to the period end. If this product is ever changed to
// auto-renewing, this set is the line to revisit.
export const REVOKE_EVENT_TYPES = new Set(['CANCELLATION', 'REFUND', 'EXPIRATION']);

// passProductId / DEFAULT_PASS_PRODUCT_ID / PASS_PRODUCT_ID_ENV are re-exported
// from lib/appleIap.js at the top of this file. They used to be defined here, but
// the client-side purchase bridge needs the same product id and cannot import
// this module (node:crypto). One definition, imported by both.

/**
 * Authorization. RevenueCat sends whatever you type into its "Authorization
 * header value" box, verbatim, on every request - there is no signature over the
 * body, so this shared secret IS the authentication.
 *
 * Compared in constant time. A missing or empty configured secret returns false
 * rather than allowing everything: an unconfigured endpoint must be closed, not
 * open, because this one grants paid entitlements.
 *
 * `Bearer <secret>` is accepted as well as the bare secret, because RevenueCat's
 * field takes a raw string and it is genuinely ambiguous which form was pasted.
 */
export function webhookAuthorized(headerValue, secret) {
  if (typeof secret !== 'string' || secret.length === 0) return false;
  if (typeof headerValue !== 'string' || headerValue.length === 0) return false;
  const offered = headerValue.startsWith('Bearer ') ? headerValue.slice(7) : headerValue;
  return timingSafeEqualStr(offered, secret);
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual THROWS on a length mismatch, which would leak length via the
  // exception path - hash both to a fixed width first so every comparison is the
  // same shape regardless of input length.
  const ah = crypto.createHash('sha256').update(ab).digest();
  const bh = crypto.createHash('sha256').update(bb).digest();
  return crypto.timingSafeEqual(ah, bh);
}

/**
 * Normalize a RevenueCat webhook body into the decision the route acts on.
 *
 * Returns { ok: false, reason } for anything unusable, or
 * { ok: true, action: 'grant' | 'revoke' | 'ignore', event: {...} }.
 *
 * 'ignore' is a SUCCESS: RevenueCat sends event types we have no opinion about
 * (TRANSFER, SUBSCRIBER_ALIAS, TEST...). Those must be acknowledged with a 200,
 * or RevenueCat retries them forever.
 *
 * SANDBOX IS ACCEPTED ON PURPOSE. App Review buys in the sandbox environment - if
 * sandbox events were dropped, the reviewer's test purchase would never unlock
 * anything and the app would be rejected a third time for the same guideline. The
 * environment is recorded on the ledger row so a sandbox grant is auditable.
 */
export function normalizeEvent(body, env = process.env) {
  const e = body?.event;
  if (!e || typeof e !== 'object') return { ok: false, reason: 'no event object' };

  const id = typeof e.id === 'string' && e.id.length > 0 ? e.id : null;
  if (!id) return { ok: false, reason: 'no event id' };

  const type = typeof e.type === 'string' ? e.type.toUpperCase() : '';
  if (!type) return { ok: false, reason: 'no event type' };

  const appUserId = typeof e.app_user_id === 'string' ? e.app_user_id.trim() : '';
  const productId = typeof e.product_id === 'string' ? e.product_id : null;
  const environment = typeof e.environment === 'string' ? e.environment : null;

  const base = { id, type, appUserId: appUserId || null, productId, environment };

  const isGrant = GRANT_EVENT_TYPES.has(type);
  const isRevoke = REVOKE_EVENT_TYPES.has(type);
  if (!isGrant && !isRevoke) return { ok: true, action: 'ignore', event: { ...base, userId: null } };

  // A grant must be OUR product. A revoke is deliberately NOT product-filtered:
  // some revocation events arrive with a null or different product_id, and
  // failing to revoke is the expensive direction (a refunded user keeps access).
  // The row-level guard on source='apple' is what keeps a revoke from touching a
  // Stripe membership.
  if (isGrant && productId !== passProductId(env)) {
    return { ok: true, action: 'ignore', event: { ...base, userId: null } };
  }

  const userId = parseAppUserId(appUserId);
  if (userId == null) {
    return { ok: false, reason: `unresolvable app_user_id: ${appUserId || '(empty)'}` };
  }

  return { ok: true, action: isGrant ? 'grant' : 'revoke', event: { ...base, userId } };
}

/**
 * app_user_id -> users.id. Strict: a positive integer in decimal, nothing else.
 * RevenueCat anonymous ids and any other shape return null so the caller can fail
 * loudly instead of writing a membership onto a guessed account.
 */
export function parseAppUserId(appUserId) {
  if (typeof appUserId !== 'string') return null;
  const s = appUserId.trim();
  if (!s || s.startsWith(ANON_PREFIX)) return null;
  if (!/^[0-9]+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}
