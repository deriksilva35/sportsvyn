// lib/shell/sportsvynTab.test.mjs - the v0.3 Sportsvyn surfaces: the segment,
// the profile chip, and the two phone passes. Source-level, like every shell
// suite here - the claims are about gating and structure, and the failure
// modes are "renders where it must not" and "mobile rules leak to desktop".

import { test } from 'node:test';
import { TABS, activeTab, TAB_ROOTS } from './sportsvynTabs.js';
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

test('the segment links exactly its tab set - as Links, never <a>', () => {
  // TWO SURFACES BECAME FOUR. The hrefs moved into lib/shell/sportsvynTabs.js
  // so the list is testable and so BackToAppBar can read the roots without
  // importing a client component; the component maps over them. What this test
  // is actually for - never a plain anchor - is unchanged.
  const t = stripComments(src('components/shell/SportsvynSegment.js'));
  assert.match(t, /TABS\.map/);
  assert.match(t, /<Link key=\{t\.key\} href=\{t\.href\}/);
  assert.deepEqual(TABS.map((x) => x.href), ['/', '/scores', '/nfl/fantasy', '/market']);
  // A plain anchor here is a FULL document navigation: WKWebView tears the
  // page down, the client-gated chrome pops back at hydration and shifts the
  // page - the device glitch this component shipped with. Never again.
  assert.ok(!/<a /.test(t), 'a plain <a> reintroduces the teardown glitch');
});

test('the pill is optimistic - path-driven, no server active prop', () => {
  const t = stripComments(src('components/shell/SportsvynSegment.js'));
  assert.match(t, /usePathname/);
  for (const p of ['app/scores/page.js', 'app/nfl/fantasy/page.js']) {
    assert.ok(!stripComments(src(p)).includes('SportsvynSegment active='),
      `${p} still passes the retired active prop`);
  }
});

test('both routes carry a loading silhouette for the force-dynamic gap', () => {
  for (const p of ['app/scores/loading.js', 'app/nfl/fantasy/loading.js']) {
    assert.match(stripComments(src(p)), /aria-busy="true"/, p);
  }
});

test('the web cross-nav is the inverse gate - web only', () => {
  for (const p of PAGES) {
    const t = stripComments(src(p));
    // <a or <Link - the anchor form was converted to soft nav; the claim
    // here is the GATE, not the element.
    assert.match(t, /\{!isShell && <(a|Link) className="gi-cross"/,
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

// ---------------------------------------------------------------------------
// the phone-polish pass - column math, density, fade edges, sticky header
// ---------------------------------------------------------------------------

function mobileFbCols() {
  const { after } = mobileBlockAndOutside('components/fantasy/fantasy.css');
  const m = after.match(/--fb-cols:\s*min\((\d+)vw,\s*(\d+)px\)((?:\s+\d+px)+)/);
  assert.ok(m, 'mobile --fb-cols must lead with min(Nvw, Npx)');
  return {
    vw: Number(m[1]), cap: Number(m[2]),
    fixed: m[3].trim().split(/\s+/).map((x) => parseInt(x, 10)),
    after,
  };
}

test('the sort column is never born clipped - PLAYER+ADP+OPEN+3d fit 390', () => {
  const { vw, fixed } = mobileFbCols();
  // The wrap leaves ~360px at a 390px viewport (14px padding each side,
  // 1px panel borders). The first four columns must fit inside it.
  const firstFour = (vw / 100) * 390 + fixed[0] + fixed[1] + fixed[2];
  assert.ok(firstFour <= 360, `player+adp+open+3d = ${firstFour}px > 360`);
  // And a 360px SE clears its ~330px too.
  const se = (vw / 100) * 360 + fixed[0] + fixed[1] + fixed[2];
  assert.ok(se <= 330, `at 360px: ${se}px > 330`);
});

test('the player track is capped, not 1fr - 1fr is what clipped the sort column', () => {
  const { cap, after } = mobileFbCols();
  assert.ok(cap <= 200, `cap ${cap}px is not a phone column`);
  assert.ok(!/--fb-cols:[^;]*1fr/.test(after), 'a fractional player track swallows the width');
});

test('names truncate: nowrap-ellipsis on fb-nm and min-width 0 on its cell', () => {
  const { after } = mobileBlockAndOutside('components/fantasy/fantasy.css');
  assert.match(after, /\.fb-nm \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis/);
  assert.match(after, /\.fb-row > div:nth-child\(2\) \{ min-width: 0/,
    'without min-width:0 the name re-inflates the grid track');
});

test('density: the mobile cell padding is tighter than the desktop 9px', () => {
  const { before, after } = mobileBlockAndOutside('components/fantasy/fantasy.css');
  const desk = before.match(/\.fb-row > div \{ padding: (\d+)px/);
  const mob = after.match(/\.fb-shead > div, \.fb-row > div \{ padding: (\d+)px/);
  assert.ok(desk && mob, 'both padding rules must exist');
  assert.ok(Number(mob[1]) < Number(desk[1]),
    `mobile ${mob[1]}px must undercut desktop ${desk[1]}px - that is the density pass`);
});

test('chip strips end clean: fade-edge mask plus trailing padding', () => {
  const { after } = mobileBlockAndOutside('components/fantasy/fantasy.css');
  assert.match(after, /mask-image: linear-gradient/, 'no fade edge');
  assert.match(after, /-webkit-mask-image: linear-gradient/, 'iOS Safari needs the prefix');
  assert.match(after, /\.fb-filters \{[^}]*padding-right/s, 'no trailing stop for the last chip');
});

test('the header row holds the top: the sheet is its own two-axis scrollport', () => {
  const { after } = mobileBlockAndOutside('components/fantasy/fantasy.css');
  // sticky-top only works inside the nearest scrolling ancestor, so the
  // vertical scroll must live in .fb-scroll alongside the horizontal one.
  assert.match(after, /\.fb-scroll \{ max-height:[^}]*overflow: auto/, 'the sheet must own vertical scroll');
  // and the corner cell must ride above both rails
  assert.match(after, /\.fb-shead > div:nth-child\(2\) \{[^}]*z-index: 3/, 'corner cell under-stacked');
});

test('the deltas render whole - nowrap on every numeric treatment', () => {
  const { after } = mobileBlockAndOutside('components/fantasy/fantasy.css');
  assert.match(after, /\.fb-delta, \.fb-drift, \.fb-rng \{ white-space: nowrap/);
});

test('the preamble tightens at phone width and only there', () => {
  const { before, after } = mobileBlockAndOutside('components/fantasy/fantasy.css');
  assert.match(after, /\.fb-stat \.v \{ font-size: 22px/, 'stat band not tightened');
  assert.match(after, /\.fb-prov \{ margin-top: 12px/, 'provenance not tightened');
  assert.match(before, /\.fb-stat \.v \{[^}]*font-size: 30px/, 'desktop stat band must keep 30px');
});

// ---------------------------------------------------------------------------
// FOUR TABS (Today | Scoreboard | Fantasy | Market)
// ---------------------------------------------------------------------------

test('four tabs, in reading order, with the ruled targets', () => {
  assert.deepEqual(TABS.map((t) => [t.label, t.href]), [
    ['Today', '/'],
    ['Scoreboard', '/scores'],
    ['Fantasy', '/nfl/fantasy'],
    ['Market', '/market'],
  ]);
});

test('"Live Scores" appears NOWHERE in shell chrome', () => {
  // Comments stripped: a file explaining the rename would otherwise trip the
  // assertion that enforces it.
  for (const f of ['components/shell/SportsvynSegment.js', 'components/shell/AppTabBar.js',
    'components/shell/AppHeader.js', 'components/shell/apptab.css']) {
    assert.ok(!/Live Scores/.test(stripComments(src(f))), `${f} still says Live Scores`);
  }
});

test('FANTASY WAS NOT RETARGETED. /nfl/fantasy is what it has always meant', () => {
  assert.equal(TABS.find((t) => t.key === 'fantasy').href, '/nfl/fantasy');
});

test('activeTab is longest-prefix, so TODAY does not light everywhere', () => {
  // A startsWith('/') test would make the root match every page in the app.
  assert.equal(activeTab('/'), 'today');
  assert.equal(activeTab('/scores'), 'scores');
  assert.equal(activeTab('/scores?date=2026-08-29'.split('?')[0]), 'scores');
  assert.equal(activeTab('/nfl/fantasy'), 'fantasy');
  assert.equal(activeTab('/market'), 'market');
  // /nfl/fantasy must beat a bare /nfl, and an unowned path lights nothing.
  assert.equal(activeTab('/nfl/game/x'), null);
  assert.equal(activeTab('/player/x'), null);
});

test('every tab target mounts the segment behind the shell gate', () => {
  for (const f of ['app/page.js', 'app/scores/page.js', 'app/nfl/fantasy/page.js',
    'app/market/page.js']) {
    const code = stripComments(src(f));
    assert.match(code, /\{isShell && <SportsvynSegment \/>\}/, `${f} does not mount the segment`);
  }
});

test('THE BACK BAR IS ROOT-AWARE, and reuses the one that existed', () => {
  // A back button at a tab root either exits the app or does nothing visible.
  // The root list is imported from the segment rather than duplicated, so a
  // fifth tab cannot leave a stale back button behind it.
  const BAR = stripComments(src('components/BackToAppBar.js'));
  assert.match(BAR, /import \{ TAB_ROOTS \} from '@\/lib\/shell\/sportsvynTabs'/);
  assert.match(BAR, /if \(TAB_ROOTS\.has\(pathname\)\) return null;/);
  // And it is still the ONLY back affordance - no second pattern was invented.
  assert.match(BAR, /window\.history\.back\(\)/);
});

test('the sections below a tab carry the back bar', () => {
  for (const f of ['app/nfl/game/[slug]/page.js', 'app/cfb/game/[slug]/page.js',
    'app/player/[slug]/page.js', 'app/team/[slug]/page.js']) {
    assert.match(stripComments(src(f)), /<BackToAppBar \/>/, `${f} has no back affordance`);
  }
});
