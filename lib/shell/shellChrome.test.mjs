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
  const acct = read('app/account/page.js');
  assert.match(acct, /href="\/privacy"/, 'Privacy must be reachable from PROFILE');
  assert.match(acct, /href="\/terms"/, 'Terms must be reachable from PROFILE');
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

test('ONE HEADER IN THE CONTAINER: no burger, no funnel links, no dropdown', () => {
  const s = code('components/GlobalHeader.js');
  const appBranch = s.slice(s.indexOf('if (shell) {'), s.indexOf('return (\n    <>'));
  assert.match(appBranch, /gh--app/);
  assert.equal(/gh-burger/.test(appBranch), false, 'no burger in the app header');
  assert.equal(/MOCK DRAFT/.test(appBranch), false, 'no funnel CTA in the app header');
  assert.equal(/NavDropdown/.test(appBranch), false, 'the account menu is PROFILE');
});

test('the app wordmark uses the LOCKUP RULE, not next/image', () => {
  // Ratified: the established rule (a plain tag at a locked 1568x336 aspect and
  // an em-based height, because the caps are 0.40 of the png) beats the brief.
  const s = read('components/GlobalHeader.js');
  const mark = s.slice(s.indexOf('function AppWordmark'));
  assert.match(mark, /width=\{1568\}/);
  assert.match(mark, /height: '1\.8em'/);
  assert.equal(/from 'next\/image'/.test(s), false, 'plain <img>, per Wordmark.js');
});
