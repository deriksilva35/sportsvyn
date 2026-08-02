// components/sim/appleIapCard.test.mjs — the in-app buy path on the gate cards.
//
// Apple rejected 1.0(2) twice under 3.1.1. The first time for selling outside the
// app; the second time - after every purchase path was removed - for the other
// half of the same guideline: the app READS membership-gated content, so the
// membership must be BUYABLE in the app. Hence a buy control on the shell cards.
//
// The whole thing is behind APPLE_IAP_ENABLED, DEFAULT OFF, because the server
// half ships now and the StoreKit binary ships later. Two states must therefore
// both be correct, and the tests below cover both:
//
//   FLAG OFF (today, and for the whole life of the shipped 1.0(2) build)
//     - the neutral suppressed card, exactly as 76e18e0 left it. The 3.1.1 suite
//       (shellPurchase.test.mjs) runs against this state and must stay green.
//   FLAG ON (once the IAP binary is live)
//     - price + buy, going through StoreKit, and STILL no web link, no Stripe,
//       no plan ladder.
//
// React components cannot be rendered under node --test here (the @/ alias is a
// Next build concern), so the wiring is read as source - same approach, and same
// blunt honesty, as shellPurchase.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPLE_IAP_ENABLED_ENV, APPLE_RC_KEY_ENV, PASS_PRODUCT_ID_ENV,
  DEFAULT_PASS_PRODUCT_ID, appleIapEnabled, appleIapConfig,
} from '../../lib/appleIap.js';
import {
  APPLE_PASS_PRICE, MEMBERSHIP_CARD_IAP, MEMBERSHIP_CARD_SHELL,
  MEMBERSHIP_CARD_VARIANTS, MEMBERSHIP_PRICE_LINE, PASS_BUY,
} from './membershipCopy.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Brace-balanced slice of `if (shell) { ... }` — copied deliberately from
// shellPurchase.test.mjs rather than shared, so a change to that suite's helper
// cannot quietly change what THIS suite is asserting about the same file.
function shellBranch(text) {
  const m = /if\s*\(\s*(shell|isShell)\s*\)\s*\{/.exec(text);
  if (!m) return null;
  let depth = 0;
  const start = m.index + m[0].length - 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(path.join(REPO, dir))) {
    const rel = path.posix.join(dir, entry);
    if (statSync(path.join(REPO, rel)).isDirectory()) walk(rel, out);
    else if (entry.endsWith('.js')) out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

test('APPLE_IAP_ENABLED defaults OFF - unset, empty, and every falsy spelling', () => {
  // A flag that gates a purchase surface must never be enabled by accident.
  for (const env of [{}, undefined, { [APPLE_IAP_ENABLED_ENV]: '' }, { [APPLE_IAP_ENABLED_ENV]: '0' },
    { [APPLE_IAP_ENABLED_ENV]: 'false' }, { [APPLE_IAP_ENABLED_ENV]: 'no' },
    { [APPLE_IAP_ENABLED_ENV]: 'off' }, { [APPLE_IAP_ENABLED_ENV]: 'enabled' },
    { [APPLE_IAP_ENABLED_ENV]: 'TODO' }, { [APPLE_IAP_ENABLED_ENV]: 1 }, { [APPLE_IAP_ENABLED_ENV]: true }]) {
    assert.equal(appleIapEnabled(env), false, `env ${JSON.stringify(env)} enabled the buy path`);
  }
});

test('APPLE_IAP_ENABLED turns on for the documented truthy strings only', () => {
  for (const v of ['1', 'true', 'TRUE', ' yes ', 'on', 'On']) {
    assert.equal(appleIapEnabled({ [APPLE_IAP_ENABLED_ENV]: v }), true, `"${v}" did not enable`);
  }
});

test('the flag is a SERVER env var, threaded as a prop', () => {
  assert.equal(APPLE_IAP_ENABLED_ENV, 'APPLE_IAP_ENABLED');
  assert.ok(!APPLE_IAP_ENABLED_ENV.startsWith('NEXT_PUBLIC_'),
    'a NEXT_PUBLIC_ flag is inlined at build time; this one must be flippable by env alone');
  // The client components must not reach for the environment themselves.
  for (const rel of ['components/sim/MembershipCard.js', 'components/sim/PassBuy.js']) {
    assert.ok(!stripComments(src(rel)).includes('process.env'), `${rel} reads process.env`);
  }
});

// ---------------------------------------------------------------------------
// FLAG OFF — the suppressed card is untouched
// ---------------------------------------------------------------------------

test('with the flag off the shell card constructs NO purchase affordance', () => {
  const branch = shellBranch(src('components/sim/MembershipCard.js'));
  assert.ok(branch, 'no shell branch found in MembershipCard');
  // Everything the 3.1.1 fix removed must still be absent.
  assert.ok(!branch.includes('/membership'), 'shell branch links to the pricing page');
  assert.ok(!branch.includes('MEMBERSHIP_PRICE_LINE'), 'shell branch renders the web price ladder');
  assert.ok(!/mcard-cta/.test(branch), 'shell branch renders the SEE PLANS CTA');
  assert.ok(!/target=["']_blank/.test(branch), 'shell branch opens an external tab');
  assert.ok(branch.includes('MEMBERSHIP_CARD_SHELL'), 'the neutral copy must survive as the off state');
  // And the buy control must be behind the flag, not merely hidden by CSS.
  assert.match(branch, /iap \? <PassBuy \/> : null/, 'PassBuy must be gated on the iap flag');
  assert.match(branch, /iap \? MEMBERSHIP_CARD_IAP\[key\]\.body : s\.body/,
    'the IAP body must be gated on the flag too - the neutral body is the off state');
});

test('PassBuy is the ONLY thing the flag adds (no second buy path)', () => {
  const card = stripComments(src('components/sim/MembershipCard.js'));
  const branch = shellBranch(card);
  // There are legitimately TWO usages now - the compact above-the-fold card and
  // the full one - so the invariant is not a count. It is that EVERY usage lives
  // inside the shell branch and behind the flag, and that the web card has none.
  const total = (card.match(/<PassBuy/g) ?? []).length;
  const inShell = (branch.match(/<PassBuy/g) ?? []).length;
  assert.ok(total > 0, 'nothing renders the buy control');
  assert.equal(inShell, total, 'a PassBuy escaped the shell branch');
  const web = card.slice(card.indexOf(branch) + branch.length);
  assert.ok(!web.includes('<PassBuy'), 'the WEB card renders the IAP buy control');
  // Each usage is reached only under `iap`: the compact card is behind
  // `if (iap && compact)`, the full one behind the `iap ? ... : null` ternary.
  assert.match(branch, /if \(iap && compact\)/, 'the compact card must be flag-gated');
  assert.match(branch, /iap \? <PassBuy \/> : null/, 'the full card must be flag-gated');
});

// ---------------------------------------------------------------------------
// FLAG ON — buying goes through StoreKit and nowhere else
// ---------------------------------------------------------------------------

test('the buy control goes through the native bridge, never to the web', () => {
  const s = stripComments(src('components/sim/PassBuy.js'));
  assert.match(s, /purchasePass/, 'must call the purchase bridge');
  // A real route reference, not the './membershipCopy' import - matching the bare
  // substring flagged that import and made this assertion meaningless.
  assert.ok(!/["'`]\/membership(["'`?#]|$)/m.test(s), 'the buy control links to the web pricing page');
  assert.ok(!/stripe/i.test(s), 'the buy control references Stripe');
  assert.ok(!/https?:\/\//.test(s), 'the buy control constructs an external URL');
  assert.ok(!/<a\s/.test(s), 'the buy control renders an anchor - IAP must be a button');
});

test('the buy button only renders when the native bridge actually exists', () => {
  // Otherwise flipping the flag while the old binary is live puts a dead control
  // on a purchase surface - a worse 3.1.1 answer than the suppressed card.
  const s = stripComments(src('components/sim/PassBuy.js'));
  assert.match(s, /canPurchaseInApp/, 'must feature-detect the bridge');
  assert.match(s, /if \(!hasBridge\) return null;/, 'must render nothing without a bridge');
  assert.ok(s.indexOf('canPurchaseInApp') < s.indexOf('<button'),
    'the bridge check must precede the button');
});

test('entitlement is NEVER granted client-side after a purchase', () => {
  // StoreKit success means Apple took the money; the Pass arrives when the
  // RevenueCat webhook writes the row. A local unlock would be spoofable and
  // would diverge from what the server believes.
  const s = stripComments(src('components/sim/PassBuy.js'));
  assert.match(s, /router\.refresh\(\)/, 'success must re-read entitlement from the server');
  assert.ok(!/localStorage|document\.cookie|sessionStorage/.test(s),
    'the buy control persists entitlement client-side');
  assert.ok(!/setEntitled|setMember|setUnlocked/.test(s), 'the buy control grants access locally');
});

test('every purchase outcome has copy - no silent dead end', () => {
  // purchaseBridge normalizes to exactly these states; each needs something to say.
  for (const state of ['cancelled', 'pending', 'unavailable', 'failed']) {
    assert.equal(typeof PASS_BUY[state], 'string', `no copy for the "${state}" outcome`);
    assert.ok(PASS_BUY[state].length > 0);
  }
  assert.match(PASS_BUY.unlocking, /unlock/i, 'success copy should say it is unlocking, not unlocked');
  assert.ok(!/unlocked\b/i.test(PASS_BUY.unlocking),
    'success copy must not claim the Pass is already active - the webhook may not have landed');
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

test('the IAP price matches the web Draft Pass price - no disparity to explain', () => {
  assert.equal(APPLE_PASS_PRICE, '$9.99');
  assert.ok(MEMBERSHIP_PRICE_LINE.startsWith(APPLE_PASS_PRICE),
    'the web ladder no longer opens at the IAP price');
});

test('every shell variant has IAP copy (none can fall through to a missing body)', () => {
  // MembershipCard indexes MEMBERSHIP_CARD_IAP[key] unguarded when the flag is on;
  // a missing variant would be a crash on a gate, in the app, in front of Apple.
  for (const key of Object.keys(MEMBERSHIP_CARD_SHELL)) {
    assert.ok(MEMBERSHIP_CARD_IAP[key], `variant "${key}" has no IAP copy`);
    assert.equal(typeof MEMBERSHIP_CARD_IAP[key].body, 'string');
  }
  for (const key of Object.keys(MEMBERSHIP_CARD_VARIANTS)) {
    assert.ok(MEMBERSHIP_CARD_IAP[key], `web variant "${key}" has no IAP counterpart`);
  }
});

test('IAP copy names no OTHER plan and no web destination', () => {
  // One product is buyable in the app. Naming Suite or Founding - which are not
  // available via IAP - is the exact thing 3.1.1 objects to.
  const all = [...Object.values(MEMBERSHIP_CARD_IAP).map((v) => v.body), ...Object.values(PASS_BUY)].join(' ');
  assert.ok(!/Football Suite|Founding/i.test(all), 'IAP copy names a plan that is not sold via IAP');
  assert.ok(!/sportsvyn\.com|membership page|see plans/i.test(all), 'IAP copy steers to the web');
});

test('copy uses hyphens only - no em/en dashes (house rule)', () => {
  const all = [...Object.values(MEMBERSHIP_CARD_IAP).map((v) => v.body), ...Object.values(PASS_BUY), APPLE_PASS_PRICE];
  for (const v of all) assert.ok(!/[—–]/.test(v), `em/en dash in: ${v}`);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const CARD_HOSTS = ['app/sim/page.js', 'app/sim/tracker/page.js'];

test('every page rendering a gate card resolves the flag server-side', () => {
  for (const rel of CARD_HOSTS) {
    const s = stripComments(src(rel));
    assert.match(s, /appleIapConfig/, `${rel} renders a gate card without resolving the IAP config`);
    assert.match(s, /iap=\{/, `${rel} does not thread the iap prop`);
  }
});

// ---------------------------------------------------------------------------
// Configuration wiring — the anonymous-id rule, enforced at the mount site
// ---------------------------------------------------------------------------

test('IapConfigure is NEVER mounted without a known user id', () => {
  // If the SDK configures anonymously it invents an $RCAnonymousID, the purchase
  // webhook arrives carrying it, and the server refuses the event by design -
  // Apple has taken the money and there is no account to attribute it to.
  for (const rel of CARD_HOSTS) {
    const s = stripComments(src(rel));
    assert.match(s, /<IapConfigure/, `${rel} never configures RevenueCat`);
    for (const m of s.matchAll(/\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)<IapConfigure/g)) {
      assert.match(m[1], /userId != null/, `${rel} mounts IapConfigure without a userId guard`);
      assert.match(m[1], /isShell/, `${rel} mounts IapConfigure outside shell mode`);
      assert.match(m[1], /iap/, `${rel} mounts IapConfigure with the buy path disabled`);
    }
  }
});

test('the configurator itself refuses to configure anonymously', () => {
  const s = stripComments(src('lib/shell/purchaseBridge.js'));
  const fn = s.slice(s.indexOf('export async function configurePurchases'));
  assert.match(fn, /return 'no-user'/, 'configurePurchases has no missing-user path');
  assert.ok(fn.indexOf("return 'no-user'") < fn.indexOf('.configure('),
    'the user-id check must precede the configure call');
  assert.match(fn, /logIn/, 'late sign-in must go through logIn');
});

test('the appl_ key is validated, so a bad key suppresses instead of breaking', () => {
  // Fail closed: the flag on with a missing or wrong key must render the neutral
  // card, never a button that dies inside StoreKit. The expensive mistake this
  // catches is the SECRET key pasted into the public slot.
  const base = { [APPLE_IAP_ENABLED_ENV]: '1' };
  for (const bad of [undefined, '', '   ', 'sk_live_whatever', 'appl_', 'REPLACE_ME', 'goog_abcdefghij']) {
    const cfg = appleIapConfig({ ...base, [APPLE_RC_KEY_ENV]: bad });
    assert.equal(cfg.enabled, false, `key ${JSON.stringify(bad)} enabled the buy path`);
    assert.equal(cfg.apiKey, null);
  }
  const good = appleIapConfig({ ...base, [APPLE_RC_KEY_ENV]: 'appl_AbCdEfGhIjKl' });
  assert.equal(good.enabled, true);
  assert.equal(good.apiKey, 'appl_AbCdEfGhIjKl');
  // ...and the flag still governs: a perfect key with the flag off stays off.
  assert.equal(appleIapConfig({ [APPLE_RC_KEY_ENV]: 'appl_AbCdEfGhIjKl' }).enabled, false);
});

test('the product id has ONE source, shared by the webhook and the bridge', () => {
  // The client bridge cannot import lib/revenuecat.js (node:crypto), so the id
  // lives in lib/appleIap.js and both sides read it from there. A second literal
  // would silently sell the wrong product.
  assert.equal(appleIapConfig({}).productId, DEFAULT_PASS_PRODUCT_ID);
  assert.equal(appleIapConfig({ [PASS_PRODUCT_ID_ENV]: 'com.other.pass' }).productId, 'com.other.pass');
  const bridge = stripComments(src('lib/shell/purchaseBridge.js'));
  assert.match(bridge, /from '\.\.\/appleIap\.js'/, 'the bridge must import the shared product id');
  assert.ok(!/com\.sportsvyn\.draftvyn/.test(bridge), 'the bridge hardcodes a product id');
});

test('the iap prop is threaded, never defaulted ON anywhere', () => {
  // A component defaulting iap = true would enable the buy path for any caller
  // that forgot the prop.
  for (const rel of walk('components').concat(walk('app'))) {
    const s = stripComments(src(rel));
    for (const m of s.matchAll(/iap\s*=\s*(true|1)\b/g)) {
      assert.fail(`${rel} defaults iap to ${m[1]}`);
    }
  }
  for (const rel of ['components/sim/MembershipCard.js', 'components/sim/StartForm.js', 'components/sim/TrackerStart.js']) {
    assert.match(stripComments(src(rel)), /iap = false/, `${rel} must default iap to false`);
  }
});
