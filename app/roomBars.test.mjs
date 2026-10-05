// app/roomBars.test.mjs - every room's bottom bar sits ABOVE the app's tab bar.
//
// THE BUG (mon-11 item 1): in the iOS container The Daily's lock bar ("0 of 8
// in" + Lock it in) was under the app's fixed tab bar. The tracker room had the
// same bug before it (its view switcher was "lost"), and Six, EPL Weekly 5, the
// league builder and the lobby's pinned row had it unreported - because each
// room that pins something to the foot of the screen had to remember the app
// bar on its own, and the ones that forgot were buried.
//
// THE FIX IS ONE RULE in components/shell/apptab.css, keyed on the data-appbar
// stamp AppTabBar sets only in the app. This guard WALKS EVERY STYLESHEET under
// app/ and components/ for a fixed or sticky rule with a `bottom:` and fails on
// one the shared rule does not name - a new room bar cannot be added without
// either joining the rule or being exempted here with a reason. It does not
// trust a list of files: a guard cannot see a file it does not name.
//
// It also pins the two things that made the Daily's bar invisible even at the
// end of the scroll: the tab bar's published height counts every pixel of the
// bar, and the bar's own classes cannot be restyled by a page's bare `.lb`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function walk(dir, out = []) {
  for (const e of readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.css')) out.push(rel);
  }
  return out;
}
const SHEETS = [...walk('app'), ...walk('components')];

// Innermost { } blocks - an @media wrapper is dropped and its rules kept.
function rules(css) {
  const out = [];
  for (const m of strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  }
  return out;
}

// The element a selector styles: its last compound, pseudo-free.
// `html[data-appbar] .sbd-v2 .sbd-ft` -> `.sbd-ft`; `.sb-row.you` stays whole.
function subject(sel) {
  const parts = sel.replace(/:where\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, '').trim().split(/[\s>+~]+/);
  return parts[parts.length - 1].replace(/::?[a-z-]+(\([^)]*\))?/g, '');
}

const APPTAB = read('components/shell/apptab.css');
const SHARED_RE = /html\[data-appbar\]:not\(\[data-clock\]\) :is\(([^)]*)\)\s*\{([^}]*)\}/;
const shared = strip(APPTAB).match(SHARED_RE);
const LISTED = shared ? shared[1].split(',').map((s) => s.trim()).filter(Boolean) : [];

// NOT ROOM BARS, each with the reason it may sit at bottom:0 in the app.
const EXEMPT = {
  '.apptab': 'IS the app tab bar',
  '.simtab': 'the sim\'s own tab bar - SimTabBar renders nothing in the shell (asserted below)',
};

function bottomBars() {
  const found = [];
  for (const f of SHEETS) {
    for (const r of rules(read(f))) {
      if (!/position:\s*(fixed|sticky)/.test(r.body)) continue;
      if (!/(^|[;\s])bottom\s*:/.test(r.body)) continue;
      for (const sel of r.sel.split(',')) found.push({ file: f, sel: sel.trim(), subject: subject(sel.trim()) });
    }
  }
  return found;
}

test('THE SHARED RULE EXISTS: one offset, keyed on the app bar, off while a clock runs', () => {
  assert.ok(shared, 'html[data-appbar]:not([data-clock]) :is(...) in components/shell/apptab.css');
  assert.match(shared[2], /^\s*bottom:\s*calc\(var\(--sv-appbar-h\) \+ var\(--sv-roombar-gap, 0px\)\);\s*$/,
    'the rule does one thing: lift the bar by the app bar\'s height (+ a room\'s own gap)');
  // ...and the inset the app bar has already paid is not paid twice.
  assert.match(strip(APPTAB), /html\[data-appbar\]:not\(\[data-clock\]\) \{[^}]*--sv-roombar-inset:\s*0px;/);
  assert.match(strip(APPTAB), /--sv-roombar-inset:\s*env\(safe-area-inset-bottom, 0px\)/, 'the web pays it');
  // The stamp is the bar's own, set and cleared with it.
  const bar = read('components/shell/AppTabBar.js');
  assert.match(bar, /setAttribute\('data-appbar', '1'\)/);
  assert.match(bar, /removeAttribute\('data-appbar'\)/);
});

test('EVERY FIXED OR STICKY BOTTOM RULE IN THE TREE is a listed room bar or an exempt one', () => {
  const bars = bottomBars();
  assert.ok(bars.length >= 10, `the walk found ${bars.length} - it is not seeing the tree`);
  const missing = bars.filter((b) => !LISTED.includes(b.subject) && !(b.subject in EXEMPT));
  assert.deepEqual(missing.map((b) => `${b.file}: ${b.sel}`), [],
    'add the bar to the :is() list in components/shell/apptab.css, or it hides under the app tab bar');
  // No stale names: everything listed is a real bottom bar somewhere.
  const subjects = new Set(bars.map((b) => b.subject));
  for (const l of LISTED) assert.ok(subjects.has(l), `${l} is listed but no fixed/sticky bottom rule styles it`);
});

test('THE ROOMS THAT HAD THE BUG are all in the list', () => {
  for (const s of ['.sbd-ft', '.trk-tabs', '.dv-ft', '.wkv-bar', '.sx-ft', '.e5-lockbar', '.lv-bar', '.sbd-toast', '.sb-row.you']) {
    assert.ok(LISTED.includes(s), s);
  }
  assert.match(read('components/sim/SimTabBar.js'), /if \(inShell\) return null;/, '.simtab is exempt only because of this');
});

test('THE WEB IS UNTOUCHED: every use of the app bar\'s height is gated on the app bar', () => {
  // apptab.css loads in the root layout, so --sv-appbar-h is defined on every
  // page - the variable alone cannot tell the app from the web; the stamp can.
  for (const f of SHEETS) {
    for (const r of rules(read(f))) {
      if (!/--sv-appbar-h|--sv-roombar-inset:\s*0/.test(r.body)) continue;
      if (/^:root$/.test(r.sel)) continue; // the definition
      assert.match(r.sel, /\[data-appbar|:has\(\.apptab\)/, `${f}: ${r.sel} uses the app bar's height on the web`);
    }
  }
});

test('NO ROOM TYPES ITS OWN OFFSET: --sv-appbar-h appears only in apptab.css', () => {
  for (const f of SHEETS) {
    if (f === path.join('components', 'shell', 'apptab.css')) continue;
    assert.doesNotMatch(strip(read(f)), /--sv-appbar-h/, `${f} offsets for the app bar privately - join the shared rule`);
  }
});

test('THE PUBLISHED HEIGHT IS THE BAR\'S WHOLE HEIGHT, counted from its own rules', () => {
  const r = rules(APPTAB);
  const get = (sel) => r.find((x) => x.sel === sel)?.body ?? '';
  const bar = get('.apptab');
  const item = get('.apptab-i');
  const border = Number(bar.match(/border-top:\s*(\d+)px/)?.[1]);
  const padTop = Number(bar.match(/padding:\s*(\d+)px/)?.[1]);
  const padBottom = Number(bar.match(/padding-bottom:\s*calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/)?.[1]);
  const target = Number(item.match(/min-height:\s*(\d+)px/)?.[1]);
  const published = Number(strip(APPTAB).match(/--sv-appbar-h:\s*calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/)?.[1]);
  for (const n of [border, padTop, padBottom, target, published]) assert.ok(Number.isFinite(n), 'parsed');
  assert.equal(published, border + padTop + target + padBottom,
    `--sv-appbar-h says ${published}px; the bar is ${border}+${padTop}+${target}+${padBottom}`);
  assert.match(strip(APPTAB), /body:has\(\.apptab\) \{ padding-bottom: var\(--sv-appbar-h\); \}/, 'the page clears the same height');
});

test('THE BAR\'S CLASSES ARE ITS OWN: nothing in AppTabBar can be restyled by a page\'s bare class', () => {
  // app/boards/board.css's bare .lb (padding 12px 16px 40px, width 100%) grew
  // the bar from 63px to 113px on every page that loaded it - the Daily among
  // them - and the room bars offset by 63 sat under the other 50.
  const src = read('components/shell/AppTabBar.js');
  const classes = [...src.matchAll(/className=(?:"([^"]+)"|\{`([^`$]+))/g)]
    .flatMap((m) => (m[1] ?? m[2]).trim().split(/\s+/));
  assert.ok(classes.length >= 3, classes.join(' '));
  for (const c of classes) assert.match(c, /^apptab/, `.${c} is not namespaced to the bar`);
});

test('THE DAILY\'S LOCK BAR is pinned in the app and in flow on the web', () => {
  const r = rules(read('components/daily/season/seasonBoard.css'));
  const web = r.find((x) => x.sel === '.sbd-v2 .sbd-ft')?.body ?? '';
  assert.ok(web, 'the web rule');
  assert.doesNotMatch(web, /position/, 'on the web it stays where it was: in flow at the end of the board');
  const app = r.find((x) => x.sel === 'html[data-appbar] .sbd-v2 .sbd-ft')?.body ?? '';
  assert.match(app, /position:\s*sticky/);
  assert.match(app, /bottom:\s*0/, 'the shared rule lifts it; with a clock up it sits at the foot');
  assert.match(app, /padding-bottom:\s*calc\(10px \+ var\(--sv-roombar-inset\)\)/);
  assert.match(app, /background:\s*var\(--tok-page\)/, 'opaque, or the pool scrolls through it');
  // The JSX still renders the bar with this class.
  assert.match(read('components/daily/season/SeasonBoard.js'), /<div className="sbd-ft">/);
});
