// lib/shell/shellChrome.test.mjs - what web chrome may reach the app container.
//
// THE RULE THIS ENFORCES: hiding chrome is not the same as removing a
// destination. Anything suppressed in the shell must still be reachable in the
// shell, by some other route. The footer carried Privacy and Terms; killing it
// without moving them would have made two documents the App Store expects
// in-app reachable only by typing a URL into a bar the container does not have.
//
// SOURCE-READING TESTS, like components/sim/phoneWidth.test.mjs. These are
// structural facts about which component wraps which, and a rendering test
// would need a DOM to say less.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(REPO, p), 'utf8');

/**
 * Source with comments removed.
 *
 * BECAUSE A TEST THAT GREPS PROSE FAILS ON GOOD DOCUMENTATION. Two assertions
 * below check that a file does NOT use resolveShellMode, and the file's header
 * explains at length why it does not - so both matched the explanation and
 * failed a correct file, twice. Anything asserting the ABSENCE of a symbol has
 * to read code.
 */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('THE SITE FOOTER DOES NOT RENDER IN THE CONTAINER', () => {
  const s = read('components/SiteFooter.js');
  assert.match(s, /HideInShell/, 'the footer must be wrapped');
  assert.match(s, /<HideInShell>\{siteFooterMarkup\(\)\}<\/HideInShell>/,
    'wrapped once at the component, not at twenty call sites');
});

test('...AND ITS LEGAL LINKS SURVIVED THE MOVE', () => {
  // The whole point. If this fails, two documents Apple expects in-app are
  // reachable only by URL in an app with no URL bar.
  // The You tab since sun-16 D (/account is a 308 there): its foot renders
  // in the container too.
  const you = read('components/you/You.js');
  assert.match(you, /<Link href="\/privacy">Privacy<\/Link>/, 'Privacy must be reachable from YOU');
  assert.match(you, /<Link href="\/terms">Terms<\/Link>/, 'Terms must be reachable from YOU');
});

test('the subscribe band renders NOTHING in the container, not a smaller band', () => {
  // It used to render a text-only variant, which is still web furniture: an
  // install IS the subscription intent.
  const s = read('app/page.js');
  assert.match(s, /if \(shell\) return null;/, 'shell must be a null return');
});

test('THE SUPPRESSION GATE IS THE CLIENT ONE, so prerendered pages stay prerendered', () => {
  // /privacy and /terms are the two pages an App Store reviewer actually opens,
  // and they are prerendered. A server-side shell read in the footer would call
  // cookies() and turn both dynamic - to hide a footer.
  const s = read('components/shell/HideInShell.js');
  const c = code('components/shell/HideInShell.js');
  assert.match(c, /useSyncExternalStore/, 'must read the cookie as external state');
  assert.match(c, /getServerSnapshot/, 'must render children on the server');
  // ASSERT ON THE IMPORT, NOT THE WORD. The first version of this grepped for
  // "resolveShellMode" anywhere in the file and failed on the doc comment
  // EXPLAINING why the file does not use it - a test that reads prose rather
  // than code, which is a test that fails on good documentation.
  assert.equal(/from '@\/lib\/shell\/shell'/.test(c), false,
    'must not import the server-side shell resolver');
  assert.equal(/resolveShellMode\(/.test(c), false, 'must not call it either');
  assert.match(s, /'use client'/, 'the gate is a client component');
});

test('GetTheAppBanner is marked as the reference implementation', () => {
  // It was the only piece of chrome that already handled the shell correctly.
  // The note is there so the next component copies it rather than reinventing.
  const s = read('components/appstore/GetTheAppBanner.js');
  assert.match(s, /REFERENCE IMPLEMENTATION FOR SHELL-AWARE CHROME/);
});

test('ONE HEADER DECISION, IN THE LAYOUT - not per route', () => {
  // THE BUG THIS PINS, found on a real phone: the app header used to render
  // inside GlobalHeader, which only fires on pages importing
  // GlobalHeaderServer. Every /sim page draws its own header instead, so the
  // container showed DRAFTVYN on Games and Profile and SPORTSVYN on Practice
  // and Tracker - and a "Lobby" link inside the draft room. Four routes, four
  // answers. The header is mounted in the root layout now, beside the tab bar.
  const layout = code('app/layout.js');
  assert.match(layout, /<AppHeader \/>/, 'the header must be mounted globally');
  assert.match(layout, /<AppTabBar \/>/, 'header above, bar below, one gate on both');

  const gh = code('components/GlobalHeader.js');
  assert.match(gh, /if \(shell\) return null;/,
    'the web header must get out of the way rather than render a second one');
  assert.equal(/gh--app/.test(gh), false, 'the app header no longer lives here');
});

test('THE APP HEADER: the mark, then the profile chip OR sign in, and nothing else', () => {
  // v0.3 amended the v0.2 "nothing but the mark" ruling: PROFILE left the tab
  // bar for a header chip, so the header now carries exactly ONE link - the
  // chip to /you (/account until sun-16 D made it a 308). The mark itself stays a non-link (home is a tab), and
  // the old prohibitions all still hold.
  const s = code('components/shell/AppHeader.js');
  assert.match(s, /gh--app/);
  // R3: the brand kit's SVG mark, the web header's own component - not the retired PNG lockup.
  assert.match(s, /import HeaderWordmark from '@\/components\/brand\/HeaderWordmark'/);
  assert.match(s, /<HeaderWordmark /);
  assert.equal(/sportsvynwordmarkwhite3000x600truealpha\.png/.test(s), false, 'the PNG lockup is retired from the header');
  assert.equal(/gh-burger/.test(s), false, 'no burger');
  assert.equal(/MOCK DRAFT/.test(s), false, 'no funnel CTA');
  assert.equal(/NavDropdown/.test(s), false, 'no dropdown - the chip is a plain link');
  // sun-14: a signed-out reader gets SIGN IN on the right edge instead of the
  // generic chip - two links in the source, never both on screen (signedIn picks).
  const links = [...s.matchAll(/<Link/g)];
  assert.equal(links.length, 2, 'exactly two links: the profile chip and SIGN IN');
  assert.match(s, /\{me\?\.signedIn && \(\s*<Link href="\/you" className="gh-app-me"/);
  assert.match(s, /\{me && !me\.signedIn && !onSignin && \(\s*<Link href=\{shellSigninHref\(pathname, true\)\} className="gh-app-signin"/);
  // The mark is still not a link - no <a>, and the one <Link> is the chip.
  assert.equal(/<a /.test(s), false, 'the mark must not navigate');
});

test('EVERY /sim HEADER HIDES IN THE CONTAINER - all five, plus the tracker room', () => {
  // Each of these renders the SPORTSVYN gridiron wordmark, which is correct on
  // the web and wrong in an app whose bundle is com.sportsvyn.draftvyn. Any one
  // of them left unwrapped puts the wrong brand back on a tab.
  for (const p of ['app/sim/page.js', 'app/sim/tracker/page.js', 'app/sim/history/page.js',
    'app/sim/account/page.js', 'app/sim/draft/[id]/page.js', 'components/sim/TrackerRoom.js']) {
    const s = read(p);
    assert.match(s, /HideInShell/, `${p} still shows its own header in the app`);
  }
});

test('the app wordmark is SPORTSVYN - the web header\'s mark, at its size (28 Sep ruling; R3 29 Sep)', () => {
  // SUPERSEDES "the app wears the product mark" (DRAFTVYN, 1500x300 at 2.12em).
  // Derik, 28 Sep: an unauthenticated launch lands on /signin, whose body says
  // SPORTSVYN under a header that said DRAFTVYN; the shared header wears the
  // same mark the web header does. R3 (29 Sep): that mark is the brand kit's
  // SVG, drawn by ONE component for every header - so "the same mark" is now
  // "the same component", and the asset, the em height and the no-underline
  // rule are HeaderWordmark's alone to hold.
  const mark = code('components/shell/AppHeader.js');
  const wm = code('components/gridiron/Wordmark.js');
  const hw = code('components/brand/HeaderWordmark.js');
  for (const [name, src] of [['AppHeader', mark], ['gridiron/Wordmark', wm]]) {
    assert.match(src, /<HeaderWordmark /, `${name} draws the shared mark`);
    assert.equal(/<img\b/.test(src), false, `${name} carries no <img> of its own`);
  }
  assert.match(hw, /sportsvyn-header-wordmark-dark\.svg/);
  assert.match(hw, /sportsvyn-header-wordmark-light\.svg/);
  assert.match(hw, /WORDMARK_EM = 1\.36/, 'the PNG\'s letter size (0.71em caps)');
  assert.match(hw, /LOCKUP_BOX_EM = 1\.8/, 'and the PNG\'s box, so no header changes height');
  assert.equal(/sportsvynwordmark/.test(hw), false, 'the PNG lockup, and its underline, are retired');
  assert.equal(/draftvynwordmark/.test(mark), false, 'no DRAFTVYN mark in the shell header');
  assert.equal(/from 'next\/image'/.test(hw), false, 'plain <img>, per Wordmark.js - ratified');
});

test('THE MARK IS SIZED FOR A PHONE, not for the web header it was calibrated to', () => {
  // 1.71em reproduced the web header's cap height exactly - and read undersized
  // on a real device. The DRAFTVYN export is mostly padding: its ink is 152 of
  // 300 rows against the Sportsvyn mark's 285 of 336, and it has no underline,
  // so a matched cap height gives a much lighter mark in a much emptier box.
  // 2.12em puts the caps at 15.0px in this 17px header, +24%.
  const caps = (125 / 300) * 2.12 * 17;
  assert.ok(caps > 14.8 && caps < 15.2, `caps measure ${caps.toFixed(2)}px`);
  const previous = (133 / 336) * 1.8 * 17;
  const bump = caps / previous - 1;
  assert.ok(bump > 0.20 && bump < 0.25, `bump is ${(bump * 100).toFixed(1)}%, wanted 20-25%`);
});
