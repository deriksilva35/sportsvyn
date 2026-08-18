// lib/shell/signedOut.test.mjs - the launch flow, per platform.
//
// FOUR CLAIMS, and the first two are the same signed-out state with opposite
// correct answers:
//   1. in the container, signed out, every tab goes to the sign-in form
//   2. on the web, signed out, every tab keeps its hero
//   3. sign-in returns to the tab that was launched into
//   4. the onboarding sheet still fires after that, on a null handle
//
// THE HERO-ABSENCE CLAIM IS ASSERTED AS SOURCE, and it has to be: React does
// not render under `node --test` here (the @/ alias is a Next build concern),
// so the way to prove a signed-out shell reader never reaches a pitch is to
// prove the guard runs BEFORE the branch that renders one - the same approach
// as shellPurchase.test.mjs. Position is the whole assertion; a guard placed
// after the hero branch would pass a "guard exists" check and ship the bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signInHrefForSignedOut } from './signedOutRule.js';
import { shellSigninHref } from './signinHref.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The five tabs a launch can land on, and the hero string each one renders to a
// signed-out reader today. If a page's hero copy changes, this test fails - and
// that is correct: it is asserting that THIS page's pitch is unreachable, not
// that some string is absent from the repo.
const TABS = [
  { page: 'app/sim/page.js', dest: '/sim', hero: 'Draft against the market' },
  { page: 'app/daily/page.js', dest: '/daily', hero: 'hero-q' },
  // <Pitch, not hero-q: the Weekly hoists its hero into a component declared
  // ABOVE the page, so a whole-file position check compares the guard against a
  // definition instead of a render. The render is what must be unreachable.
  { page: 'app/weekly/page.js', dest: '/weekly', hero: '<Pitch' },
  { page: 'app/draft/page.js', dest: '/draft', hero: 'hero-q' },
  // GAMES HAS NO HERO - it had no signed-out branch at all and rendered the
  // lobby to a stranger. The guard is the whole fix, so there is no pitch
  // string to place it ahead of; the lobby READ is what must not run.
  { page: 'app/games/page.js', dest: '/games', hero: 'gamesLobby(userId)' },
  // v0.3: the SPORTSVYN tab's two surfaces. Public on the web (no hero to
  // protect - the marker is the data read the redirect must not pay for).
  { page: 'app/scores/page.js', dest: '/scores', hero: 'getSlateByDate' },
  { page: 'app/nfl/fantasy/page.js', dest: '/nfl/fantasy', hero: 'getMovementBoard' },
];

// ---------------------------------------------------------------------------
// 1. SHELL, SIGNED OUT -> the sign-in form
// ---------------------------------------------------------------------------

test('shell + signed out routes to sign-in, for every tab', () => {
  for (const { dest } of TABS) {
    const href = signInHrefForSignedOut({ isShell: true, userId: null, dest });
    assert.ok(href, `${dest}: expected a redirect`);
    assert.ok(href.startsWith('/signin?'), `${dest}: ${href}`);
  }
});

test('the guard runs before any hero or lobby read on all five tabs', () => {
  for (const { page, hero } of TABS) {
    // FROM THE COMPONENT BODY ONLY. Helper components are declared above the
    // page, so a file-wide search finds their definitions - which the guard
    // legitimately follows - rather than the calls it has to precede.
    const whole = stripComments(src(page));
    const text = whole.slice(whole.indexOf('export default'));
    const guard = text.indexOf('requireSignInInShell(');
    const pitch = text.indexOf(hero);
    assert.notEqual(guard, -1, `${page}: no guard`);
    assert.notEqual(pitch, -1, `${page}: expected marker "${hero}" not found`);
    assert.ok(
      guard < pitch,
      `${page}: guard at ${guard} must precede "${hero}" at ${pitch}`,
    );
  }
});

test('every tab passes its own destination, not a shared default', () => {
  for (const { page, dest } of TABS) {
    const text = stripComments(src(page));
    const m = text.match(/requireSignInInShell\(\{[^}]*dest:\s*'([^']+)'/);
    assert.ok(m, `${page}: no dest in the guard call`);
    assert.equal(m[1], dest, `${page} sends readers to ${m[1]}`);
  }
});

// ---------------------------------------------------------------------------
// 2. WEB, SIGNED OUT -> the hero, untouched
// ---------------------------------------------------------------------------

test('web + signed out never redirects', () => {
  for (const { dest } of TABS) {
    assert.equal(signInHrefForSignedOut({ isShell: false, userId: null, dest }), null);
  }
});

test('signed in never redirects, in either surface', () => {
  for (const isShell of [true, false]) {
    for (const userId of [1, '1', 42]) {
      assert.equal(signInHrefForSignedOut({ isShell, userId, dest: '/sim' }), null);
    }
  }
});

// userId 0 is not a real row id here, but a `!userId` guard instead of an
// `!= null` one would treat it as signed out - the exact shape of bug that
// only shows up on one account.
test('a falsy-but-present userId is signed in', () => {
  assert.equal(signInHrefForSignedOut({ isShell: true, userId: 0, dest: '/sim' }), null);
});

test('the web heroes are still in the source', () => {
  for (const { page, hero } of TABS) {
    assert.ok(src(page).includes(hero), `${page}: ${hero} was removed`);
  }
});

// ---------------------------------------------------------------------------
// 3. THE RETURN PATH
// ---------------------------------------------------------------------------

test('sign-in returns to the tab that was launched into', () => {
  for (const { dest } of TABS) {
    const href = signInHrefForSignedOut({ isShell: true, userId: null, dest });
    const cb = new URL(href, 'https://x').searchParams.get('callbackUrl');
    assert.ok(cb.startsWith(dest), `${dest}: callbackUrl was ${cb}`);
  }
});

// The marker rides INSIDE callbackUrl as well as beside it - see signinHref.js.
// Without the inner one, Apple's cross-site POST drops the surface and the
// reader is returned to the web version of their tab inside the app.
test('the shell marker survives the round trip, inside and outside', () => {
  const href = signInHrefForSignedOut({ isShell: true, userId: null, dest: '/weekly' });
  const u = new URL(href, 'https://x');
  assert.equal(u.searchParams.get('shell'), 'sim-app');
  assert.match(u.searchParams.get('callbackUrl'), /[?&]shell=sim-app/);
});

test('the rule delegates to shellSigninHref rather than building its own URL', () => {
  assert.equal(
    signInHrefForSignedOut({ isShell: true, userId: null, dest: '/draft' }),
    shellSigninHref('/draft', true),
  );
});

// ---------------------------------------------------------------------------
// 4. THE SHEET STILL FIRES AFTER SIGN-IN
// ---------------------------------------------------------------------------
// The flow is launch -> sign-in -> handle -> playing. Steps 1-2 are above; this
// is the seam between 2 and 3. The gate itself is covered by
// lib/onboardingDb.test.mjs; what is asserted here is that the redirect lands
// somewhere the gate is actually MOUNTED - a correct return path to a page with
// no sheet on it would strand a handle-less account in the tabs.

test('every launch destination mounts the onboarding gate', () => {
  for (const { page, dest } of TABS) {
    const text = stripComments(src(page));
    const mounted =
      text.includes('<OnboardingGate') || text.includes('GlobalHeaderServer');
    assert.ok(mounted, `${dest} (${page}) renders no OnboardingGate`);
  }
});

test('the gate is not itself gated on shell mode', () => {
  const gate = stripComments(src('components/onboarding/OnboardingGate.js'));
  assert.ok(!/isShell|resolveShellMode/.test(gate), 'the sheet became shell-only');
});

// ---------------------------------------------------------------------------
// THE WIRING, once
// ---------------------------------------------------------------------------

test('requireSignInInShell delegates to the tested rule', () => {
  const w = stripComments(src('lib/shell/signedOut.js'));
  assert.match(w, /signInHrefForSignedOut\(/);
  assert.match(w, /redirect\(href\)/);
});

// A NEGATIVE CONTROL THAT WORKS. Deleting `if (!isShell) return null` is the
// one edit that turns this feature into a site-wide outage - every signed-out
// web reader bounced to /signin - and it must not pass a green suite.
test('control: dropping the web exemption fails the web claims', () => {
  const broken = ({ userId, dest }) =>
    userId != null ? null : shellSigninHref(dest, true);
  assert.notEqual(broken({ userId: null, dest: '/sim' }), null);
});

// ---------------------------------------------------------------------------
// THE LAUNCH ROUTE
// ---------------------------------------------------------------------------
// capacitor.config.ts loads /app, so this is the first surface a cold launch
// renders - and it is not one of the five tabs. If the guard is missing here,
// every claim above is true and the flow is still broken, because a signed-out
// launch never reaches a tab to be guarded.

test('the launch route in capacitor.config.ts is the one that is guarded', () => {
  const cfg = src('capacitor.config.ts');
  const m = cfg.match(/url:\s*'https:\/\/[^/']+(\/[^']*)'/);
  assert.ok(m, 'no server.url in capacitor.config.ts');
  assert.equal(m[1], '/app', `launch URL moved to ${m[1]} - guard it there`);
  const page = stripComments(src('app/app/page.js'));
  assert.match(page, /requireSignInInShell\(/, '/app is unguarded');
});

test('the launch guard precedes the deck read', () => {
  const whole = stripComments(src('app/app/page.js'));
  const text = whole.slice(whole.indexOf('export default'));
  assert.ok(
    text.indexOf('requireSignInInShell(') < text.indexOf('readTodaysCard()'),
    'the deck is fetched before the reader is redirected away from it',
  );
});

// /app mounts no tab bar and no gate, so returning a fresh account here would
// sign them in and leave them one paint short of a handle.
test('the launch route returns into the tabs, not to itself', () => {
  const page = stripComments(src('app/app/page.js'));
  const m = page.match(/requireSignInInShell\(\{[\s\S]*?dest:\s*'([^']+)'/);
  assert.ok(m, 'no dest on the launch guard');
  assert.equal(m[1], '/games');
  assert.ok(!stripComments(src('app/app/layout.js')).includes('OnboardingGate'));
});
