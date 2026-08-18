// lib/onboarding.test.mjs - who gets the sheet, and what step 2 asks. PURE.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  needsOnboarding, emailStep, isRelayAddress, validateContactEmail,
  normalizeName, preferredEmail,
} = await import('./onboarding.js');

const RELAY = 'cct5d48n7r@privaterelay.appleid.com';

// ---------------------------------------------------------------------------
// THE TRIGGER
// ---------------------------------------------------------------------------

test('THE HANDLE IS THE ONLY GATE - no handle, sheet shows', () => {
  assert.equal(needsOnboarding({ handle: null }), true);
  assert.equal(needsOnboarding({ handle: '' }), true);
  assert.equal(needsOnboarding({ handle: '   ' }), true, 'whitespace is not a handle');
  assert.equal(needsOnboarding({ handle: 'sportsvyn_og' }), false);
});

test('EXISTING USERS ARE CAUGHT BY THE SAME RULE - this is the backfill', () => {
  // 59 of 61 accounts have no handle. The trigger is a column, not a cookie, so
  // every one of them sees the sheet on next open without a migration or a
  // one-off script - and a second device does not re-prompt somebody who is
  // already done.
  const legacy = { id: 4, handle: null, email: RELAY, contact_email: null, name: 'Old User' };
  assert.equal(needsOnboarding(legacy), true);
  assert.equal(needsOnboarding({ ...legacy, handle: 'claimed' }), false);
});

test('a missing user is not onboarded', () => {
  assert.equal(needsOnboarding(null), false);
  assert.equal(needsOnboarding(undefined), false);
});

// ---------------------------------------------------------------------------
// STEP 2 - THE RELAY BRANCH
// ---------------------------------------------------------------------------

test('a REAL address prefills and confirms in one tap', () => {
  const s = emailStep({ email: 'someone@gmail.com' });
  assert.equal(s.mode, 'confirm');
  assert.equal(s.prefill, 'someone@gmail.com');
  assert.equal(s.skippable, true);
});

test('a RELAY address is NOT prefilled - the field starts empty', () => {
  // It is a forwarding alias the reader never sees. Prefilling would invite
  // them to confirm an address that stops the moment they revoke it in Apple
  // settings, and we would think we had a contact when we did not.
  const s = emailStep({ email: RELAY });
  assert.equal(s.mode, 'ask');
  assert.equal(s.prefill, '');
  assert.equal(s.skippable, true);
});

test('an address already supplied is shown as done, not asked for twice', () => {
  const s = emailStep({ email: RELAY, contact_email: 'real@me.com' });
  assert.equal(s.mode, 'done');
  assert.equal(s.prefill, 'real@me.com');
});

test('BOTH BRANCHES ARE SKIPPABLE - email never blocks completion', () => {
  for (const u of [{ email: RELAY }, { email: 'a@b.com' }, { email: null }, {}]) {
    assert.equal(emailStep(u).skippable, true, `${JSON.stringify(u)} must be skippable`);
  }
});

test('relay detection is case-insensitive and anchored to the end', () => {
  assert.equal(isRelayAddress(RELAY), true);
  assert.equal(isRelayAddress(RELAY.toUpperCase()), true);
  assert.equal(isRelayAddress('me@gmail.com'), false);
  // Not a relay address, despite containing the string.
  assert.equal(isRelayAddress('privaterelay.appleid.com@evil.com'), false);
  assert.equal(isRelayAddress(null), false);
});

// ---------------------------------------------------------------------------
// VALIDATION - loose on purpose
// ---------------------------------------------------------------------------

test('address validation rejects certain typos and allows the rest', () => {
  for (const bad of ['', '   ', 'nope', 'a@b', 'a b@c.com', 'two@at@c.com', 'a@.com', 'a@com.']) {
    assert.equal(validateContactEmail(bad).ok, false, `${JSON.stringify(bad)} should fail`);
  }
  // Deliberately permissive: only a bounce really decides deliverability, and a
  // regex lecturing somebody about their own address is worse than a bounce.
  for (const good of ['a@b.co', 'first.last+tag@sub.domain.org', 'x@y.museum']) {
    assert.equal(validateContactEmail(good).ok, true, `${good} should pass`);
  }
  assert.equal(validateContactEmail('  Me@Example.com  ').value, 'Me@Example.com', 'trimmed, not lowercased');
});

test('a blank name is a SKIP, not a clear', () => {
  assert.equal(normalizeName(''), null);
  assert.equal(normalizeName('   '), null);
  assert.equal(normalizeName('  Derik   Silva '), 'Derik Silva', 'whitespace collapsed');
  assert.equal(normalizeName('x'.repeat(200)).length, 60, 'capped');
});

// ---------------------------------------------------------------------------
// THE BROADCAST PREFERENCE
// ---------------------------------------------------------------------------

test('CONTACT EMAIL WINS OVER THE AUTH ADDRESS', () => {
  assert.equal(preferredEmail({ email: RELAY, contact_email: 'real@me.com' }), 'real@me.com');
  assert.equal(preferredEmail({ email: 'auth@me.com', contact_email: 'contact@me.com' }), 'contact@me.com');
});

test('and falls back to the auth address when none was supplied', () => {
  assert.equal(preferredEmail({ email: RELAY, contact_email: null }), RELAY);
  assert.equal(preferredEmail({ email: 'a@b.com' }), 'a@b.com');
  assert.equal(preferredEmail({}), null);
  assert.equal(preferredEmail(null), null);
});

// ---------------------------------------------------------------------------
// WHAT THE SHEET REPLACED
// ---------------------------------------------------------------------------

const { readFileSync: rf } = await import('node:fs');
const { fileURLToPath: f2u } = await import('node:url');
const pathMod = await import('node:path');
const REPO = pathMod.resolve(pathMod.dirname(f2u(import.meta.url)), '..');
const src = (p) => rf(pathMod.join(REPO, p), 'utf8');

test('WELCOMESHEET NO LONGER RENDERS - inverted, not deleted', () => {
  // It was a product pitch shown once per device to non-members. Both halves of
  // that premise died: the paywall is gone so "non-member" is everybody, and
  // the first-open surface is now the onboarding sheet, which asks for
  // something rather than selling something.
  //
  // The assertion is inverted rather than removed, per the standing pattern: a
  // test that merely disappeared would leave nothing saying the sheet must not
  // come back beside the one that replaced it. The component file survives -
  // deleting it would take its localStorage contract and its copy with it, and
  // one of those lines is now the signed-out hero's.
  const sim = src('app/sim/page.js');
  assert.equal(/<WelcomeSheet/.test(sim), false, 'no render site');
  assert.equal(/^import WelcomeSheet/m.test(sim), false, 'no import');
  // And nothing else mounts it either.
  for (const p of ['app/sim/tracker/page.js', 'app/sim/history/page.js',
    'app/sim/account/page.js', 'app/page.js']) {
    assert.equal(/<WelcomeSheet/.test(src(p)), false, `${p} still mounts it`);
  }
});

test('THE ONBOARDING SHEET IS MOUNTED WHERE THE OLD ONE WAS NOT - everywhere', () => {
  // The handle claim only ever existed inside The Daily, which is why two of
  // sixty-one accounts have one. The gate rides with the chrome instead.
  assert.match(src('components/GlobalHeaderServer.js'), /<OnboardingGate \/>/);
  for (const p of ['app/sim/page.js', 'app/sim/tracker/page.js', 'app/sim/history/page.js',
    'app/sim/account/page.js', 'app/sim/draft/[id]/page.js']) {
    assert.match(src(p), /<OnboardingGate \/>/, `${p} must mount the gate`);
  }
});

test('THE SHEET REUSES HandleClaim rather than a second claim UI', () => {
  // A second implementation is a second place for the denylist, the cooldown
  // and the uniqueness rules to drift.
  const sheet = src('components/onboarding/OnboardingSheet.js');
  assert.match(sheet, /from '@\/components\/daily\/HandleClaim'/);
  assert.equal(/validateHandle/.test(sheet), false, 'validation stays in the claim component');
});

test('ONBOARDING NEVER WRITES users.email - it is an auth key', () => {
  const actions = src('app/actions/onboarding.js');
  assert.match(actions, /contact_email/);
  assert.equal(/SET email =/.test(actions), false, 'auth identity must not be rewritten');
});
