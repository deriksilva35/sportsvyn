// lib/revenuecat.js — the RevenueCat integration's decision layer: webhook
// authorization, event normalization, the product/user contracts, and the
// RECONCILE path that asks RevenueCat what a user actually owns.
//
// MOSTLY PURE. Everything except reconcileFromRevenueCat() is pure and unit
// testable with no DB and no network - route handlers cannot be imported under
// node --test because of the @/ alias, which is the same reason
// lib/pollers/cronAuth.js exists. reconcileFromRevenueCat() is the one exception:
// it makes an HTTPS call and (unless dryRun) one DB write via lib/membership.js.
// Its decision half - parseSubscriberEntitlement + reconcilePlan - is still pure
// and is where the tests live.
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

// TRANSFER is neither a grant nor a revoke - it is BOTH, for two different users,
// and it is the event that broke the device on 2026-08-03. When one Apple ID is
// used by a second Sportsvyn account and the project is set to "transfer to new
// App User ID", RevenueCat moves the receipt and emits TRANSFER. It carries NO
// app_user_id and NO product_id - the parties are in transferred_from /
// transferred_to arrays - so normalizeEvent() could not attribute it and the
// handler ledgered it and did nothing. Result: the losing account kept access it
// no longer owned, and the gaining account (the person who had just tapped BUY)
// got nothing and sat on "unlocking" forever.
//
// The right response is not to guess a direction from the payload but to RECONCILE
// EVERY NAMED PARTY against RevenueCat's own subscriber state: ask what each user
// owns now and make the row match. That is idempotent, it is correct whichever way
// the receipt moved, and it needs no assumption about array ordering.
export const TRANSFER_EVENT_TYPE = 'TRANSFER';

/**
 * PURE. Pull the Sportsvyn user ids named by a TRANSFER event.
 *
 * Both arrays are read because the event describes one movement with two sides
 * and both rows need to end up correct. Ids that are not resolvable (RevenueCat
 * anonymous ids, junk) are dropped rather than guessed at; duplicates collapse.
 */
export function transferPartyIds(body) {
  const e = body?.event ?? {};
  const raw = [
    ...(Array.isArray(e.transferred_from) ? e.transferred_from : []),
    ...(Array.isArray(e.transferred_to) ? e.transferred_to : []),
  ];
  const out = [];
  for (const v of raw) {
    const id = parseAppUserId(typeof v === 'string' ? v : String(v ?? ''));
    if (id != null && !out.includes(id)) out.push(id);
  }
  return out;
}

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

// ===========================================================================
// RECONCILE — ask RevenueCat what this user actually owns, and match our row
// ===========================================================================
//
// WHY THIS EXISTS. The webhook is an event stream, and event streams miss
// things. Concretely, on 2026-08-03 an Apple ID that already owned the Pass was
// used by a second Sportsvyn account: RevenueCat emitted a TRANSFER, which
// carries no app_user_id and is not a grant, so nothing was written and the
// buyer sat on "unlocking" forever. An already-owned non-consumable produces no
// new purchase event at all. Polling the subscriber is the only way to answer
// "does this account own the Pass RIGHT NOW".
//
// THE PROJECT IS SET TO "TRANSFER TO NEW APP USER ID" (confirmed in the
// dashboard; the sandbox override is off, so sandbox behaves the same). That
// setting is what makes REVOKE correct here rather than merely safe: when a
// receipt moves to another account, the previous account genuinely no longer owns
// it. Without the revoke direction, one purchase passed between accounts would
// grant unlimited memberships, each permanent.
//
// TWO RULES THAT ARE NOT NEGOTIABLE:
//   1. A FAILED LOOKUP IS NEVER "NOT ENTITLED". Timeout, 5xx, missing key,
//      unparseable body - all return an error and write NOTHING. Treating a
//      RevenueCat outage as "nobody owns anything" would revoke every paying
//      Apple customer in one pass.
//   2. STRIPE ROWS ARE UNTOUCHABLE. Revoke is scoped to source='apple' in SQL,
//      so a user who bought on the web keeps that grant no matter what
//      RevenueCat says about their Apple identity.

export const REVENUECAT_SECRET_KEY_ENV = 'REVENUECAT_SECRET_KEY';
// Optional. If set, only this entitlement identifier counts. If unset, ANY
// entitlement whose product_identifier is our Pass counts - which is the safer
// default, because it does not depend on what the entitlement was named in the
// RevenueCat dashboard.
export const REVENUECAT_ENTITLEMENT_ENV = 'REVENUECAT_SIM_ENTITLEMENT';
export const RC_API_BASE = 'https://api.revenuecat.com/v1';

// Ledger types, deliberately distinct from any RevenueCat event type so a
// reconcile can never be mistaken for a delivery when reading the table.
export const RECONCILE_TYPES = {
  grant: 'RECONCILE_GRANT',
  update: 'RECONCILE_UPDATE',
  revoke: 'RECONCILE_REVOKE',
};

/**
 * PURE. Read a /v1/subscribers body and decide whether this subscriber holds the
 * Pass, and until when.
 *
 * ENTITLEMENTS ARE THE AUTHORITY, not non_subscriptions. After a transfer the
 * receipt moves, and the entitlement map is what reflects that; a stale
 * non_subscriptions entry on the losing account would otherwise keep it
 * entitled forever and defeat the whole revoke direction. non_subscriptions is
 * still collected, but only as diagnostic evidence for the dry-run report.
 *
 * A non-consumable entitlement has expires_date === null, meaning "forever" to
 * RevenueCat. Our product is sold as access through the Super Bowl, so a null
 * expiry maps onto DRAFT_PASS_EXPIRES_AT rather than being treated as infinite -
 * that keeps an Apple row identical in shape to a Stripe pass row.
 */
export function parseSubscriberEntitlement(body, opts = {}) {
  const productId = opts.productId ?? DEFAULT_PASS_PRODUCT_ID;
  const wantedEnt = opts.entitlementId ?? null;
  const fallbackExpiry = opts.fallbackExpiry ?? null;
  const now = opts.now instanceof Date ? opts.now : new Date();

  const sub = body?.subscriber;
  if (!sub || typeof sub !== 'object') {
    return { entitled: false, expiresAt: null, matched: null, evidence: 'no subscriber object' };
  }

  const ents = sub.entitlements && typeof sub.entitlements === 'object' ? sub.entitlements : {};
  const nonSubs = sub.non_subscriptions && typeof sub.non_subscriptions === 'object' ? sub.non_subscriptions : {};
  const owned = Array.isArray(nonSubs[productId]) ? nonSubs[productId].length : 0;

  for (const [id, e] of Object.entries(ents)) {
    if (!e || typeof e !== 'object') continue;
    if (wantedEnt ? id !== wantedEnt : e.product_identifier !== productId) continue;
    const raw = e.expires_date ?? null;
    if (raw != null) {
      const t = new Date(raw).getTime();
      if (!Number.isFinite(t) || t <= now.getTime()) {
        return { entitled: false, expiresAt: null, matched: id, evidence: `entitlement ${id} expired ${raw}` };
      }
      return { entitled: true, expiresAt: new Date(t).toISOString(), matched: id, evidence: `entitlement ${id} until ${raw}` };
    }
    // Lifetime (non-consumable). Clamp to the product's stated window.
    return {
      entitled: true,
      expiresAt: fallbackExpiry,
      matched: id,
      evidence: `entitlement ${id} lifetime (expires_date null), clamped to product window`,
    };
  }

  return {
    entitled: false,
    expiresAt: null,
    matched: null,
    evidence: `no matching entitlement (entitlements=[${Object.keys(ents).join(',') || 'none'}], non_subscriptions[${productId}]=${owned})`,
  };
}

/**
 * PURE. Given what RevenueCat says and the row we hold, decide the single write.
 *
 *   RC entitled + no row                 -> grant
 *   RC entitled + row exists             -> update (restamp expiry, force apple)
 *   RC not entitled + apple row          -> revoke
 *   RC not entitled + stripe row         -> none  (never touch Stripe)
 *   RC not entitled + no row             -> none
 *
 * `update` is emitted even when the expiry already matches. Deciding "nothing
 * changed" is the caller's job (the dry run reports it as a no-op); making the
 * plan depend on equality would hide a row whose SOURCE is wrong.
 */
export function reconcilePlan({ rc, row }) {
  const src = row?.source ?? null;
  if (rc.entitled) {
    if (!row) return { action: 'grant', expiresAt: rc.expiresAt, reason: 'RevenueCat entitled, no membership row' };
    return {
      action: 'update',
      expiresAt: rc.expiresAt,
      reason: src === 'apple'
        ? 'RevenueCat entitled, apple row exists - restamp expiry'
        : `RevenueCat entitled, existing ${src ?? 'unknown'}-sourced row - converts to apple`,
    };
  }
  if (row && src === 'apple') {
    return { action: 'revoke', expiresAt: null, reason: 'RevenueCat not entitled and the row is apple-sourced (receipt transferred away)' };
  }
  if (row) {
    return { action: 'none', expiresAt: null, reason: `RevenueCat not entitled but the row is ${src ?? 'unknown'}-sourced - left alone` };
  }
  return { action: 'none', expiresAt: null, reason: 'RevenueCat not entitled and no row' };
}

/**
 * Fetch a subscriber. Returns { ok:true, status, body } or { ok:false, error }.
 *
 * 404 is a SUCCESS carrying an empty subscriber: RevenueCat does not know this
 * app user id, which is a definite "owns nothing", not a failure. Everything
 * else that is not 2xx is an error, so the caller writes nothing.
 */
export async function fetchSubscriber(userId, opts = {}) {
  const key = opts.key ?? process.env[REVENUECAT_SECRET_KEY_ENV];
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  if (!key) return { ok: false, error: `${REVENUECAT_SECRET_KEY_ENV} is not set` };

  const uid = String(userId ?? '').trim();
  if (!uid) return { ok: false, error: 'no app user id' };

  const url = `${RC_API_BASE}/subscribers/${encodeURIComponent(uid)}`;
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const res = await doFetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: ac?.signal,
    });
    if (res.status === 404) return { ok: true, status: 404, body: { subscriber: { entitlements: {}, non_subscriptions: {} } } };
    if (res.status < 200 || res.status >= 300) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* body unreadable */ }
      return { ok: false, error: `RevenueCat ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    let body;
    try { body = await res.json(); } catch { return { ok: false, error: 'RevenueCat returned unparseable JSON' }; }
    return { ok: true, status: res.status, body };
  } catch (err) {
    return { ok: false, error: `RevenueCat request failed: ${err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err?.message}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Reconcile one user against RevenueCat.
 *
 * @param userId          Sportsvyn users.id (the RevenueCat app user id)
 * @param opts.dryRun     true = decide and report, write NOTHING
 * @param opts.env        env bag (tests)
 * @param opts.fetchImpl  fetch override (tests)
 *
 * Returns { ok:false, error, ... } on any lookup failure - and in that case has
 * made no writes at all. On success:
 *   { ok:true, userId, rc, before, plan, applied, dryRun }
 */
export async function reconcileFromRevenueCat(userId, opts = {}) {
  const env = opts.env ?? process.env;
  const dryRun = opts.dryRun === true;
  const productId = passProductId(env);
  const entitlementId = (env[REVENUECAT_ENTITLEMENT_ENV] || '').trim() || null;

  // Imported lazily so the pure half of this module stays importable without a
  // DATABASE_URL (lib/membership.js -> lib/db.js throws at import without one).
  const { getMembership, applyReconcile, DRAFT_PASS_EXPIRES_AT } = await import('./membership.js');

  const fetched = await fetchSubscriber(userId, { key: env[REVENUECAT_SECRET_KEY_ENV], fetchImpl: opts.fetchImpl });
  if (!fetched.ok) {
    // RULE 1: no writes on a failed lookup, ever.
    return { ok: false, userId, error: fetched.error, wrote: false };
  }

  const rc = parseSubscriberEntitlement(fetched.body, {
    productId,
    entitlementId,
    fallbackExpiry: DRAFT_PASS_EXPIRES_AT,
    now: opts.now,
  });
  const before = await getMembership(userId);
  const plan = reconcilePlan({ rc, row: before });

  if (dryRun || plan.action === 'none') {
    return { ok: true, userId, dryRun, rcStatus: fetched.status, rc, before, plan, wrote: false };
  }

  const applied = await applyReconcile({
    userId,
    action: plan.action,
    expiresAt: plan.expiresAt,
    productId,
    type: RECONCILE_TYPES[plan.action],
  });
  return { ok: true, userId, dryRun: false, rcStatus: fetched.status, rc, before, plan, applied, wrote: applied != null };
}
