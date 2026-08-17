// components/sim/phoneWidth.test.mjs — 390px-class layout assertions.
//
// These screens cannot be rendered under node --test (client components, @/
// alias), so the geometry claims are asserted against the CSS itself. That is
// weaker than a screenshot and it is stated as such - what it DOES catch is the
// specific class of regression that caused the scrunch: a fixed width or a
// single-section layout assumption reappearing in a narrow-width rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const TRACKER = css('components/sim/tracker.css');
const SIM = css('components/sim/sim.css');

// Concatenate the bodies of EVERY @media block matching `cond`.
//
// All of them, not the last one: a stylesheet legitimately carries several blocks
// at the same breakpoint (sim.css has the original one-viewport lock, the
// sim--stack relaxation, and the preset-rail tuning all at <=900px). An earlier
// version of this helper took only the last block and reported the lock's
// attribution rules as "changed" simply because it was reading a different block.
function mediaBlock(text, cond) {
  const needle = `@media ${cond}`;
  const out = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) break;
    const start = text.indexOf('{', at);
    let depth = 0;
    let end = text.length;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    out.push(text.slice(start, end));
    from = end;
  }
  return out.length ? out.join('\n') : null;
}

// Rule body for `selector` inside `block`.
//
// The selector must START a rule (be preceded by a brace or a line break), not
// merely appear somewhere in a selector list. Without that anchor, asking for
// `.deck` matched the `.deck` buried in the lock's
// `.sim--setup .setup-head, ..., .sim--setup .deck, ... { flex: none }` list and
// returned the wrong declarations entirely.
function rule(block, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[{}])\\s*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'm');
  const m = re.exec(block);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// 1. Tracker setup: stacked, full-width, 44px targets
// ---------------------------------------------------------------------------

test('tracker setup has a narrow-width block', () => {
  assert.ok(mediaBlock(TRACKER, '(max-width: 560px)'), 'no <=560px block in tracker.css');
});

test('tracker setup rows STACK at phone width (one thing per row)', () => {
  const b = mediaBlock(TRACKER, '(max-width: 560px)');
  const row = rule(b, '.trk-start-row');
  assert.ok(row, '.trk-start-row not overridden at narrow width');
  assert.match(row, /flex-direction:\s*column/, 'controls must stack, not sit side by side');
  const label = rule(b, '.trk-start-row label');
  assert.match(label, /width:\s*100%/, 'each control row must be full width');
});

test('tracker setup controls are full-width with no fixed floor', () => {
  const b = mediaBlock(TRACKER, '(max-width: 560px)');
  const ctl = rule(b, '.trk-start select');
  assert.ok(ctl, 'select/input not overridden at narrow width');
  assert.match(ctl, /width:\s*100%/, 'controls must fill the row');
  // The default rule sets min-width:92px; at narrow width that floor is what
  // squeezed three controls onto one line. It must be released.
  assert.match(ctl, /min-width:\s*0/, 'the 92px min-width floor must be released');
});

test('tap targets meet the 44px minimum', () => {
  const b = mediaBlock(TRACKER, '(max-width: 560px)');
  for (const sel of ['.trk-start select', '.trk-start-names']) {
    const r = rule(b, sel);
    const m = /min-height:\s*(\d+)px/.exec(r ?? '');
    assert.ok(m, `${sel} has no min-height at narrow width`);
    assert.ok(Number(m[1]) >= 44, `${sel} tap target is ${m[1]}px, under the 44px minimum`);
  }
});

test('inputs are >=16px so iOS does not zoom the page on focus', () => {
  const b = mediaBlock(TRACKER, '(max-width: 560px)');
  const m = /font-size:\s*(\d+)px/.exec(rule(b, '.trk-start select') ?? '');
  assert.ok(m, 'no font-size on the narrow-width controls');
  assert.ok(Number(m[1]) >= 16, `input font-size ${m[1]}px will trigger iOS focus zoom`);
});

test('seat-name inputs are one per row at phone width', () => {
  const b = mediaBlock(TRACKER, '(max-width: 560px)');
  const g = rule(b, '.trk-start-grid');
  assert.ok(g, '.trk-start-grid not overridden');
  assert.match(g, /grid-template-columns:\s*1fr/, 'seat names must be a single column');
});

test('no fixed px width can overflow a 390px viewport', () => {
  const b = mediaBlock(TRACKER, '(max-width: 560px)');
  // A `width: NNNpx` (not min/max, not 100%) inside the narrow block is exactly
  // the bug class this whole fix is about.
  for (const m of b.matchAll(/(?<![-a-z])width:\s*(\d+)px/g)) {
    assert.fail(`fixed width:${m[1]}px inside the narrow-width block`);
  }
});

// ---------------------------------------------------------------------------
// 2. The stacked lobby (root cause of the scrunch)
// ---------------------------------------------------------------------------

test('sim--stack relaxes the one-viewport lock for a two-section lobby', () => {
  const b = mediaBlock(SIM, '(max-width: 900px)');
  assert.ok(b, 'no <=900px block in sim.css');
  const wrap = rule(b, '.sim--setup.sim--stack .sim-wrap');
  assert.ok(wrap, 'sim--stack does not override .sim-wrap');
  assert.match(wrap, /overflow:\s*visible/, 'the wrap must scroll, not clip');
  const sec = rule(b, '.sim--setup.sim--stack .sim-wrap > section');
  assert.match(sec, /flex:\s*none/, 'sections must size to content, not split the viewport');
});

test('the lobby actually applies sim--stack', () => {
  const page = readFileSync(path.join(REPO, 'app/sim/page.js'), 'utf8');
  assert.match(page, /sim--stack/, 'app/sim/page.js must set the modifier');
});

test('the attribution rules of the lock are NOT disturbed', () => {
  // .sim-foot hidden + .setup-attr shown is how the FFC licensed string reaches
  // the mobile setup screen. Relaxing the height lock must not touch either.
  const b = mediaBlock(SIM, '(max-width: 900px)');
  assert.match(b, /\.sim--setup \.sim-foot\s*\{\s*display:\s*none/, 'sim-foot rule changed');
  assert.match(b, /\.sim--setup \.setup-attr\s*\{\s*display:\s*block/, 'setup-attr rule changed');
  assert.ok(!/\.sim--stack[^{]*\.setup-attr/.test(b), 'sim--stack must not override setup-attr');
  assert.ok(!/\.sim--stack[^{]*\.sim-foot/.test(b), 'sim--stack must not override sim-foot');
});

// ---------------------------------------------------------------------------
// 3. Preset rail
// ---------------------------------------------------------------------------

test('the preset rail scrolls horizontally with snap', () => {
  assert.match(SIM, /\.deck\s*\{[^}]*overflow-x:\s*auto/, 'rail must scroll horizontally');
  assert.match(SIM, /\.deck\s*\{[^}]*scroll-snap-type/, 'rail must snap');
});

test('the rail signals more cards at phone width (peek affordance)', () => {
  const b = mediaBlock(SIM, '(max-width: 900px)');
  const deck = rule(b, '.deck');
  assert.ok(deck, '.deck not tuned at narrow width');
  assert.match(deck, /mask-image/, 'a right-edge fade must mark the rail as scrollable');
  assert.match(deck, /scroll-snap-type:\s*x proximity/, 'proximity lets a partial card rest in view');
});

test('the rail change is scoped to narrow widths (desktop untouched)', () => {
  // The desktop .deck rule must still be the mandatory-snap original.
  assert.match(SIM, /\.deck\s*\{[^}]*scroll-snap-type:\s*x mandatory/, 'desktop rail changed');
});

// ---------------------------------------------------------------------------
// 4. Shell polish: TRACKER tab + BOARD grid view
// ---------------------------------------------------------------------------

test('the bottom nav carries TRACKER between DRAFT and HISTORY', () => {
  const s = readFileSync(path.join(REPO, 'components/sim/SimTabBar.js'), 'utf8');
  const keys = [...s.matchAll(/key:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['draft', 'tracker', 'history', 'rankings', 'account']);
  assert.match(s, /href:\s*'\/sim\/tracker'/, 'the tab must point at the tracker route');
  assert.match(s, /startsWith\('\/sim\/tracker'\)/, 'the tab must highlight on its own route');
});

test('the tab bar still fits five tabs at phone width', () => {
  const lb = /\.simtab-i \.lb \{([^}]*)\}/.exec(SIM);
  assert.ok(lb, '.simtab-i .lb rule missing');
  assert.match(lb[1], /white-space:\s*nowrap/, 'a wrapped label would push the bar taller');
  const size = /font-size:\s*([\d.]+)px/.exec(lb[1]);
  // 5 tabs at 320px = ~64px each; RANKINGS at <=9px measures under that.
  assert.ok(Number(size[1]) <= 9, `label font ${size[1]}px is too large for five tabs`);
});

test('AN ACTIVE TRACKER ROOM SURVIVES A TAB-AWAY - the tab returns you INTO it', () => {
  // THE DRAFT-NIGHT BUG. I replaced this redirect with a resume card so the tab
  // could not throw a reader into a live draft. On a phone that reads as losing
  // the session: tab to the Daily mid-round, come back, and the tracker shows a
  // setup screen. A commissioner two hours in does not read that as "one tap
  // away", they read it as gone.
  const s = readFileSync(path.join(REPO, 'app/sim/tracker/page.js'), 'utf8');
  assert.match(s, /getOpenTrackerDraft/, 'must look for an open draft');
  assert.match(s, /redirect\(`\/sim\/draft\/\$\{open\.id\}`\)/,
    'an active room must be returned to, not advertised');
  // The home screen still exists - it is what renders when there is no room.
  assert.match(s, /TrackerStart/, 'setup lives here');
  assert.match(s, /What the tracker is/, 'and the explanation');
  assert.match(s, /YourDrafts/, 'and its history');
});

test('THE ROOM CARRIES THE WAY BACK OUT, which is what lets the tab bring you in', () => {
  // Without this the room is the trapdoor the resume card was trying to avoid.
  const s = readFileSync(path.join(REPO, 'components/sim/TrackerRoom.js'), 'utf8');
  // ?home=1 IS LOAD-BEARING. Without it the breadcrumb lands on a page that
  // resumes straight back into the room - which is exactly the dead link a
  // device pass found. The param is how the tab's arrival and the
  // breadcrumb's arrival are told apart.
  assert.match(s, /href="\/sim\/tracker\?home=1"/, 'the breadcrumb must suppress the resume');
  assert.match(s, /Tracker home/);
  const page = readFileSync(path.join(REPO, 'app/sim/tracker/page.js'), 'utf8');
  assert.match(page, /params\.home === '1'/, 'and the page must honour it');
  assert.match(page, /if \(open && !goHome\)/, 'resume only when NOT arriving from the room');
  assert.match(page, /Resume &mdash; Rd \{resume\.round\} Pick \{resume\.pickInRound\}/,
    'and the card is the way back');
});

test('THE ROOM\'S VIEW SWITCHER STACKS ABOVE THE APP BAR, not under it', () => {
  // .trk-tabs is fixed at bottom:0 z-index 50 and .apptab is the same position
  // at 60, so the switcher was BURIED - which on a device reads as the room
  // losing its tabs. The offset applies only when the bar is actually present.
  const css = readFileSync(path.join(REPO, 'components/shell/apptab.css'), 'utf8');
  assert.match(css, /html\[data-appbar\] \.trk-tabs \{ bottom: var\(--sv-appbar-h\)/,
    'the room bar must sit above the app bar');
  assert.match(css, /--sv-appbar-h/, 'the app bar must publish its own height');
  const bar = readFileSync(path.join(REPO, 'components/shell/AppTabBar.js'), 'utf8');
  assert.match(bar, /setAttribute\('data-appbar'/, 'declared by the bar, not assumed by the room');
  assert.match(bar, /removeAttribute\('data-appbar'/, 'and cleared, or the web room offsets for nothing');
});

test('THE PRACTICE PAGE NO LONGER STARTS A TRACKER - two flows, two homes', () => {
  const s = readFileSync(path.join(REPO, 'app/sim/page.js'), 'utf8');
  assert.equal(/TrackerStart/.test(s), false, 'the setup moved to the tracker tab');
  assert.match(s, /Tracking a real draft\?/, 'one link out is enough');
});

test('the BOARD grid scrolls sideways with the same fade affordance', () => {
  const wrap = /\.trk-grid-wrap \{([^}]*)\}/.exec(TRACKER);
  assert.ok(wrap, '.trk-grid-wrap rule missing');
  assert.match(wrap[1], /overflow-x:\s*auto/, 'a 12-team grid cannot fit 390px');
  assert.match(wrap[1], /mask-image/, 'needs the same fade cue as the preset rail');
});

test('the grid round gutter is sticky while scrolling sideways', () => {
  const rd = /\.trk-grid-row \.rd \{([^}]*)\}/.exec(TRACKER);
  assert.ok(rd, '.trk-grid-row .rd rule missing');
  assert.match(rd[1], /position:\s*sticky/, 'round number must stay visible across 12 columns');
});

test('the LIST|GRID toggle has a usable tap target', () => {
  const btn = /\.trk-viewtog button \{([^}]*)\}/.exec(TRACKER);
  assert.ok(btn, '.trk-viewtog button rule missing');
  const m = /min-height:\s*(\d+)px/.exec(btn[1]);
  assert.ok(m && Number(m[1]) >= 36, 'toggle tap target too small');
});

test('LIST stays the default board view, persisted for the session only', () => {
  // Asserts the INVARIANT, not the mechanism: the default was originally
  // useState('list') and is now the useSyncExternalStore server snapshot (the
  // refactor was to satisfy react-hooks/set-state-in-effect). Either way the
  // answer before any user choice must be 'list'.
  const s = readFileSync(path.join(REPO, 'components/sim/TrackerRoom.js'), 'utf8');
  assert.match(s, /getServer\(\)\s*\{\s*return 'list'/, 'the at-the-table view must be the default');
  assert.match(s, /=== 'grid' \? 'grid' : 'list'/, 'anything but an explicit grid choice reads as list');
  assert.match(s, /sessionStorage/, 'the toggle persists for the session only');
  assert.ok(!/localStorage/.test(s), 'a board preference must not outlive the session');
});
