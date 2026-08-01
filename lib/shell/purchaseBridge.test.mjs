// lib/shell/purchaseBridge.test.mjs — the web -> native purchase contract.
//
// This is the seam between two codebases that ship on different schedules: the
// web (this repo, deployed continuously) and the native binary (submitted to
// Apple). The web cannot see the native implementation, so everything here is
// about surviving the native side behaving badly or not existing at all:
//   · an OLD binary with no window.draftvyn must not produce a buy button
//   · a bridge that calls back twice must not unlock twice
//   · a bridge that throws must still resolve the UI out of its pending state
//   · a malformed result must never read as success
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  purchaseBridge, canPurchaseInApp, normalizePurchaseResult, purchasePass,
} from './purchaseBridge.js';

afterEach(() => { delete globalThis.window; });

// Install a fake native container. `impl` receives the callback the web passes.
function installBridge(impl) {
  globalThis.window = { draftvyn: { purchasePass: impl } };
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

test('no window at all (server render) -> no bridge, no throw', () => {
  assert.equal(purchaseBridge(), null);
  assert.equal(canPurchaseInApp(), false);
});

test('the OLD shipped binary - window but no draftvyn hook - has no bridge', () => {
  // 1.0(2) is live on the App Store with no StoreKit code. If APPLE_IAP_ENABLED
  // is flipped on while that build is still out there, this is what stops it
  // rendering a dead buy button on a purchase surface.
  globalThis.window = {};
  assert.equal(canPurchaseInApp(), false);
  globalThis.window = { draftvyn: {} };
  assert.equal(canPurchaseInApp(), false);
  globalThis.window = { draftvyn: { purchasePass: 'not a function' } };
  assert.equal(canPurchaseInApp(), false);
});

test('a real bridge is detected', () => {
  installBridge(() => {});
  assert.equal(canPurchaseInApp(), true);
  assert.equal(typeof purchaseBridge(), 'function');
});

// ---------------------------------------------------------------------------
// Result normalization
// ---------------------------------------------------------------------------

test('only an explicit purchased result reads as success', () => {
  assert.deepEqual(normalizePurchaseResult({ ok: true, state: 'purchased' }), { ok: true, state: 'purchased' });
  // ok:true with no state is the tolerated shorthand.
  assert.deepEqual(normalizePurchaseResult({ ok: true }), { ok: true, state: 'purchased' });
});

test('garbage NEVER reads as success', () => {
  // The failure that would matter: a native bug returning undefined and the UI
  // treating it as paid.
  for (const raw of [undefined, null, 'ok', 42, true, {}, { ok: 'yes' }, { state: 'purchased' }]) {
    const r = normalizePurchaseResult(raw);
    assert.equal(r.ok, false, `${JSON.stringify(raw)} read as success`);
    assert.equal(typeof r.state, 'string');
  }
});

test('ok:true with a contradictory state is NOT success', () => {
  assert.deepEqual(normalizePurchaseResult({ ok: true, state: 'cancelled' }), { ok: false, state: 'cancelled' });
  assert.deepEqual(normalizePurchaseResult({ ok: true, state: 'failed' }), { ok: false, state: 'failed' });
});

test('documented failure states survive; unknown ones collapse to failed', () => {
  for (const state of ['cancelled', 'pending', 'unavailable', 'failed']) {
    assert.deepEqual(normalizePurchaseResult({ ok: false, state }), { ok: false, state });
  }
  assert.deepEqual(normalizePurchaseResult({ ok: false, state: 'wat' }), { ok: false, state: 'failed' });
  assert.deepEqual(normalizePurchaseResult({ ok: false }), { ok: false, state: 'failed' });
});

test('a message is carried through when present', () => {
  assert.deepEqual(
    normalizePurchaseResult({ ok: false, state: 'failed', message: 'card declined' }),
    { ok: false, state: 'failed', message: 'card declined' },
  );
});

// ---------------------------------------------------------------------------
// purchasePass()
// ---------------------------------------------------------------------------

test('with no bridge, purchasePass reports false and never calls back', () => {
  let called = false;
  assert.equal(purchasePass(() => { called = true; }), false);
  assert.equal(called, false);
});

test('a successful purchase delivers a normalized success exactly once', () => {
  const results = [];
  installBridge((cb) => { cb({ ok: true, state: 'purchased' }); });
  assert.equal(purchasePass((r) => results.push(r)), true);
  assert.deepEqual(results, [{ ok: true, state: 'purchased' }]);
});

test('a bridge that calls back TWICE only unlocks once', () => {
  // Double-callback is a plausible native bug (retry + delegate both firing).
  // The UI path behind this does router.refresh(), so a second call is at best
  // wasted work and at worst a loop.
  const results = [];
  installBridge((cb) => { cb({ ok: true, state: 'purchased' }); cb({ ok: true, state: 'purchased' }); });
  purchasePass((r) => results.push(r));
  assert.equal(results.length, 1);
});

test('a bridge that THROWS still resolves the UI to a definite failure', () => {
  const results = [];
  installBridge(() => { throw new Error('StoreKit exploded'); });
  assert.equal(purchasePass((r) => results.push(r)), true);
  assert.deepEqual(results, [{ ok: false, state: 'failed' }]);
});

test('a callback that throws does not propagate into the bridge', () => {
  installBridge((cb) => { cb({ ok: true, state: 'purchased' }); });
  assert.doesNotThrow(() => purchasePass(() => { throw new Error('render blew up'); }));
});

test('an async callback (the real StoreKit shape) is normalized too', () => {
  // StoreKit resolves after a sheet, so the callback lands later. Nothing in
  // purchasePass assumes it is synchronous.
  const results = [];
  let saved;
  installBridge((cb) => { saved = cb; });
  purchasePass((r) => results.push(r));
  assert.deepEqual(results, []);
  saved({ ok: false, state: 'cancelled' });
  assert.deepEqual(results, [{ ok: false, state: 'cancelled' }]);
});
