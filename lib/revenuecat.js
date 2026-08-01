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

export const REVENUECAT_WEBHOOK_SECRET_ENV = 'REVENUECAT_WEBHOOK_SECRET';
export const PASS_PRODUCT_ID_ENV = 'APPLE_PASS_PRODUCT_ID';

// The App Store product id for the Draft Pass. Overridable by env so the id can
// be corrected without a deploy of this file, but it has a default so a missing
// env var does not silently accept EVERY product.
export const DEFAULT_PASS_PRODUCT_ID = 'com.sportsvyn.draftvyn.pass';

// RevenueCat's anonymous id prefix. A purchase carrying one of these cannot be
// attributed to an account - see the contract note above.
const ANON_PREFIX = '$RCAnonymousID:';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------
// GRANT. The locked design is ONE product: the Draft Pass as a NON-RENEWING
// subscription. RevenueCat fires NON_RENEWING_PURCHASE - not INITIAL_PURCHASE -
// for non-renewing subscriptions and consumables; INITIAL_PURCHASE is the
// auto-renewable path. Both are accepted because the store-side product type is
// a configuration detail that can be changed in App Store Connect without a code
// deploy, and getting it wrong would mean paid customers with no entitlement.
export const GRANT_EVENT_TYPES = new Set(['NON_RENEWING_PURCHASE', 'INITIAL_PURCHASE']);

// REVOKE. For a NON-RENEWING product a CANCELLATION is a refund or a revocation,
// so it takes access away immediately. NOTE: that reasoning does NOT hold for an
// auto-renewable subscription, where CANCELLATION only means "auto-renew off" and
// access should survive to the period end. If this product is ever changed to
// auto-renewing, this set is the line to revisit.
export const REVOKE_EVENT_TYPES = new Set(['CANCELLATION', 'REFUND', 'EXPIRATION']);

/**
 * The configured Pass product id.
 */
export function passProductId(env = process.env) {
  const raw = env?.[PASS_PRODUCT_ID_ENV];
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s || DEFAULT_PASS_PRODUCT_ID;
}

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
