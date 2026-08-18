// lib/shell/sportsvynTab.test.mjs - the v0.3 Sportsvyn surfaces: the segment,
// the profile chip, and the two phone passes. Source-level, like every shell
// suite here - the claims are about gating and structure, and the failure
// modes are "renders where it must not" and "mobile rules leak to desktop".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGES = ['app/scores/page.js', 'app/nfl/fantasy/page.js'];

// ---------------------------------------------------------------------------
// the segment - in-shell only, on both pages, linking both surfaces
// ---------------------------------------------------------------------------

test('the segment renders ONLY behind the isShell gate, on both pages', () => {
  for (const p of PAGES) {
    const t = stripComments(src(p));
    assert.match(t, /\{isShell && <SportsvynSegment/,
      `${p}: segment must be shell-gated at the call site`);
    // Exactly one mention outside the import - no unguarded second render.
    const renders = [...t.matchAll(/<SportsvynSegment/g)];
    assert.equal(renders.length, 1, `${p}: one segment render`);
  }
});

test('the segment links exactly the two surfaces', () => {
  const t = stripComments(src('components/shell/SportsvynSegment.js'));
  assert.match(t, /href="\/scores"/);
  assert.match(t, /href="\/nfl\/fantasy"/);
});

test('the web cross-nav is the inverse gate - web only', () => {
  for (const p of PAGES) {
    const t = stripComments(src(p));
    assert.match(t, /\{!isShell && <a className="gi-cross"/,
      `${p}: cross-nav must be !isShell - the shell's hop is the segment`);
  }
});

// ---------------------------------------------------------------------------
// shell-awareness on both pages
// ---------------------------------------------------------------------------

test('both pages resolve shell mode and emit the shell viewport', () => {
  for (const p of PAGES) {
    const t = stripComments(src(p));
    assert.match(t, /resolveShellMode/, p);
    assert.match(t, /generateViewport/, p);
    assert.match(t, /simViewport/, p);
  }
});

test('the sign-in guard precedes the data reads on both pages', () => {
  for (const [p, read] of [
    ['app/scores/page.js', 'getSlateByDate'],
    ['app/nfl/fantasy/page.js', 'getMovementBoard('],
  ]) {
    const whole = stripComments(src(p));
    const t = whole.slice(whole.indexOf('export default'));
    const guard = t.indexOf('requireSignInInShell(');
    const data = t.indexOf(read);
    assert.ok(guard > -1, `${p}: no guard`);
    assert.ok(guard < data, `${p}: the redirect must not pay for the reads`);
  }
});

test('the stale DEV-reads note is gone from /scores', () => {
  assert.ok(!src('app/scores/page.js').includes('DEV reads only'),
    'the comment predated the env split - the page reads PROD on Vercel');
});

// ---------------------------------------------------------------------------
// the bar and the chip
// ---------------------------------------------------------------------------

test('PROFILE is off the bar; the bar ends in SPORTSVYN', () => {
  const t = stripComments(src('lib/shell/appTabs.js'));
  const tabs = t.slice(t.indexOf('APP_TABS = ['), t.indexOf('];', t.indexOf('APP_TABS = [')));
  assert.ok(!tabs.includes("'profile'"), 'profile still on the bar');
  assert.ok(tabs.includes("'sportsvyn'"), 'sportsvyn tab missing');
});

test('the profile chip lives in AppHeader and lands on /account', () => {
  const t = stripComments(src('components/shell/AppHeader.js'));
  assert.match(t, /href="\/account"/);
  assert.match(t, /gh-app-me/);
  // Handle-less renders the generic mark rather than nothing.
  assert.match(t, /handle \? handle\[0\] : '@'/);
});

test('the chip asks /api/me only in the shell, and /api/me never 401s', () => {
  const header = stripComments(src('components/shell/AppHeader.js'));
  const fetchAt = header.indexOf("fetch('/api/me')");
  const gateAt = header.indexOf('if (!inShell) return;');
  assert.ok(gateAt > -1 && fetchAt > gateAt, 'the web must never spend the request');
  const me = stripComments(src('app/api/me/route.js'));
  assert.match(me, /handle: null/, 'signed-out is a normal chrome state, not a 401');
  assert.ok(!me.includes('401'), '/api/me answers, never challenges');
});

// ---------------------------------------------------------------------------
// the phone passes - mobile rules exist, and ONLY inside the media query
// ---------------------------------------------------------------------------

function mobileBlockAndOutside(cssPath) {
  const css = src(cssPath);
  const at = css.indexOf('@media (max-width: 640px)');
  assert.ok(at > -1, `${cssPath}: no 640px block`);
  return { before: css.slice(0, at), after: css.slice(at) };
}

test('the sticky player column exists, inside the 640px block only', () => {
  const { before, after } = mobileBlockAndOutside('components/fantasy/fantasy.css');
  // left-sticky specifically: the sheet HEADER is top-sticky on desktop
  // legitimately (it predates this pass), so "any sticky" would false-fail.
  assert.match(after, /position: sticky; left: 0/, 'sticky column missing from the phone pass');
  assert.ok(!before.includes('position: sticky; left: 0'),
    'the left-sticky column leaked outside the media query - that changes desktop');
});

test('the band inset bar rides the sticky cell at phone width', () => {
  const { after } = mobileBlockAndOutside('components/fantasy/fantasy.css');
  assert.match(after, /\.fb-row\.steam > div:nth-child\(2\)/);
  assert.match(after, /\.fb-row\.sliding > div:nth-child\(2\)/);
});

test('the scoreboard card refold and scroll strips are 640px-scoped', () => {
  const { before, after } = mobileBlockAndOutside('components/gridiron/gridiron.css');
  assert.match(after, /\.gi-card-body \{ display: flex; flex-direction: column/, 'card refold missing');
  assert.match(after, /\.gi-toolbar \{[^}]*overflow-x: auto/, 'scroll strip missing');
  assert.match(after, /\.gi-full \{[^}]*display: block/, 'Full game must become the card button');
  // DESKTOP UNCHANGED: none of the mobile treatments may exist above the
  // breakpoint. gi-toolbar's base rule wraps; only the mobile one scrolls.
  assert.ok(!/\.gi-toolbar \{[^}]*overflow-x: auto/.test(before), 'toolbar scroll leaked to desktop');
  assert.ok(!/\.gi-card-body \{[^}]*flex-direction: column/.test(before), 'card refold leaked to desktop');
});

test('desktop sheet geometry is untouched - the 1112px grid still leads', () => {
  const { before } = mobileBlockAndOutside('components/fantasy/fantasy.css');
  assert.match(before, /\.fb-sheet \{ min-width: 1112px/,
    'the desktop sheet was edited - the phone pass must be additive');
});
