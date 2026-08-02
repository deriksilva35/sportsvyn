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
//   { ok: true,  state: 'purchased'   }
//   { ok: false, state: 'cancelled'   }   user dismissed the StoreKit sheet
//   { ok: false, state: 'pending'     }   Ask to Buy / SCA - may complete later
//   { ok: false, state: 'unavailable' }   plugin absent, or product not fetchable
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

const STATES = new Set(['purchased', 'cancelled', 'pending', 'unavailable', 'failed']);

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
  const state = typeof raw.state === 'string' ? raw.state.toLowerCase() : '';
  if (raw.ok === true) {
    return state === 'purchased' || state === ''
      ? { ok: true, state: 'purchased' }
      : { ok: false, state: STATES.has(state) ? state : 'failed' };
  }
  const s = STATES.has(state) && state !== 'purchased' ? state : 'failed';
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
  // ALREADY PURCHASED is treated as SUCCESS, and this is a judgement call worth
  // stating. The Pass is a NON-CONSUMABLE: a reinstall, a restore, or a second
  // device all reach a StoreKit that says "you own this". Reporting "that
  // purchase did not go through, nothing was charged" would be actively false -
  // they own it. Mapping it to purchased runs the same path as a fresh buy:
  // "unlocking" plus a server refresh, with entitlement still decided server-side
  // off the webhook. The worst case is an optimistic message; the alternative is
  // telling a paying customer they own nothing.
  if (code === ERR.PRODUCT_ALREADY_PURCHASED || readable === 'PRODUCT_ALREADY_PURCHASED_ERROR') {
    return { ok: true, state: 'purchased' };
  }
  return normalizePurchaseResult({ ok: false, state: 'failed', message });
}

// ---------------------------------------------------------------------------
// The purchase
// ---------------------------------------------------------------------------

/**
 * Start a Pass purchase. Returns true if the request reached the plugin.
 *
 * `onResult` is invoked at most ONCE with a normalized result, so a plugin that
 * resolves and rejects, or a double callback, cannot make the UI fire its unlock
 * path twice.
 */
export function purchasePass(onResult) {
  if (!canPurchaseInApp()) {
    if (isDev) console.log('[shell:purchase] no Purchases plugin / not shell');
    return false;
  }
  const plugin = purchasesPlugin();

  let called = false;
  const once = (raw) => {
    if (called) return;
    called = true;
    try {
      onResult?.(normalizePurchaseResult(raw));
    } catch (err) {
      if (isDev) console.log('[shell:purchase] onResult threw:', err?.message);
    }
  };

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
      once({ ok: true, state: 'purchased' });
    } catch (err) {
      once(mapPurchaseError(err));
    }
  })();

  return true;
}
