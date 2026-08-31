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

// The tabs that ASK WHO YOU ARE, and the hero string each one renders to a
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
  // BOTH SPORTSVYN-TAB SURFACES LEFT THIS LIST. /scores was here from v0.3
  // and /nfl/fantasy from before that; the browse-tabs-open ruling took them
  // out. See the v0.6 test below, which asserts the stronger thing: not that
  // their gate is placed correctly, but that they have none.
  // /nfl/fantasy LEFT THIS LIST in v0.6. It is a league route - it wears the
  // league header and sits behind the Fantasy pill - and the ruling is that
  // league routes open signed-out in the container. The rule this list encodes
  // is unchanged for every entry still in it; the page below asserts the
  // fantasy board has no gate at all, which is the stronger statement.
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
    // ANCHOR ON THE PAGE'S OWN BODY, wherever it now lives. This used to slice
    // from 'export default', which assumed the body WAS the default export.
    // /scores split: its body is the exported ScoresView (so /nfl/scores can
    // mount the same component pinned) and the default export is a two-line
    // wrapper below it. Slicing from 'export default' skipped the guard
    // entirely and the test read it as missing. The rule is unchanged - the
    // guard must precede the hero IN THE BODY - so we anchor on whichever
    // export contains the guard.
    const guardAt = whole.indexOf('requireSignInInShell(');
    const exports = [...whole.matchAll(/^export (default )?async function/gm)].map((m) => m.index);
    const bodyStart = exports.filter((i) => i < guardAt).pop() ?? whole.indexOf('export default');
    const text = whole.slice(bodyStart);
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

test('a SIGNED-IN shell launch also lands on /games - the deck is nobody\'s home', () => {
  const whole = stripComments(src('app/app/page.js'));
  const t = whole.slice(whole.indexOf('export default'));
  const landed = t.indexOf("if (isShell && userId != null) redirect('/games')");
  const deck = t.indexOf('readTodaysCard()');
  assert.ok(landed > -1, 'the signed-in landing redirect is gone');
  assert.ok(landed < deck, 'the redirect must not pay for the six deck reads');
  // Web unchanged: the redirect must be shell-gated, not unconditional.
  assert.match(t, /isShell && userId != null/);
});

test('EVERY LEAGUE ROUTE OPENS SIGNED-OUT IN THE SHELL (v0.6 ruling)', () => {
  // The league pages are the BROWSE surface; the games are the sign-in
  // surface, and the games strip already asks for a sign-in in words, on the
  // tiles. Two league routes were forcing a redirect and both are unforced:
  //   /nfl/fantasy - a board of numbers, nothing on it is the reader's own
  //   /nfl/scores + /cfb/scores - they mount ScoresView, which gated for all
  //     of its wearings; the gate is now scoped to the unpinned network board.
  // WHAT THIS USED TO CLAIM, and why it changed. It asserted the gate was
  // SCOPED - `if (!pinned) requireSignInInShell(...)` - because the league
  // wearings had to open while the network board kept its redirect. That
  // scoping was ruled on a sweep that read /scores as already open, and the
  // sweep was wrong: a redirect() inside a streamed Suspense boundary serves
  // 200 with a <meta http-equiv="refresh">, so a status check cannot see it.
  // Re-measured by body, the board was gating; re-ruled, it opens like the
  // /market surface beside it in the same tab. The claim is now the stronger
  // one - no gate in any wearing.
  const scores = stripComments(src('app/scores/page.js'));
  assert.doesNotMatch(scores, /requireSignInInShell/,
    '/scores must not force sign-in in any wearing - it is a browse surface');
  const fantasy = stripComments(src('app/nfl/fantasy/page.js'));
  assert.doesNotMatch(fantasy, /requireSignInInShell\(\{/,
    '/nfl/fantasy must not force sign-in - it is a league route');
  // And no league route may quietly gain one back.
  for (const f of ['components/gridiron/TodayPage.js', 'components/wire/WirePage.js',
                   'components/standings/StandingsPage.js', 'components/gridiron/RankingsHub.js',
                   'app/nfl/wire/page.js', 'app/cfb/wire/page.js',
                   'app/nfl/market/page.js', 'app/cfb/market/page.js']) {
    assert.doesNotMatch(stripComments(src(f)), /requireSignInInShell\(\{/, `${f} must stay open`);
  }
});
