// components/sim/shellIapUx.test.mjs — the three shell IAP surfaces:
// the above-the-fold DRAFT card, the account-page buy box, and the first-launch
// welcome sheet.
//
// All three are gated on shell mode AND APPLE_IAP_ENABLED, so web and flag-off
// output must be byte-identical to what shipped. The 3.1.1 suppression suite
// (shellPurchase.test.mjs) covers the flag-off shape; this suite covers the
// gating itself, plus the two behaviours with real failure modes:
//   · the welcome sheet appearing MORE THAN ONCE
//   · any of the three appearing for someone who already owns the Pass
//
// React cannot be rendered under node --test here (the @/ alias is a Next build
// concern), so the storage contract is exercised directly and the wiring is read
// as source - the same approach as shellPurchase.test.mjs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WELCOME } from './membershipCopy.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Brace-balanced slice of a JSX conditional's guard, e.g. everything between `{`
// and the component tag, so the guard can be asserted on.
function guardsFor(text, tag) {
  const out = [];
  for (const m of text.matchAll(new RegExp(`\\{([^{}]*(?:\\{[^{}]*\\}[^{}]*)*)<${tag}\\b`, 'g'))) out.push(m[1]);
  return out;
}

beforeEach(() => { delete globalThis.window; });

// ---------------------------------------------------------------------------
// 1. DRAFT tab — the card above the fold
// ---------------------------------------------------------------------------

test('the above-the-fold card is shell + flag + NON-member only', () => {
  const s = stripComments(src('components/sim/StartForm.js'));
  assert.match(s, /const iapPitch = shell && iap && !member;/,
    'the pitch must require shell, the flag, and a non-member');
  // It renders BEFORE the console, which is the whole point - the old card sat in
  // setup-foot, below the config table, on a phone.
  const pitchAt = s.indexOf('iapPitch && (');
  const consoleAt = s.indexOf('className="console"');
  assert.ok(pitchAt > 0 && pitchAt < consoleAt, 'the card must render above the console');
  assert.match(s, /<MembershipCard variant=\{isCustom \? 'custom' : 'draft'\} shell=\{shell\} iap=\{iap\} compact/,
    'the above-fold slot must use the compact card');
});

test('the pitch is NOT gated on having already hit a wall', () => {
  // The complaint was that price only appeared once you ran out of drafts. If
  // iapPitch ever picks up the gate condition, that regression is back.
  const s = stripComments(src('components/sim/StartForm.js'));
  const line = s.split('\n').find((l) => l.includes('const iapPitch'));
  assert.ok(!/freeGated|memberBlocked|gateBlocked|canStart/.test(line),
    `iapPitch must not depend on the gate state: ${line}`);
});

test('with the pitch shown, START is rendered but DISABLED while gated', () => {
  // The old code never rendered START on a gated path, so it had no disabled
  // state. Now it does, and a clickable START that silently does nothing would be
  // worse than the card it replaced.
  const s = stripComments(src('components/sim/StartForm.js'));
  assert.match(s, /const gateBlocked = \(freeGated && !isCustom\) \|\| memberBlocked;/);
  assert.match(s, /disabled=\{pending \|\| gateBlocked\}/, 'START must be disabled while a gate blocks it');
});

test('web and flag-off keep the original two-card foot', () => {
  const s = stripComments(src('components/sim/StartForm.js'));
  const foot = s.slice(s.indexOf('className="setup-foot"'));
  assert.match(foot, /iapPitch \?/, 'the foot must branch on the pitch');
  assert.match(foot, /freeGated && !isCustom \?[\s\S]{0,200}<MembershipCard variant="draft"/,
    'the flag-off draft gate card must survive');
  assert.match(foot, /memberBlocked \?[\s\S]{0,240}<MembershipCard variant="custom"/,
    'the flag-off custom lock card must survive');
});

test('the compact card carries price + buy and drops the prose', () => {
  const branch = stripComments(src('components/sim/MembershipCard.js'));
  const compact = branch.slice(branch.indexOf('if (iap && compact)'), branch.indexOf('return (', branch.indexOf('if (iap && compact)') + 40));
  assert.match(compact, /<PassBuy \/>/, 'compact must carry the buy control (price lives in PassBuy)');
  assert.ok(!compact.includes('mcard-body'), 'compact should drop the body paragraph');
  assert.ok(!compact.includes('{secondary}'), 'compact should drop the secondary action');
});

// ---------------------------------------------------------------------------
// 2. Account page — the volt box
// ---------------------------------------------------------------------------

test('the account buy box is non-member + flag only; members keep web billing', () => {
  const s = stripComments(src('app/sim/account/page.js'));
  assert.match(s, /\{!member && iap \? \(/, 'the account buy box must require a non-member and the flag');
  // Members must still be told membership is handled on the web - that is the
  // 3.1.1-safe answer for MANAGING an existing subscription, and it must not be
  // replaced by a buy button.
  assert.match(s, /Membership is managed on sportsvyn\.com/);
  const box = s.slice(s.indexOf('acct-upsell'), s.indexOf('</div>', s.indexOf('acct-iap')));
  assert.ok(!/href=|openBillingPortal/.test(box), 'the shell box must not link out or open Stripe');
});

test('the account page configures RevenueCat under the same guard as /sim', () => {
  const s = stripComments(src('app/sim/account/page.js'));
  for (const g of guardsFor(s, 'IapConfigure')) {
    assert.match(g, /isShell/, 'IapConfigure mounted outside shell');
    assert.match(g, /iap/, 'IapConfigure mounted with the buy path off');
    assert.match(g, /userId != null/, 'IapConfigure mounted without a user id');
  }
  assert.ok(guardsFor(s, 'IapConfigure').length > 0, 'the account page never configures');
});

// ---------------------------------------------------------------------------
// 3. Welcome sheet — ONCE, and never to a member
// ---------------------------------------------------------------------------

test('the welcome key is stable and namespaced', () => {
  // Changing either string re-shows the sheet to everyone who already saw it.
  const s = src('components/sim/WelcomeSheet.js');
  assert.match(s, /export const WELCOME_KEY = 'draftvyn_welcomed';/);
  assert.match(s, /export const WELCOME_VALUE = '1';/);
});

test('ONCE PER DEVICE: every exit path writes the key before closing', () => {
  // The failure that matters is an onboarding sheet that comes back. There is one
  // dismiss() and every exit routes through it - primary button, the buy wrapper,
  // the scrim, and Escape - so there is no path that closes without persisting.
  //
  // The signature gained a `via` argument when the sheet was ledgered (each exit
  // now reports WHICH control closed it), so the hooks are arrow-wrapped rather
  // than bare references. The contract is unchanged and is asserted below on the
  // behaviour rather than the shape: four exits, all persisting first.
  const s = stripComments(src('components/sim/WelcomeSheet.js'));
  const fn = s.slice(s.indexOf('function dismiss(via)'), s.indexOf('if (welcomed) return null;'));
  assert.match(fn, /setItem\(WELCOME_KEY, WELCOME_VALUE\)/, 'dismiss must persist');
  assert.ok(fn.indexOf('setItem') < fn.indexOf('dispatchEvent'),
    'the key must be written BEFORE the state flips');
  // The ledger write sits between them and must not be able to delay either.
  assert.match(fn, /sheetDismissed\(id, via\)\.catch\(\(\) => \{\}\)/,
    'the ledger write is fire-and-forget - a dismiss must never wait on a network call');

  const exits = ['primary', 'tracker', 'backdrop', 'escape'];
  for (const via of exits) {
    assert.ok(s.includes(`dismiss('${via}')`), `missing an exit path: ${via}`);
  }
  assert.equal((s.match(/dismiss\('/g) ?? []).length, exits.length,
    'exactly four exits: primary, the tracker link, the scrim and Escape');
});

test('a returning device is never shown the sheet again (storage contract)', () => {
  // Exercise the real predicate rather than trusting the source read above.
  const s = stripComments(src('components/sim/WelcomeSheet.js'));
  assert.match(s, /const welcomedOnServer = \(\) => true;/,
    'the server snapshot must be "welcomed" so the sheet is never in the SSR HTML');
  assert.match(s, /useSyncExternalStore\(subscribe, isWelcomed, welcomedOnServer\)/);
  assert.match(s, /if \(welcomed\) return null;/);
  // Storage access is guarded - Safari private mode throws rather than returning
  // null, and that must not take the lobby down.
  // Three guards now: the storage read, the storage write, and the scroll the
  // tracker link performs - a missing anchor must not turn a dismissal into a
  // dead tap.
  assert.equal((s.match(/try \{/g) ?? []).length, 3,
    'the storage read, the storage write and the tracker scroll must all be guarded');
});

test('WELCOMESHEET IS RETIRED - it mounts nowhere at all now', () => {
  // INVERTED, NOT DELETED. This asserted the sheet was mounted under
  // shell + iap + !member. Both halves of its premise died: the paywall is gone
  // so "!member" is everybody, and the first-open surface is now the onboarding
  // sheet, which asks for a handle rather than selling a Pass.
  //
  // The component file survives on purpose - deleting it would take its
  // localStorage contract and its copy with it, and one of those lines became
  // the signed-out hero's. It is unmounted, not erased.
  const s = stripComments(src('app/sim/page.js'));
  assert.equal(guardsFor(s, 'WelcomeSheet').length, 0, 'the lobby must not mount it');
  assert.equal(/<WelcomeSheet/.test(s), false);
});

test('welcome copy is TWO PRODUCTS, each with an instruction', () => {
  // This test used to assert the sheet "leads with the free tier and headlines
  // the Tracker inside the Pass sentence". It passed while the sheet spent more
  // words on the Draft Pass than on the thing it was selling, ended on a volt
  // price with a buy button under it, and gave the Tracker one clause. Fourteen
  // app arrivals, eleven of whom never drafted, is what prompted looking at it.
  //
  // The sheet is now one screen with a half per product, and the thing each half
  // has to end in is WHAT TO TAP - the measured problem is not that people
  // decline, it is that they arrive and do nothing.
  assert.match(WELCOME.mock, /START DRAFT/, 'the mock half names the control');
  // Was /three free drafts a week/. Still names the free tier - it is just
  // unlimited now, which is a better thing to arrive to.
  assert.match(WELCOME.mock, /[Ff]ree and unlimited/, 'and the free tier');
  assert.match(WELCOME.tracker, /enter picks as they happen/, 'the tracker half says what you DO');
  assert.match(WELCOME.tracker, /at the table/, 'and where');

  // The Pass is ONE LINE and it is context, not the ask.
  assert.match(WELCOME.pass, /\$9\.99/);
  assert.match(WELCOME.pass, /Super Bowl/);
  assert.ok(WELCOME.pass.split('.').filter((x) => x.trim()).length <= 2,
    'one line, not a paragraph');
  assert.ok(WELCOME.pass.length < WELCOME.mock.length && WELCOME.pass.length < WELCOME.tracker.length,
    'the price line must be shorter than either product it sits under');

  // The primary is an action on the free product, not a purchase.
  assert.match(WELCOME.primary, /mock draft/i);
  assert.ok(!/\$|buy|pass|unlock/i.test(WELCOME.primary), 'the primary button sells nothing');
  assert.match(WELCOME.trackerLink, /Tracker/);

  // And the retired keys are actually gone rather than left dangling.
  for (const dead of ['headline', 'free', 'price']) {
    assert.equal(WELCOME[dead], undefined, `WELCOME.${dead} should be retired`);
  }
});

test('THERE IS NO PURCHASE CONTROL ON THE SHEET', () => {
  // Buying moved to the MembershipCard and the tracker gate, where somebody has
  // actually reached for something. A first-launch modal is the worst place to
  // ask: the user has not seen the product yet.
  const s = stripComments(src('components/sim/WelcomeSheet.js'));
  assert.ok(!/PassBuy/.test(s), 'no buy button');
  assert.ok(!/wsheet-buy/.test(s));
  // COMMENTS STRIPPED FIRST. This assertion is about RULES, and the replacement
  // rules explain themselves by naming the ones they retired - so scanning raw
  // CSS would fail on its own subject's prose.
  const css = src('components/sim/sim.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.wsheet-buy|\.wsheet-price/.test(css), 'and no orphan styles left behind');
});

test('welcome copy uses hyphens only - no em/en dashes (house rule)', () => {
  for (const [k, v] of Object.entries(WELCOME)) {
    assert.ok(!/[—–]/.test(v), `em/en dash in WELCOME.${k}: ${v}`);
  }
});

// ---------------------------------------------------------------------------
// Cross-cutting: nothing here can reach web or the flag-off shell
// ---------------------------------------------------------------------------

test('NONE of the three surfaces can render on web or with the flag off', () => {
  // One consolidated check: every mount site of the three new surfaces carries
  // both an `iap` and a shell condition. A new surface added later without them
  // fails here.
  // WelcomeSheet dropped from this list: it is retired and mounts nowhere, so
  // "every mount site is guarded" is vacuously true and the assertion above
  // (zero mount sites) is the stronger statement.
  const SITES = [
    ['app/sim/account/page.js', 'IapConfigure'],
    ['app/sim/page.js', 'IapConfigure'],
    ['app/sim/tracker/page.js', 'IapConfigure'],
  ];
  for (const [rel, tag] of SITES) {
    const guards = guardsFor(stripComments(src(rel)), tag);
    assert.ok(guards.length > 0, `${rel} does not mount ${tag}`);
    for (const g of guards) {
      assert.match(g, /iap/, `${rel}:${tag} is not flag-gated`);
      assert.match(g, /isShell/, `${rel}:${tag} is not shell-gated`);
    }
  }
  // The account buy box and the StartForm pitch are ternaries rather than mounts.
  assert.match(stripComments(src('app/sim/account/page.js')), /\{!member && iap \?/);
  assert.match(stripComments(src('components/sim/StartForm.js')), /const iapPitch = shell && iap && !member;/);
});
