'use client';
// lib/shell/purchaseBridge.js — web SENDER for the in-app purchase bridge.
//
// ======================= THE JS CONTRACT (native side) ======================
// The native shell injects, before first paint:
//
//   window.draftvyn = window.draftvyn || {};
//   window.draftvyn.purchasePass = function (callback) { ... };
//
// The web calls it with ONE argument, a callback, and the native side invokes
// that callback exactly once with a result object:
//
//   { ok: true,  state: 'purchased' }
//   { ok: false, state: 'cancelled'   }   user backed out of the sheet
//   { ok: false, state: 'pending'     }   Ask to Buy / SCA - may complete later
//   { ok: false, state: 'unavailable' }   StoreKit unreachable, product missing
//   { ok: false, state: 'failed', message?: string }
//
// WHY A CALLBACK AND NOT THE EXISTING postMessage BRIDGE (./bridge.js): haptics
// and share are fire-and-forget, so a one-way post is the right shape for them.
// A purchase has a RESULT the UI must react to, and correlating a reply back to a
// request over postMessage would mean inventing request ids and a listener
// registry. A callback is the smaller contract.
//
// ENTITLEMENT DOES NOT ARRIVE THROUGH THIS CALLBACK. ok:true means StoreKit took
// the money; the Pass is granted server-side when RevenueCat's webhook reaches
// /api/revenuecat/webhook (lib/revenuecat.js), which is usually seconds but is
// NOT synchronous and is not guaranteed to have landed when the callback fires.
// The UI must therefore say "unlocking" and re-read entitlement from the server -
// it must never grant access client-side on ok:true. The server is the only
// source of truth for what someone owns.

const isDev = process.env.NODE_ENV !== 'production';

const STATES = new Set(['purchased', 'cancelled', 'pending', 'unavailable', 'failed']);

// The one place that knows the hook's name and shape.
export function purchaseBridge() {
  if (typeof window === 'undefined') return null;
  const fn = window.draftvyn?.purchasePass;
  return typeof fn === 'function' ? fn : null;
}

// Is the in-app buy path actually usable right now? The gate card asks this
// before it renders a buy control, so the OLD shipped binary - which has no
// window.draftvyn - never shows a button that cannot do anything.
export function canPurchaseInApp() {
  return purchaseBridge() != null;
}

/**
 * Normalize whatever the native side hands back into the documented shape.
 * Exported for tests, and used defensively: a native bug (undefined, a string, a
 * missing state) must resolve to a definite failure the UI can render, never to
 * an undefined that reads as success.
 */
export function normalizePurchaseResult(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, state: 'failed' };
  const state = typeof raw.state === 'string' ? raw.state.toLowerCase() : '';
  if (raw.ok === true) {
    // Trust ok:true only when it is the one state that means "paid".
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
 * Start a Pass purchase. Returns true if the request reached the native side.
 *
 * `onResult` is invoked at most ONCE with a normalized result - a native side
 * that calls back twice cannot make the UI fire its unlock path twice.
 */
export function purchasePass(onResult) {
  const fn = purchaseBridge();
  if (!fn) {
    if (isDev) console.log('[shell:purchase] no window.draftvyn.purchasePass (no container)');
    return false;
  }
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
  try {
    fn(once);
  } catch (err) {
    // A throwing bridge must still resolve the UI out of its pending state.
    if (isDev) console.log('[shell:purchase] bridge threw:', err?.message);
    once({ ok: false, state: 'failed' });
  }
  return true;
}
