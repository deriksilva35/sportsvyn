'use client';
// lib/shell/purchaseBridge.js — the in-app purchase bridge, implemented against
// the RevenueCat Capacitor plugin.
//
// ======================= WHAT CHANGED, AND WHY ==============================
// This module used to call a hand-rolled native hook, window.draftvyn.purchasePass,
// that a Swift developer was going to implement. That hook is GONE: the binary
// now carries @revenuecat/purchases-capacitor@11.3.2, and because the shell loads
// the remote site, Capacitor injects its bridge into OUR pages as
// window.Capacitor.Plugins.Purchases. So the purchase runs entirely from web code
// and there is no Swift to write. Keeping the old hook as a fallback would mean a
// second, permanently dead purchase path - a liability on a 3.1.1 surface - so it
// was removed rather than kept.
//
// THE RESULT CONTRACT IS UNCHANGED, deliberately: PassBuy and its tests depend on
// it, and it is the piece that describes what the UI must do.
//
//   { ok: true,  state: 'purchased'   }   a new transaction completed
//   { ok: true,  state: 'restored'    }   already owned; entitlement recovered
//   { ok: false, state: 'cancelled'   }   user dismissed the StoreKit sheet
//   { ok: false, state: 'pending'     }   Ask to Buy / SCA - may complete later
//   { ok: false, state: 'unavailable' }   plugin absent, or product not fetchable
//   { ok: false, state: 'notOwned'    }   restore ran and found nothing to restore
//   { ok: false, state: 'failed', message? }
//
// ENTITLEMENT NEVER ARRIVES THROUGH THIS CALLBACK. ok:true means StoreKit took the
// money. The Pass is granted server-side when RevenueCat's webhook reaches
// /api/revenuecat/webhook and writes the membership row - usually seconds, but NOT
// synchronous. The UI therefore says "unlocking", calls router.refresh(), and lets
// the SERVER re-decide what the user owns. There is no client-side unlock to spoof.

import { isShellMode } from './bridge.js';
import { DEFAULT_PASS_PRODUCT_ID } from '../appleIap.js';

const isDev = process.env.NODE_ENV !== 'production';

// 'restored', 'notOwned' and 'alreadyOwned' joined the contract when restore was
// added. Matching is CASE-INSENSITIVE via a canonical lookup rather than
// toLowerCase(): the original comparison lowercased the incoming state and tested
// it against this set, which silently turned every camelCase state into 'failed'
// the moment one existed.
const STATES = ['purchased', 'restored', 'cancelled', 'pending', 'unavailable', 'failed', 'notOwned', 'alreadyOwned'];
const CANONICAL = new Map(STATES.map((s) => [s.toLowerCase(), s]));
const OK_STATES = new Set(['purchased', 'restored']);
const canonicalState = (v) => (typeof v === 'string' ? CANONICAL.get(v.toLowerCase()) ?? null : null);

// PURCHASES_ERROR_CODE from @revenuecat/purchases-typescript-internal-esm. These
// are STRING numerals in the enum ("1", not 1), but the value crosses the
// Capacitor bridge from native, so it is compared as String(code) - a number 1
// and a string "1" must both read as cancelled.
const ERR = {
  PURCHASE_CANCELLED: '1',
  PRODUCT_NOT_AVAILABLE: '5',
  PRODUCT_ALREADY_PURCHASED: '6',
  PAYMENT_PENDING: '20',
};

// Non-consumables and non-renewing subscriptions are both NON_SUBSCRIPTION to the
// SDK. The type hint is ignored on iOS (per the plugin's own docs) but is correct
// to send, and would matter if this ever ran on Android.
const NON_SUBSCRIPTION = 'NON_SUBSCRIPTION';

// Our own endpoint - session-scoped, takes no body (app/api/revenuecat/reconcile).
const RECONCILE_ENDPOINT = '/api/revenuecat/reconcile';

// Runtime config handed over by the server via <IapConfigure/>. Module scope so
// purchasePass() stays a no-argument call from the gate card and the product id
// has exactly one source (the server's env) rather than a constant duplicated on
// the client.
let runtime = { apiKey: null, productId: DEFAULT_PASS_PRODUCT_ID };
// Which appUserID the SDK is currently configured for, or null if configure() has
// not run in this document.
let configuredFor = null;

// Test seam. Never called by app code.
export function __resetPurchaseBridgeForTests() {
  runtime = { apiKey: null, productId: DEFAULT_PASS_PRODUCT_ID };
  configuredFor = null;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** The injected plugin, or null. */
export function purchasesPlugin() {
  if (typeof window === 'undefined') return null;
  const p = window.Capacitor?.Plugins?.Purchases;
  return p && typeof p.purchaseStoreProduct === 'function' ? p : null;
}

/**
 * Can we actually sell here? SHELL MODE **AND** the plugin.
 *
 * Both halves matter. The plugin alone is not enough - a plain browser session
 * that somehow saw a Capacitor object should not get a buy button - and shell
 * mode alone is certainly not enough, since the previously shipped binary is a
 * shell with no StoreKit in it at all. When this is false the gate card renders
 * its neutral, no-purchase state; it never renders a broken button.
 */
export function canPurchaseInApp() {
  return isShellMode() && purchasesPlugin() != null;
}

/**
 * Capacitor injects its bridge before our JS runs, so the plugin is normally
 * present at hydration. "Normally" is not "always" (a slow plugin registration,
 * a webview quirk), and the failure mode - a permanently suppressed card in a
 * build that CAN buy - is invisible and confusing to debug. So this polls briefly
 * and gives up: bounded at ~2s, self-cancelling, and a no-op once the plugin is
 * already there.
 */
export function subscribePurchaseAvailability(onChange) {
  if (typeof window === 'undefined' || canPurchaseInApp()) return () => {};
  let tries = 0;
  let timer = null;
  const tick = () => {
    if (canPurchaseInApp()) { onChange(); return; }
    if (++tries > 20) return;
    timer = setTimeout(tick, 100);
  };
  timer = setTimeout(tick, 100);
  return () => { if (timer) clearTimeout(timer); };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configure the SDK, or move it to a new user.
 *
 * NEVER CONFIGURES ANONYMOUSLY. Without an appUserID the SDK invents an
 * $RCAnonymousID, the purchase webhook arrives carrying it, and the server
 * refuses the event by design (lib/revenuecat.js) - money taken, entitlement
 * unattributable. So a missing user id returns 'no-user' and does nothing at all;
 * it is not a soft failure to be logged and continued past.
 *
 * Returns one of: 'no-plugin' | 'no-user' | 'no-key' | 'configured' | 'logged-in'
 * | 'already' | 'error', which is what makes this testable without a plugin.
 */
export async function configurePurchases({ apiKey, userId, productId } = {}) {
  const plugin = purchasesPlugin();
  if (productId) runtime.productId = productId;
  if (!plugin) return 'no-plugin';

  const uid = userId == null ? '' : String(userId).trim();
  if (!uid) return 'no-user';
  if (!apiKey) return 'no-key';
  runtime.apiKey = apiKey;

  try {
    if (configuredFor == null) {
      await plugin.configure({ apiKey, appUserID: uid });
      configuredFor = uid;
      return 'configured';
    }
    if (configuredFor !== uid) {
      // Late sign-in, or an account switch inside one document. configure() is
      // once-per-process; logIn is the sanctioned way to move the SDK to a real
      // user id afterwards.
      await plugin.logIn({ appUserID: uid });
      configuredFor = uid;
      return 'logged-in';
    }
    return 'already';
  } catch (err) {
    if (isDev) console.log('[shell:purchase] configure failed:', err?.message);
    return 'error';
  }
}

/**
 * Log the RevenueCat SDK out, clearing the cached appUserID. Best-effort: returns
 * a reason string and never throws, because sign-out must not be blocked by it.
 *
 * Without this the SDK keeps the previous user's id in the webview after
 * sign-out, so the next account on the device could transact under the old id -
 * and with transfer-to-new-App-User-ID that is exactly how a Pass lands on the
 * wrong account.
 */
export async function logOutPurchases() {
  const plugin = purchasesPlugin();
  if (!plugin || typeof plugin.logOut !== 'function') return 'no-plugin';
  try {
    await plugin.logOut();
    configuredFor = null;   // force a fresh configure() for the next user
    return 'logged-out';
  } catch (err) {
    // RevenueCat throws if the current user is already anonymous. Harmless.
    configuredFor = null;
    if (isDev) console.log('[shell:purchase] logOut:', err?.message);
    return 'error';
  }
}

// ---------------------------------------------------------------------------
// Result mapping
// ---------------------------------------------------------------------------

/**
 * Normalize anything into the documented shape. Defensive on purpose: a plugin
 * bug or a shape change across the native bridge must resolve to a definite
 * failure the UI can render, never to an undefined that reads as success.
 */
export function normalizePurchaseResult(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, state: 'failed' };
  const state = canonicalState(raw.state);
  if (raw.ok === true) {
    if (raw.state == null || raw.state === '' || state === 'purchased') return { ok: true, state: 'purchased' };
    if (state === 'restored') return { ok: true, state: 'restored' };
    return { ok: false, state: state ?? 'failed' };
  }
  const s = state && !OK_STATES.has(state) ? state : 'failed';
  const out = { ok: false, state: s };
  if (typeof raw.message === 'string' && raw.message) out.message = raw.message;
  return out;
}

/**
 * Map a rejected RevenueCat call onto the contract.
 *
 * Matched on THREE signals - numeric code, readableErrorCode, and the deprecated
 * userCancelled boolean - because the value crosses the Capacitor bridge from
 * native and which fields survive varies by platform and version. Getting this
 * wrong is not cosmetic: a cancelled purchase reported as 'failed' tells a user
 * "that purchase did not go through" when they simply changed their mind.
 */
export function mapPurchaseError(err) {
  const code = err?.code == null ? '' : String(err.code);
  const readable = String(err?.readableErrorCode ?? err?.userInfo?.readableErrorCode ?? '');
  const message = typeof err?.message === 'string' && err.message ? err.message : undefined;

  if (err?.userCancelled === true || code === ERR.PURCHASE_CANCELLED || readable === 'PURCHASE_CANCELLED_ERROR') {
    return { ok: false, state: 'cancelled' };
  }
  if (code === ERR.PAYMENT_PENDING || readable === 'PAYMENT_PENDING_ERROR') {
    return { ok: false, state: 'pending' };
  }
  if (code === ERR.PRODUCT_NOT_AVAILABLE || readable === 'PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR') {
    return { ok: false, state: 'unavailable' };
  }
  // ALREADY PURCHASED IS NOT SUCCESS. It used to be mapped to
  // { ok:true, state:'purchased' } on the reasoning that the user does own the
  // thing - and that is exactly what stranded a real device on 2026-08-03. An
  // already-owned non-consumable produces NO new StoreKit transaction, therefore
  // no RevenueCat purchase webhook, therefore no membership row; the UI reported
  // success and waited forever on a grant that could never arrive.
  //
  // It is now its own signal. purchasePass() catches it and RESTORES instead,
  // which is the operation that actually recovers the entitlement.
  if (code === ERR.PRODUCT_ALREADY_PURCHASED || readable === 'PRODUCT_ALREADY_PURCHASED_ERROR') {
    return { ok: false, state: 'alreadyOwned' };
  }
  return normalizePurchaseResult({ ok: false, state: 'failed', message });
}

// ---------------------------------------------------------------------------
// The purchase
// ---------------------------------------------------------------------------

/**
 * Tell OUR server to re-check RevenueCat and fix this user's row.
 *
 * THIS IS THE STEP THAT WAS MISSING. StoreKit completing does not mean a webhook
 * is coming: an already-owned non-consumable emits no purchase event, and a
 * TRANSFER carries no app_user_id. Waiting on the webhook alone is what produced
 * a permanent "unlocking". Asking the server to look is deterministic.
 *
 * Returns { ok, entitled } - `entitled` is the SERVER's verdict, never the
 * client's. There is still no client-side unlock.
 */
export async function reconcileWithServer() {
  try {
    const res = await fetch(RECONCILE_ENDPOINT, { method: 'POST', headers: { accept: 'application/json' } });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) return { ok: false, entitled: false, error: body?.error ?? `reconcile ${res.status}` };
    return { ok: true, entitled: body?.entitled === true, action: body?.action ?? null };
  } catch (err) {
    return { ok: false, entitled: false, error: err?.message ?? 'reconcile request failed' };
  }
}

// Shared tail for every path that ends in "the store says they own it": ask the
// server to reconcile, then report. `state` distinguishes a fresh purchase from a
// restore purely so the UI can word it correctly - both mean entitled.
async function settleOwned(state) {
  const r = await reconcileWithServer();
  if (r.ok) return { ok: true, state };
  // The store transaction DID succeed; only our re-check failed. Say so
  // precisely - "purchase failed" would be a lie, and would invite a second buy.
  return { ok: false, state: 'failed', message: r.error ?? 'Could not confirm with the server' };
}

/**
 * Restore a previously bought Pass. Exported for the explicit Restore Purchases
 * control, and used internally when a purchase reports alreadyOwned.
 *
 * Apple REQUIRES a restore mechanism for non-consumables, and until now the app
 * had none - only a line of copy claiming it happened automatically.
 */
export function restorePass(onResult) {
  if (!canPurchaseInApp()) {
    if (isDev) console.log('[shell:purchase] restore: no Purchases plugin / not shell');
    return false;
  }
  const plugin = purchasesPlugin();
  const once = onceGuard(onResult);

  (async () => {
    try {
      const info = await plugin.restorePurchases();
      // Whether the receipt actually carried our product is RevenueCat's and the
      // server's call, not a judgement made from this payload - restorePurchases
      // resolves even when there was nothing to restore. So reconcile, and let
      // the server's verdict decide between 'restored' and 'notOwned'.
      const r = await reconcileWithServer();
      if (!r.ok) { once({ ok: false, state: 'failed', message: r.error }); return; }
      once(r.entitled ? { ok: true, state: 'restored' } : { ok: false, state: 'notOwned' });
      if (isDev) console.log('[shell:purchase] restore ->', r.entitled ? 'restored' : 'nothing to restore', info ? '' : '(no info)');
    } catch (err) {
      once(mapPurchaseError(err));
    }
  })();

  return true;
}

// One-shot callback wrapper: a plugin that resolves AND rejects, or calls back
// twice, must not make the UI fire its unlock path twice.
function onceGuard(onResult) {
  let called = false;
  return (raw) => {
    if (called) return;
    called = true;
    try {
      onResult?.(normalizePurchaseResult(raw));
    } catch (err) {
      if (isDev) console.log('[shell:purchase] onResult threw:', err?.message);
    }
  };
}

/**
 * Start a Pass purchase. Returns true if the request reached the plugin.
 *
 * `onResult` is invoked at most ONCE with a normalized result.
 *
 * THE ALREADY-OWNED PATH IS THE WHOLE FIX. If StoreKit says the product is
 * already purchased, this no longer reports a false success - it runs a RESTORE,
 * which is the operation that actually recovers the entitlement, then reconciles.
 */
export function purchasePass(onResult) {
  if (!canPurchaseInApp()) {
    if (isDev) console.log('[shell:purchase] no Purchases plugin / not shell');
    return false;
  }
  const plugin = purchasesPlugin();
  const once = onceGuard(onResult);

  (async () => {
    try {
      const wanted = runtime.productId || DEFAULT_PASS_PRODUCT_ID;
      const res = await plugin.getProducts({ productIdentifiers: [wanted], type: NON_SUBSCRIPTION });
      const list = Array.isArray(res?.products) ? res.products : [];
      // Match by identifier rather than trusting position: an empty list means
      // the product is not configured in App Store Connect / RevenueCat, which is
      // 'unavailable' and NOT an error the user did anything to cause.
      const product = list.find((p) => p?.identifier === wanted) ?? list[0] ?? null;
      if (!product) { once({ ok: false, state: 'unavailable' }); return; }

      await plugin.purchaseStoreProduct({ product });
      once(await settleOwned('purchased'));
    } catch (err) {
      const mapped = mapPurchaseError(err);
      if (mapped.state === 'alreadyOwned') {
        // Not an error to show the user - it means the receipt exists and the
        // entitlement is recoverable. Restore, then reconcile.
        if (isDev) console.log('[shell:purchase] already owned -> auto-restoring');
        try {
          await plugin.restorePurchases();
          once(await settleOwned('restored'));
        } catch (rerr) {
          once(mapPurchaseError(rerr));
        }
        return;
      }
      once(mapped);
    }
  })();

  return true;
}
