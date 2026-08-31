// app/surface.test.mjs — v1.3: every surface is ink, and paper cannot come back.
// Run: node --test app/surface.test.mjs
//
// TWO DIFFERENT ASSERTIONS, AND THE DIFFERENCE IS THE POINT. The ATTRIBUTE and
// the SELECTOR must be absent - paper is retired, and a route that reintroduces
// either would render a light ground nothing else in the product matches. But
// the five paper-ramp TOKENS must still RESOLVE: they are consumed at 20 sites
// in gridiron.css, legal.css and sim.css, and [data-surface="ink"] gives each
// an ink value. Asserting their absence would be exactly wrong and would push
// somebody into 20 edits to satisfy a test.
//
// WHY THIS MATTERS MORE THAN IT LOOKS. An undefined custom property fails
// ASYMMETRICALLY: `color` inherits, so text silently falls back to the parent
// and still looks right, while `border` and `background` are not inherited and
// drop to their initial value - the declaration just vanishes. That is how a
// previous flip deleted four borders and a background while every page still
// looked finished. A test is the only thing that sees it.
//
// COMMENTS ARE STRIPPED BEFORE EVERY ABSENCE ASSERTION. Half the paper
// footprint this relay removed was prose describing paper, and a guard that
// counts its own explanatory text is a guard that fails the moment someone
// documents the rule it enforces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, exts, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(REPO, p);
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const JS = [...walk(path.join(REPO, 'app'), ['.js']), ...walk(path.join(REPO, 'components'), ['.js'])];
const CSS = [...walk(path.join(REPO, 'app'), ['.css']), ...walk(path.join(REPO, 'components'), ['.css'])];

test('NO data-surface="paper" ATTRIBUTE under app/ or components/', () => {
  const offenders = JS.filter((f) => /data-surface\s*=\s*["'{]?[^"'>]*paper/.test(stripJs(readFileSync(f, 'utf8'))));
  assert.deepEqual(offenders.map(rel), [], 'paper is retired; every shell is ink');
});

test('NO [data-surface="paper"] SELECTOR in any CSS', () => {
  const offenders = CSS.filter((f) => /\[data-surface\s*=\s*["']?paper/.test(stripCss(readFileSync(f, 'utf8'))));
  assert.deepEqual(offenders.map(rel), [], 'nothing may be scoped to a surface that cannot exist');
});

test('the attribute has exactly ONE legal value, and it is used', () => {
  const values = new Set();
  let sites = 0;
  for (const f of JS) {
    for (const m of stripJs(readFileSync(f, 'utf8')).matchAll(/data-surface\s*=\s*"([a-z]+)"/g)) {
      values.add(m[1]); sites += 1;
    }
  }
  assert.deepEqual([...values].sort(), ['ink']);
  assert.ok(sites > 20, `expected the ink shell on many routes, found ${sites}`);
});

// ------------------------------------------------- the tokens must RESOLVE

const GLOBALS = readFileSync(path.join(REPO, 'app/globals.css'), 'utf8');
const PAPER_RAMP = ['--ink-soft', '--ink-mut', '--ink-dim', '--p-rule', '--p-rule-soft'];

test('the five paper-ramp tokens RESOLVE under [data-surface="ink"]', () => {
  const i = GLOBALS.indexOf('[data-surface="ink"] {');
  assert.notEqual(i, -1, 'the ink block must exist');
  const block = GLOBALS.slice(i, GLOBALS.indexOf('\n}', i));
  for (const t of PAPER_RAMP) {
    assert.match(block, new RegExp(`${t}\\s*:`), `${t} has no ink value - 20 call sites would drop to initial`);
  }
});

test('every consumer of those tokens is reachable from an ink shell', () => {
  // Not a style claim - a resolution claim. A file using --p-rule outside any
  // [data-surface] subtree would draw no border at all.
  const consumers = CSS.filter((f) => PAPER_RAMP.some((t) => stripCss(readFileSync(f, 'utf8')).includes(`var(${t}`)));
  assert.deepEqual(consumers.map(rel).sort(), [
    'components/gridiron/gridiron.css',
    'components/legal.css',
    'components/sim/sim.css',
  ], 'a new consumer must be checked for an ink ancestor before it is added here');
});

test('THE --volt-dim DISCRIMINATOR SURVIVED THIS RELAY, deliberately', () => {
  // [data-surface] is the SHARED palette and is also the only thing making
  // --volt-dim resolve to #8FAA00 inside a surface and #B8DD00 outside one.
  // Merging it into [data-surface="ink"] now that paper is gone would silently
  // repaint ~29 call sites. That collapse is its own relay; this pins that the
  // two blocks are still separate so the merge cannot happen by accident.
  const shared = GLOBALS.indexOf('[data-surface] {');
  const ink = GLOBALS.indexOf('[data-surface="ink"] {');
  assert.ok(shared !== -1 && ink !== -1 && shared < ink, 'both blocks exist, shared first');
  const sharedBlock = GLOBALS.slice(shared, GLOBALS.indexOf('\n}', shared));
  assert.match(sharedBlock, /--volt-dim: #8FAA00/);
  assert.match(GLOBALS.slice(0, shared), /--volt-dim: var\(--color-volt-dim\)/, ':root keeps its own value');
});

// --------------------------------------------------------- the last island

test('.read-prose is an ink module, and its ground actually resolves', () => {
  const sim = readFileSync(path.join(REPO, 'components/sim/sim.css'), 'utf8');
  const r = sim.slice(sim.indexOf('.read-prose {'), sim.indexOf('.read-prose .k'));
  assert.doesNotMatch(r, /background: var\(--paper\)/);
  assert.doesNotMatch(r, /color: var\(--ink\)/);
  assert.match(r, /border-left: 4px solid var\(--volt\)/, 'the volt edge stays');
  assert.match(r, /border-radius: 12px/);
  // --ink-2 and --line are NOT global tokens - they live only in
  // app/admin/console/console.css, which no route outside /admin/console
  // imports. Bare, they resolve to nothing and the card goes transparent.
  assert.match(r, /var\(--ink-2, #141414\)/, '--ink-2 must carry a fallback or the card vanishes');
  assert.match(r, /var\(--line, #2a2a2a\)/);
  assert.match(sim, /\.read-prose p \{[^}]*color: var\(--paper-warm\)/, 'the prose is full paper-warm');
});

test('THE MODULE RAMP IS GLOBAL NOW, and the console still agrees with it', () => {
  // --ink-2 / --ink-3 / --line lived only in the admin console's .adm block
  // while 46 bare call sites in home.css and player.css asked for them and got
  // nothing. They are :root tokens now. The console keeps its own copies -
  // .adm is a transcribed mock and stays self-contained - so the risk is not
  // absence any more, it is DRIFT: two definitions that stop agreeing.
  const RAMP = { '--ink-2': '#141414', '--ink-3': '#1c1c1c', '--line': '#2a2a2a' };
  const root = GLOBALS.slice(GLOBALS.indexOf(':root {'), GLOBALS.indexOf('\n}', GLOBALS.indexOf(':root {')));
  const adm = readFileSync(path.join(REPO, 'app/admin/console/console.css'), 'utf8');
  for (const [tok, hex] of Object.entries(RAMP)) {
    const g = new RegExp(`${tok}:\\s*(#[0-9a-fA-F]{6})`).exec(root);
    assert.ok(g, `${tok} must be defined at :root`);
    assert.equal(g[1].toLowerCase(), hex, `${tok} at :root`);
    const c = new RegExp(`${tok}:\\s*(#[0-9a-fA-F]{6})`).exec(adm);
    assert.ok(c, `${tok} must still be defined in console.css`);
    assert.equal(c[1].toLowerCase(), hex, `${tok} in console.css drifted from :root`);
  }
});

test('THE PREVIOUSLY-UNRESOLVED CALL SITES, named and counted', () => {
  // THE POINT OF THE PROMOTION, and the number is smaller and more specific
  // than the census claimed. That census said "46", counting every line
  // mentioning the token - including the fallback form var(--ink-2, #141414),
  // which was never broken, and comment prose. The real figure is 18: bare
  // var(--token) uses OUTSIDE the admin console, which defines all three in
  // its own .adm block and was therefore always fine.
  //
  // These 18 asked for a background or a border and got the initial value.
  // A background that resolves to transparent is invisible on a dark page -
  // the module simply had no ground, and nothing looked broken enough to
  // report.
  const EXPECTED = {
    'app/home.css': 8,                      // .readband .gcard .gcard.hot .mod
    'app/my/my.css': 4,
    'app/player/[slug]/player.css': 4,      // .gp-hero .gp-mod
    'components/gridiron/gridiron.css': 1,
    'components/today/modeswitch.css': 1,
    // ADDED AFTER THE PROMOTION, and therefore never broken: the league
    // landing was written against tokens that already resolved. This entry is
    // the guard working as intended - a new bare use is fine now, but it has
    // to be counted on purpose rather than drift in.
    'components/league/league.css': 8,
    // The wire, added after the promotion and therefore never broken either.
    'components/wire/wire.css': 6,
  };
  const found = {};
  for (const f of CSS) {
    if (rel(f) === 'app/admin/console/console.css') continue;   // defines its own
    const n = [...stripCss(readFileSync(f, 'utf8')).matchAll(/var\(--(ink-2|ink-3|line)\)/g)].length;
    if (n) found[rel(f)] = n;
  }
  assert.deepEqual(found, EXPECTED,
    'a new bare call site is fine now that the tokens are global - update the count deliberately');
  assert.equal(Object.values(found).reduce((a, b) => a + b, 0), 32,
    '18 were broken before the promotion; 14 were written after it');
  // and all three resolve, which is what makes those 18 correct rather than
  // merely present.
  for (const t of ['--ink-2', '--ink-3', '--line']) {
    assert.match(GLOBALS, new RegExp(`${t}: #`), `${t} must be a :root token`);
  }
});

// THE FIVE REMAINING PAPER BACKGROUNDS, EACH ARGUED. None is a GROUND - they
// are small light elements ON a dark ground, which is the opposite thing. The
// list is explicit rather than a keyword filter so a NEW paper background has
// to be added here deliberately, with a reason, instead of slipping past a
// pattern that happened not to match it.
//
// THIS TEST IS WHY .gi-lede WAS FOUND. The v1.3 census looked for the
// data-surface attribute and missed a band that painted var(--paper) directly
// - the last real paper ground in the product, and by then a live contrast
// failure on four routes. A guard that enumerates beats a guard that greps.
const PAPER_BG_ALLOWED = [
  ['components/site-chrome.css', 'the mobile burger bars - 2px light rules on the dark header'],
  ['app/my/my.css', 'the toggle knob - a switch handle, not a surface'],
  ['app/player/[slug]/player.css', '.gp-chip.rook - a light pill badge on a dark card'],
  ['components/gridiron/gridiron.css', '.gi-chip.live.active .gi-dot - a 6px live dot'],
  ['app/market/market.css', 'color-mix(paper 14%, graphite-up) - a dark tint, not paper'],
];

test('NO NEW LIGHT GROUND - every paper background is on the argued list', () => {
  const allowed = new Set(PAPER_BG_ALLOWED.map(([f]) => f));
  const offenders = [];
  for (const f of CSS) {
    const code = stripCss(readFileSync(f, 'utf8'));
    if (!/background[^;]*(#F5F5F2|var\(--paper[-a-z]*\))/i.test(code)) continue;
    if (!allowed.has(rel(f))) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, [], 'a paper background outside the argued list is a v1.3 regression');
});

test('THE LEDE BAND IS INK, and its text can be read on it', () => {
  // The band used to be var(--paper) while its three text tokens resolved from
  // the ancestor ink shell - #C5C5C2 on #F5F5F2 is 1.58:1, invisible, and it
  // shipped that way on /nfl, /cfb and both standings pages.
  const gi = readFileSync(path.join(REPO, 'components/gridiron/gridiron.css'), 'utf8');
  const lede = gi.slice(gi.indexOf('.gi-lede {'), gi.indexOf('.gi-lede-in'));
  assert.doesNotMatch(lede, /background: var\(--paper\)/);
  assert.match(lede, /background: var\(--graphite\)/);
  assert.match(lede, /color: var\(--paper\)/);
  assert.match(lede, /border-bottom: 3px solid var\(--volt\)/, 'the volt rule that delimits the band stays');
  // The heading was var(--ink) - black - which is invisible on the new ground.
  const h1 = gi.slice(gi.indexOf('.gi-lede h1 {'), gi.indexOf('.gi-lede p {'));
  assert.match(h1, /color: var\(--paper\)/);
  assert.doesNotMatch(h1, /color: var\(--ink\)/);
});
