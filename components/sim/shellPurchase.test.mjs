// components/sim/shellPurchase.test.mjs — App Store Guideline 3.1.1.
//
// Apple rejected 1.0(2) because membership could be purchased inside the app:
// Stripe checkout was reachable from the sim gate cards. The rule is absolute -
// the app must contain NO purchase mechanism and NO steering toward one - so this
// suite is a hard gate, not a style check.
//
// TWO LAYERS, because each catches what the other cannot:
//   1. COPY   — the shell strings themselves carry no price and no plan name.
//   2. SOURCE — the shell BRANCH of every gate component constructs no
//      /membership link and no price. React components can't be rendered under
//      node --test here (the @/ alias is a Next build concern), so the shell
//      branch is read as text and asserted against. Blunt, and it catches the
//      thing that actually happened: a shell branch that still linked out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MEMBERSHIP_CARD_SHELL, SHELL_LOCKED_NOTE, MEMBERSHIP_CARD_VARIANTS, MEMBERSHIP_PRICE_LINE,
} from './membershipCopy.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// Anything that reads as a price or a plan the user could buy.
const PRICE_PATTERNS = [
  /\$\s?\d/,                 // $9.99, $59, $ 99
  /\/\s?mo\b/i, /\/\s?yr\b/i,
  /\bper (month|year)\b/i,
  /\bUSD\b/,
];
const PLAN_NAME_PATTERNS = [
  /\bDraft Pass\b/i, /\bFootball Suite\b/i, /\bFounding\b/i,
];
const SOLICIT_PATTERNS = [
  /\bsee plans\b/i, /\bsubscribe\b/i, /\bbuy\b/i, /\bupgrade now\b/i,
  /\bstart (your )?(trial|membership)\b/i, /\bcheckout\b/i,
];

// ---------------------------------------------------------------------------
// 1. COPY
// ---------------------------------------------------------------------------

test('shell card copy carries no price, no plan name, no solicitation', () => {
  for (const [variant, v] of Object.entries(MEMBERSHIP_CARD_SHELL)) {
    const text = `${v.headline} ${v.body}`;
    for (const re of [...PRICE_PATTERNS, ...PLAN_NAME_PATTERNS, ...SOLICIT_PATTERNS]) {
      assert.ok(!re.test(text), `shell "${variant}" copy matches ${re}: ${text}`);
    }
    assert.ok(!/[—–]/.test(text), `em/en dash in shell "${variant}"`);
  }
});

test('the shared shell locked note is account-shaped, not commerce-shaped', () => {
  for (const re of [...PRICE_PATTERNS, ...PLAN_NAME_PATTERNS, ...SOLICIT_PATTERNS]) {
    assert.ok(!re.test(SHELL_LOCKED_NOTE), `locked note matches ${re}`);
  }
  assert.match(SHELL_LOCKED_NOTE, /membership/i, 'it should still say why the thing is locked');
});

test('every web variant has a shell counterpart (no variant can leak unshielded)', () => {
  for (const key of Object.keys(MEMBERSHIP_CARD_VARIANTS)) {
    assert.ok(MEMBERSHIP_CARD_SHELL[key], `variant "${key}" has no shell copy`);
  }
});

test('WEB copy is unchanged and still sells (the fix must not leak into web)', () => {
  assert.equal(MEMBERSHIP_PRICE_LINE, '$9.99 Draft Pass - $59/yr Suite - $99/yr Founding');
  // The web card now leads with what membership still prices, since the
  // three-a-week wall it used to headline no longer exists.
  assert.equal(MEMBERSHIP_CARD_VARIANTS.draft.headline, 'Custom rooms, tracker mode.');
  assert.match(MEMBERSHIP_CARD_VARIANTS.custom.body, /Draft Pass unlocks the full console/);
  assert.equal(MEMBERSHIP_CARD_VARIANTS.tracker.headline, 'Bring it to your draft.');
});

// ---------------------------------------------------------------------------
// 2. SOURCE — the shell branch must construct nothing purchasable
// ---------------------------------------------------------------------------

// Slice a component's shell branch: `if (shell) { ... }`, delimited by BRACE
// BALANCE rather than indentation. An earlier version guessed the end from
// indentation and silently swallowed the web branch below it, which made the
// ExposureReport assertion fail on a link that was not in the shell branch at all.
// Balance is exact; the tradeoff is that a brace inside a string literal would
// skew it, which none of these components have.
function shellBranch(text) {
  const m = /if\s*\(\s*(shell|isShell)\s*\)\s*\{/.exec(text);
  if (!m) return null;
  let depth = 0;
  const start = m.index + m[0].length - 1; // at the opening brace
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

test('MembershipCard shell branch renders no /membership link and no price', () => {
  const branch = shellBranch(src('components/sim/MembershipCard.js'));
  assert.ok(branch, 'no shell branch found in MembershipCard');
  assert.ok(!branch.includes('/membership'), 'shell branch links to the pricing page');
  assert.ok(!branch.includes('MEMBERSHIP_PRICE_LINE'), 'shell branch renders the price line');
  assert.ok(!/mcard-cta/.test(branch), 'shell branch renders the SEE PLANS CTA');
  // The old shell behaviour was to open /membership in a NEW TAB - that is
  // exactly the steering 3.1.1 bans, so assert the escape hatch is gone too.
  assert.ok(!/target=["']_blank/.test(branch), 'shell branch opens an external tab');
  assert.ok(branch.includes('MEMBERSHIP_CARD_SHELL'), 'shell branch should use the neutral copy');
});

test('ExposureReport shell branch names the feature and sells nothing', () => {
  const branch = shellBranch(src('components/sim/ExposureReport.js'));
  assert.ok(branch, 'no shell branch found in ExposureReport');
  assert.ok(!branch.includes('/membership'), 'shell branch links to the pricing page');
  assert.ok(!/Draft Pass/.test(branch), 'shell branch names a purchasable plan');
  assert.ok(!/expo-cta/.test(branch), 'shell branch renders the CTA');
  assert.match(branch, /Exposure Report/, 'it should still name the feature');
});

test('/membership route redirects in shell before rendering anything', () => {
  const s = src('app/membership/page.js');
  assert.match(s, /resolveShellMode/, '/membership must resolve shell mode');
  assert.match(s, /redirect\('\/sim'\)/, '/membership must redirect in shell');
  // The guard used to have to precede PLANS.map. There is no plan grid any more
  // - /membership is a notice - so the assertion is now that nothing
  // purchasable is constructed there AT ALL, which is strictly stronger.
  assert.equal(/PLANS\.map/.test(s), false, 'no plan grid to protect');
  assert.equal(/startCheckout/.test(s), false, 'no checkout form to protect');
  // The redirect still runs before any render, and 3.1.1 is unconditional.
  assert.ok(s.indexOf('resolveShellMode') < s.indexOf('return ('),
    'the shell redirect must still precede the render');
  assert.match(s, /export const dynamic = 'force-dynamic'/, 'cookie read requires dynamic');
});

test('checkout + billing-portal actions refuse in shell (POST backstop)', () => {
  const s = src('app/actions/membership.js');
  const checkout = s.slice(s.indexOf('export async function startCheckout'));
  const portal = s.slice(s.indexOf('export async function openBillingPortal'));
  for (const [name, body] of [['startCheckout', checkout], ['openBillingPortal', portal]]) {
    assert.match(body, /resolveShellMode/, `${name} has no shell guard`);
    // The guard must be the first thing, before auth/session/Stripe work.
    assert.ok(body.indexOf('resolveShellMode') < body.indexOf('await auth()'),
      `${name}'s shell guard must run before anything else`);
  }
});

test('every surface that links to /membership is shell-gated', () => {
  // The audit list. A new /membership link anywhere in these files must come with
  // a shell guard in the same file, or this fails.
  const LINKERS = [
    'components/sim/MembershipCard.js',
    'components/sim/ExposureReport.js',
    'components/GlobalHeader.js',
    'components/gridiron/RailCards.js',
    'app/signin/page.js',
    'app/sim/account/page.js',
  ];
  for (const rel of LINKERS) {
    const s = src(rel);
    if (!s.includes('/membership')) continue; // link removed entirely — fine
    assert.ok(/\bshell\b|\bisShell\b/.test(s), `${rel} links to /membership with no shell gate`);
  }
});

test('the native container actually sets the shell cookie', () => {
  // Without this the whole suppression is inert in the shipped binary: the app
  // loads /app, which never carried ?shell=sim-app or the cookie.
  const s = src('components/shell/NativeShellCookie.js');
  assert.match(s, /window\.Capacitor/, 'must feature-detect the native container');
  assert.match(s, /SHELL_COOKIE/, 'must write the shell cookie');
  const layout = src('app/app/layout.js');
  assert.match(layout, /NativeShellCookie/, '/app layout must mount it');
});

test('league rail teasers name no purchasable plan in shell', () => {
  // "Football Suite" is a plan name. The lock chip and the body both carried it;
  // both must be neutral in the shell branch.
  const { SUITE_TEASERS } = JSON.parse(JSON.stringify({ SUITE_TEASERS: null })); // placeholder
  const copy = src('components/gridiron/leagueCopy.js');
  assert.match(copy, /bodyShell/, 'teasers need an explicit shell body');
  // Every bodyShell must be free of plan names and prices.
  for (const m of copy.matchAll(/bodyShell:\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
    const text = m[2];
    for (const re of [...PLAN_NAME_PATTERNS, ...PRICE_PATTERNS, ...SOLICIT_PATTERNS]) {
      assert.ok(!re.test(text), `bodyShell matches ${re}: ${text}`);
    }
  }
  const rail = src('components/gridiron/RailCards.js');
  assert.match(rail, /shell \? t\.bodyShell : t\.body/, 'rail must use bodyShell in shell');
  assert.match(rail, /shell \? 'MEMBERS' : t\.lock/, 'lock chip must be neutral in shell');
  assert.ok(SUITE_TEASERS === null); // keeps the placeholder honest/unused
});

test('the proxy blocks /membership before the route renders', () => {
  const s = src('proxy.js');
  assert.match(s, /SHELL_COOKIE/, 'proxy must read the shell cookie');
  assert.match(s, /pathname === '\/membership'/, 'proxy must match the pricing route');
  assert.match(s, /'\/membership'/, 'matcher must include /membership');
  // The block must precede the admin gate, or /membership falls through.
  // Anchored on the CODE occurrence (process.env.ADMIN_USERNAME) — plain
  // 'ADMIN_USERNAME' also appears in the file's header comment, which sits above
  // everything and made this compare against prose rather than control flow.
  assert.ok(s.indexOf("pathname === '/membership'") < s.indexOf('process.env.ADMIN_USERNAME'));
});
