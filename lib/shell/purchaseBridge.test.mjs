// lib/shell/purchaseBridge.test.mjs — the RevenueCat Capacitor purchase flow.
//
// The plugin lives in the native binary, not in this repo's node_modules, so it
// can never be imported here. These tests stand a fake
// window.Capacitor.Plugins.Purchases in its place, shaped from the real v11.3.2
// typings (@revenuecat/purchases-capacitor -> purchases-typescript-internal-esm
// 17.25.0): PURCHASES_ERROR_CODE values are STRING numerals, `userCancelled` is
// deprecated in favour of code === '1', and purchaseStoreProduct rejects rather
// than resolving an error.
//
// What is actually being defended:
//   · a plain browser (no plugin) must SUPPRESS the buy control, never break it
//   · a cancelled purchase must not be reported as a failure
//   · the SDK must never be configured with an anonymous id
//   · the callback must fire exactly once, whatever the plugin does
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  purchasesPlugin, canPurchaseInApp, subscribePurchaseAvailability,
  configurePurchases, normalizePurchaseResult, mapPurchaseError, purchasePass,
  restorePass, logOutPurchases, reconcileWithServer,
  __resetPurchaseBridgeForTests,
} from './purchaseBridge.js';
import { DEFAULT_PASS_PRODUCT_ID } from '../appleIap.js';

const KEY = 'appl_TESTkeyABCDEF';

// Every ok:true path now goes through POST /api/revenuecat/reconcile, so the
// endpoint is stubbed. `reconcileStub` is what the server "says"; tests that care
// about the server disagreeing override it.
let reconcileStub;
let reconcileCalls;
beforeEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  __resetPurchaseBridgeForTests();
  reconcileCalls = [];
  reconcileStub = { status: 200, body: { ok: true, entitled: true, action: 'grant' } };
  globalThis.fetch = async (url, init) => {
    reconcileCalls.push({ url, method: init?.method });
    return { ok: reconcileStub.status < 400, status: reconcileStub.status, json: async () => reconcileStub.body };
  };
});

// Shell mode is cookie- or param-based (lib/shell/bridge.js). Both halves of the
// environment have to exist for canPurchaseInApp() to be exercised honestly.
function setEnv({ shell = true, plugin = null, search = '' } = {}) {
  globalThis.window = { location: { search }, Capacitor: plugin ? { Plugins: { Purchases: plugin } } : undefined };
  globalThis.document = { cookie: shell ? 'sv_shell=sim-app' : '' };
}

// A fake plugin. `product` controls what getProducts returns; `onPurchase` is the
// purchaseStoreProduct implementation.
function fakePlugin({ products, onPurchase, onConfigure, onLogIn } = {}) {
  const calls = { configure: [], logIn: [], getProducts: [], purchase: [] };
  return {
    calls,
    configure: async (o) => { calls.configure.push(o); if (onConfigure) return onConfigure(o); },
    logIn: async (o) => { calls.logIn.push(o); if (onLogIn) return onLogIn(o); },
    getProducts: async (o) => {
      calls.getProducts.push(o);
      return { products: products ?? [{ identifier: DEFAULT_PASS_PRODUCT_ID, priceString: '$9.99' }] };
    },
    purchaseStoreProduct: async (o) => {
      calls.purchase.push(o);
      if (onPurchase) return onPurchase(o);
      return { productIdentifier: DEFAULT_PASS_PRODUCT_ID, customerInfo: {} };
    },
  };
}

const rcError = (code, extra = {}) => Object.assign(new Error(extra.message ?? 'rc failure'), { code, ...extra });

// ---------------------------------------------------------------------------
// Detection — plugin absent must SUPPRESS
// ---------------------------------------------------------------------------

test('server render: no window -> no plugin, no purchase', () => {
  assert.equal(purchasesPlugin(), null);
  assert.equal(canPurchaseInApp(), false);
});

test('a PLAIN BROWSER suppresses the buy control (no Capacitor at all)', () => {
  // The dev-verification case from the brief: flag on in a preview env, opened in
  // a normal browser. The card must render its neutral state, never a button that
  // cannot do anything.
  setEnv({ shell: true, plugin: null });
  assert.equal(canPurchaseInApp(), false);
  assert.equal(purchasePass(() => {}), false);
});

test('a half-injected Capacitor bridge still suppresses', () => {
  for (const cap of [{}, { Plugins: {} }, { Plugins: { Purchases: {} } },
    { Plugins: { Purchases: { purchaseStoreProduct: 'nope' } } }]) {
    globalThis.window = { location: { search: '' }, Capacitor: cap };
    globalThis.document = { cookie: 'sv_shell=sim-app' };
    assert.equal(canPurchaseInApp(), false, `accepted ${JSON.stringify(cap)}`);
  }
});

test('the plugin WITHOUT shell mode is not enough', () => {
  // A plugin object outside the shell should never open a purchase surface.
  setEnv({ shell: false, plugin: fakePlugin() });
  assert.equal(purchasesPlugin() != null, true, 'the plugin itself is visible');
  assert.equal(canPurchaseInApp(), false, 'but purchasing requires shell mode too');
});

test('shell + a real plugin enables the buy path', () => {
  setEnv({ shell: true, plugin: fakePlugin() });
  assert.equal(canPurchaseInApp(), true);
});

test('THE PARAM ALONE NO LONGER OPENS THE BUY PATH - the cookie does', () => {
  // WHAT THIS USED TO CLAIM. It asserted the opposite: that ?shell=sim-app on
  // its own was enough, because isShellMode checked the URL before the cookie
  // and the cookie was written late by a client effect. proxy.js now turns the
  // param into the cookie on the first request that carries it, so by the time
  // any of this runs the cookie exists - and reading the URL as well would be
  // asking a second source the same question.
  //
  // THE RULE IS NOT WEAKENED, IT IS NARROWED TO ONE SOURCE. A container still
  // reaches the buy path; it reaches it by the cookie the proxy set. What can
  // no longer happen is a URL alone unlocking purchasing - which, for a 3.1.1
  // surface, is the safer direction to be wrong in.
  globalThis.window = { location: { search: '?shell=sim-app' }, Capacitor: { Plugins: { Purchases: fakePlugin() } } };
  globalThis.document = { cookie: '' };
  assert.equal(canPurchaseInApp(), false, 'a bare param must not unlock purchasing');

  globalThis.document = { cookie: 'sv_shell=sim-app' };
  assert.equal(canPurchaseInApp(), true, 'the cookie the proxy set does');
});

test('availability subscription is a no-op once the plugin is present', () => {
  setEnv({ shell: true, plugin: fakePlugin() });
  let fired = 0;
  const unsub = subscribePurchaseAvailability(() => { fired += 1; });
  assert.equal(typeof unsub, 'function');
  unsub();
  assert.equal(fired, 0);
});

test('availability subscription notifies if the plugin appears late', async () => {
  setEnv({ shell: true, plugin: null });
  let fired = 0;
  const unsub = subscribePurchaseAvailability(() => { fired += 1; });
  globalThis.window.Capacitor = { Plugins: { Purchases: fakePlugin() } };
  await new Promise((r) => setTimeout(r, 260));
  unsub();
  assert.ok(fired >= 1, 'a late-registering plugin never woke the card up');
});

// ---------------------------------------------------------------------------
// Configuration — never anonymous
// ---------------------------------------------------------------------------

test('NEVER configures without a user id', async () => {
  // The whole reason this rule exists: configuring anonymously makes the SDK
  // invent an $RCAnonymousID, the webhook arrives carrying it, and the server
  // refuses the event - money taken, entitlement unattributable.
  const plugin = fakePlugin();
  setEnv({ shell: true, plugin });
  for (const userId of [undefined, null, '', '   ']) {
    assert.equal(await configurePurchases({ apiKey: KEY, userId }), 'no-user');
  }
  assert.equal(plugin.calls.configure.length, 0, 'configure was called without a user id');
  assert.equal(plugin.calls.logIn.length, 0);
});

test('configures once with the signed-in user id as a string', async () => {
  const plugin = fakePlugin();
  setEnv({ shell: true, plugin });
  assert.equal(await configurePurchases({ apiKey: KEY, userId: 42 }), 'configured');
  assert.deepEqual(plugin.calls.configure, [{ apiKey: KEY, appUserID: '42' }]);
  // Repeat mounts must not reconfigure.
  assert.equal(await configurePurchases({ apiKey: KEY, userId: 42 }), 'already');
  assert.equal(plugin.calls.configure.length, 1);
});

test('a DIFFERENT user in the same document goes through logIn, not configure', async () => {
  // Late sign-in / account switch. configure() is once-per-process; logIn is the
  // sanctioned way to move the SDK onto a real user id afterwards.
  const plugin = fakePlugin();
  setEnv({ shell: true, plugin });
  await configurePurchases({ apiKey: KEY, userId: 42 });
  assert.equal(await configurePurchases({ apiKey: KEY, userId: 77 }), 'logged-in');
  assert.deepEqual(plugin.calls.logIn, [{ appUserID: '77' }]);
  assert.equal(plugin.calls.configure.length, 1, 'configure ran twice');
});

test('no plugin or no key -> configuration is skipped, not attempted', async () => {
  setEnv({ shell: true, plugin: null });
  assert.equal(await configurePurchases({ apiKey: KEY, userId: 42 }), 'no-plugin');
  const plugin = fakePlugin();
  setEnv({ shell: true, plugin });
  assert.equal(await configurePurchases({ apiKey: '', userId: 42 }), 'no-key');
  assert.equal(plugin.calls.configure.length, 0);
});

test('a throwing configure is swallowed, never surfaced to the page', async () => {
  const plugin = fakePlugin({ onConfigure: () => { throw new Error('bad key'); } });
  setEnv({ shell: true, plugin });
  assert.equal(await configurePurchases({ apiKey: KEY, userId: 42 }), 'error');
});

// ---------------------------------------------------------------------------
// Error mapping — the real PURCHASES_ERROR_CODE values
// ---------------------------------------------------------------------------

test('cancellation is recognised by all three signals the bridge might send', () => {
  // Reporting a cancel as a failure tells someone who simply changed their mind
  // that their purchase did not go through.
  for (const err of [
    rcError('1'), rcError(1), rcError('99', { userCancelled: true }),
    rcError('99', { readableErrorCode: 'PURCHASE_CANCELLED_ERROR' }),
    { code: '1' },
  ]) {
    assert.deepEqual(mapPurchaseError(err), { ok: false, state: 'cancelled' }, `missed cancel: ${JSON.stringify(err)}`);
  }
});

test('payment pending (Ask to Buy / SCA) maps to pending, not failed', () => {
  assert.deepEqual(mapPurchaseError(rcError('20')), { ok: false, state: 'pending' });
  assert.deepEqual(mapPurchaseError(rcError('99', { readableErrorCode: 'PAYMENT_PENDING_ERROR' })), { ok: false, state: 'pending' });
});

test('product not available maps to unavailable', () => {
  assert.deepEqual(mapPurchaseError(rcError('5')), { ok: false, state: 'unavailable' });
});

test('ALREADY PURCHASED is NOT success - it is its own signal', () => {
  // This mapping used to return { ok:true, state:'purchased' }, and that is what
  // stranded a real device: an already-owned non-consumable emits no StoreKit
  // transaction, so no webhook, so no membership row - and the UI reported
  // success and waited forever. It now routes to a restore instead.
  assert.deepEqual(mapPurchaseError(rcError('6')), { ok: false, state: 'alreadyOwned' });
});

test('everything else fails with the message carried through', () => {
  const r = mapPurchaseError(rcError('2', { message: 'The App Store is unavailable' }));
  assert.equal(r.ok, false);
  assert.equal(r.state, 'failed');
  assert.equal(r.message, 'The App Store is unavailable');
  // Garbage rejections must still be definite failures, never undefined.
  for (const junk of [undefined, null, 'boom', 42, {}]) {
    const g = mapPurchaseError(junk);
    assert.equal(g.ok, false);
    assert.equal(g.state, 'failed');
  }
});

test('normalizePurchaseResult never lets garbage read as success', () => {
  for (const raw of [undefined, null, 'ok', 42, true, {}, { ok: 'yes' }, { state: 'purchased' }]) {
    assert.equal(normalizePurchaseResult(raw).ok, false, `${JSON.stringify(raw)} read as success`);
  }
  assert.deepEqual(normalizePurchaseResult({ ok: true }), { ok: true, state: 'purchased' });
  assert.deepEqual(normalizePurchaseResult({ ok: true, state: 'cancelled' }), { ok: false, state: 'cancelled' });
});

// ---------------------------------------------------------------------------
// The purchase flow
// ---------------------------------------------------------------------------

const flush = () => new Promise((r) => setTimeout(r, 10));

test('happy path: fetch the product, buy it, report purchased once', async () => {
  const plugin = fakePlugin();
  setEnv({ shell: true, plugin });
  const seen = [];
  assert.equal(purchasePass((r) => seen.push(r)), true);
  await flush();
  assert.deepEqual(seen, [{ ok: true, state: 'purchased' }]);
  assert.deepEqual(plugin.calls.getProducts, [{ productIdentifiers: [DEFAULT_PASS_PRODUCT_ID], type: 'NON_SUBSCRIPTION' }]);
  assert.equal(plugin.calls.purchase[0].product.identifier, DEFAULT_PASS_PRODUCT_ID);
});

test('the product id from the server is what gets bought', async () => {
  const custom = 'com.sportsvyn.draftvyn.pass2';
  const plugin = fakePlugin({ products: [{ identifier: custom }] });
  setEnv({ shell: true, plugin });
  await configurePurchases({ apiKey: KEY, userId: 42, productId: custom });
  purchasePass(() => {});
  await flush();
  assert.deepEqual(plugin.calls.getProducts[0].productIdentifiers, [custom]);
});

test('the right product is chosen by identifier, not by position', async () => {
  const plugin = fakePlugin({ products: [{ identifier: 'com.other.thing' }, { identifier: DEFAULT_PASS_PRODUCT_ID }] });
  setEnv({ shell: true, plugin });
  purchasePass(() => {});
  await flush();
  assert.equal(plugin.calls.purchase[0].product.identifier, DEFAULT_PASS_PRODUCT_ID);
});

test('an empty product list is UNAVAILABLE, and never opens a purchase', async () => {
  // Product not configured in App Store Connect / RevenueCat. Not the user's
  // fault, and not a "failed purchase".
  const plugin = fakePlugin({ products: [] });
  setEnv({ shell: true, plugin });
  const seen = [];
  purchasePass((r) => seen.push(r));
  await flush();
  assert.deepEqual(seen, [{ ok: false, state: 'unavailable' }]);
  assert.equal(plugin.calls.purchase.length, 0, 'it tried to buy nothing');
});

test('a cancelled purchase reports cancelled', async () => {
  const plugin = fakePlugin({ onPurchase: () => { throw rcError('1'); } });
  setEnv({ shell: true, plugin });
  const seen = [];
  purchasePass((r) => seen.push(r));
  await flush();
  assert.deepEqual(seen, [{ ok: false, state: 'cancelled' }]);
});

test('a failing getProducts is reported, not swallowed into a hang', async () => {
  const plugin = fakePlugin();
  plugin.getProducts = async () => { throw rcError('10', { message: 'offline' }); };
  setEnv({ shell: true, plugin });
  const seen = [];
  purchasePass((r) => seen.push(r));
  await flush();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].state, 'failed');
});

test('DOUBLE-CALLBACK GUARD: the UI unlock path can only fire once', async () => {
  // A plugin that both resolves and rejects, or a bridge that calls back twice.
  // The consumer runs router.refresh() on success, so a second call is at best
  // wasted work and at worst a loop.
  const plugin = fakePlugin({
    onPurchase: async () => { throw rcError('1'); },
  });
  plugin.getProducts = async () => ({ products: [{ identifier: DEFAULT_PASS_PRODUCT_ID }] });
  setEnv({ shell: true, plugin });
  const seen = [];
  purchasePass((r) => { seen.push(r); throw new Error('consumer blew up'); });
  await flush();
  assert.equal(seen.length, 1, 'callback fired more than once');
});

test('a throwing consumer callback does not escape the bridge', async () => {
  const plugin = fakePlugin();
  setEnv({ shell: true, plugin });
  assert.doesNotThrow(() => purchasePass(() => { throw new Error('render blew up'); }));
  await flush();
});

test('purchasePass with no plugin returns false and never calls back', async () => {
  setEnv({ shell: true, plugin: null });
  let called = false;
  assert.equal(purchasePass(() => { called = true; }), false);
  await flush();
  assert.equal(called, false);
});

// ---------------------------------------------------------------------------
// RESTORE + RECONCILE — the fix for the stranded device
// ---------------------------------------------------------------------------

test('a genuine purchase RECONCILES with the server before reporting success', async () => {
  // The bug was trusting a webhook that may never arrive. Success must now mean
  // "the server has already agreed", not "please wait".
  const plugin = fakePlugin();
  setEnv({ shell: true, plugin });
  const seen = [];
  purchasePass((r) => seen.push(r));
  await flush();
  assert.deepEqual(seen, [{ ok: true, state: 'purchased' }]);
  assert.equal(reconcileCalls.length, 1, 'no reconcile was made');
  assert.equal(reconcileCalls[0].url, '/api/revenuecat/reconcile');
  assert.equal(reconcileCalls[0].method, 'POST');
});

test('ALREADY OWNED auto-restores instead of reporting a false success', async () => {
  // THE ORIGINAL BUG, end to end. StoreKit says "already purchased"; the old code
  // said "purchased" and hung. Now it restores, reconciles, and reports 'restored'.
  const plugin = fakePlugin({ onPurchase: () => { throw rcError('6'); } });
  let restored = 0;
  plugin.restorePurchases = async () => { restored += 1; return { entitlements: {} }; };
  setEnv({ shell: true, plugin });
  const seen = [];
  purchasePass((r) => seen.push(r));
  await flush();
  assert.equal(restored, 1, 'it did not restore');
  assert.deepEqual(seen, [{ ok: true, state: 'restored' }]);
  assert.equal(reconcileCalls.length, 1);
});

test('the store succeeding but the SERVER failing is not reported as a purchase failure', async () => {
  // The money may well have moved. Saying "nothing was charged" would be a lie
  // and would invite a second purchase.
  reconcileStub = { status: 502, body: { ok: false, error: 'RevenueCat 500' } };
  const plugin = fakePlugin();
  setEnv({ shell: true, plugin });
  const seen = [];
  purchasePass((r) => seen.push(r));
  await flush();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].ok, false);
  assert.equal(seen[0].state, 'failed');
  assert.match(seen[0].message, /RevenueCat 500/);
});

test('restorePass: owns it -> restored', async () => {
  const plugin = fakePlugin();
  plugin.restorePurchases = async () => ({ entitlements: { active: { pass: {} } } });
  setEnv({ shell: true, plugin });
  const seen = [];
  assert.equal(restorePass((r) => seen.push(r)), true);
  await flush();
  assert.deepEqual(seen, [{ ok: true, state: 'restored' }]);
});

test('restorePass: owns nothing -> notOwned, NOT an error', async () => {
  // The server is the judge: restorePurchases resolves either way, so the verdict
  // comes from the reconcile.
  reconcileStub = { status: 200, body: { ok: true, entitled: false, action: 'none' } };
  const plugin = fakePlugin();
  plugin.restorePurchases = async () => ({ entitlements: {} });
  setEnv({ shell: true, plugin });
  const seen = [];
  restorePass((r) => seen.push(r));
  await flush();
  assert.deepEqual(seen, [{ ok: false, state: 'notOwned' }]);
});

test('restorePass with no plugin returns false and never calls back', async () => {
  setEnv({ shell: true, plugin: null });
  let called = false;
  assert.equal(restorePass(() => { called = true; }), false);
  await flush();
  assert.equal(called, false);
});

test('reconcileWithServer never throws, whatever the network does', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const r = await reconcileWithServer();
  assert.equal(r.ok, false);
  assert.equal(r.entitled, false);
  assert.match(r.error, /offline/);
});

test('a non-JSON error page does not crash the reconcile', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });
  const r = await reconcileWithServer();
  assert.equal(r.ok, false);
  assert.match(r.error, /500/);
});

// ---------------------------------------------------------------------------
// logOut — so the next account does not transact as the previous one
// ---------------------------------------------------------------------------

test('logOutPurchases clears the SDK user and forces a fresh configure', async () => {
  const plugin = fakePlugin();
  let out = 0;
  plugin.logOut = async () => { out += 1; };
  setEnv({ shell: true, plugin });
  await configurePurchases({ apiKey: KEY, userId: 42 });
  assert.equal(plugin.calls.configure.length, 1);

  assert.equal(await logOutPurchases(), 'logged-out');
  assert.equal(out, 1);
  // The NEXT user must get a configure(), not be treated as already configured.
  assert.equal(await configurePurchases({ apiKey: KEY, userId: 77 }), 'configured');
  assert.deepEqual(plugin.calls.configure[1], { apiKey: KEY, appUserID: '77' });
});

test('logOutPurchases never blocks sign-out', async () => {
  // No plugin at all (web), and a plugin that throws (RevenueCat rejects logOut
  // for an already-anonymous user). Neither may throw into the caller.
  setEnv({ shell: true, plugin: null });
  assert.equal(await logOutPurchases(), 'no-plugin');

  const plugin = fakePlugin();
  plugin.logOut = async () => { throw new Error('already anonymous'); };
  setEnv({ shell: true, plugin });
  await configurePurchases({ apiKey: KEY, userId: 42 });
  assert.equal(await logOutPurchases(), 'error');
  // Still cleared locally, so the next user is configured fresh.
  assert.equal(await configurePurchases({ apiKey: KEY, userId: 77 }), 'configured');
});

test('camelCase states survive normalization (regression: they became "failed")', () => {
  // A one-word state set plus toLowerCase() quietly mapped 'notOwned' ->
  // 'notowned' -> not found -> 'failed'. Any future camelCase state would have
  // hit the same wall, so the canonical lookup is pinned here.
  assert.deepEqual(normalizePurchaseResult({ ok: false, state: 'notOwned' }), { ok: false, state: 'notOwned' });
  assert.deepEqual(normalizePurchaseResult({ ok: false, state: 'alreadyOwned' }), { ok: false, state: 'alreadyOwned' });
  // ...and case from the native bridge is tolerated in either direction.
  assert.deepEqual(normalizePurchaseResult({ ok: false, state: 'NOTOWNED' }), { ok: false, state: 'notOwned' });
  assert.deepEqual(normalizePurchaseResult({ ok: true, state: 'RESTORED' }), { ok: true, state: 'restored' });
});
