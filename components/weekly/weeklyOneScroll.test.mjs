// components/weekly/weeklyOneScroll.test.mjs - the Weekly room at 390 x 844
// (thu-2), as SOURCE and CSS facts. The DOM half lives in weeklyRoomV2.test.mjs;
// this half pins what jsdom cannot see: the sticky layers, the 3 x 2 grid and
// its 56 px ceiling, that the list is not a scroll box, and that the page no
// longer stacks a crumb, an eyebrow and a giant "Week N" over the room.
//
// Measured in the browser when this shipped (PROD's week-4 board, user 1's
// view, empty lineup): first player row bottom 416 px on a return visit and
// 620 px on a first visit with "How it works" open - was no row at all until a
// slot was tapped, and 783 px after the tap, under the app's tab bar.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');
const CSS = read('app/weekly/weekly.css').replace(/\/\*[\s\S]*?\*\//g, '');
const ROOM = read('components/weekly/WeeklyRoom.js');
const PAGE = read('app/weekly/page.js');
const ARC = ':where(:root[data-theme="arcade"])';

/** Every declaration block whose selector list contains exactly `sel` under the arcade scope. */
function arcade(sel) {
  const out = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((x) => x.trim());
    if (sels.includes(`${ARC} ${sel}`)) out.push(m[2]);
  }
  return out.join(';');
}
/** Every block, any scope, whose selector names `cls` as its final compound. */
function anyRule(cls) {
  return [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1].split(',').some((x) => new RegExp(`${cls.replace('.', '\\.')}\\s*$`).test(x.trim())))
    .map((m) => ({ sel: m[1].trim(), body: m[2] }));
}

test('THREE STICKY LAYERS, stacked by fixed heights: header, lineup, list header', () => {
  assert.match(arcade('.wkv-top'), /position:\s*sticky/);
  assert.match(arcade('.wkv-top'), /top:\s*var\(--wkv-stick, 0px\)/);
  assert.match(arcade('.wkv-top'), /height:\s*var\(--wkv-top-h\)/);
  assert.match(arcade('.wkv-dock'), /position:\s*sticky/);
  assert.match(arcade('.wkv-dock'), /top:\s*calc\(var\(--wkv-stick, 0px\) \+ var\(--wkv-top-h\)\)/);
  assert.match(arcade('.wkv-dock'), /height:\s*var\(--wkv-dock-h\)/);
  assert.match(arcade('.wkv-pan-h'), /position:\s*sticky/);
  assert.match(arcade('.wkv-pan-h'), /top:\s*calc\(var\(--wkv-stick, 0px\) \+ var\(--wkv-top-h\) \+ var\(--wkv-dock-h\)\)/);
  // THE DOCK'S HEIGHT ADDS UP: padding 6 + 56 + gap 6 + 56 + padding 10.
  assert.match(arcade('.wkv'), /--wkv-dock-h:\s*134px/);
  assert.match(arcade('.wkv-dock'), /padding:\s*6px 12px 10px/);
});

test('NO ANCESTOR IN THE ROOM IS A SCROLL CONTAINER: clip, never hidden/auto', () => {
  // hidden would make the card the sticky children's scrollport, and it never scrolls.
  assert.match(arcade('.wkv'), /overflow:\s*clip/);
  assert.match(arcade('.wkv-panel'), /overflow:\s*clip/);
});

test('THE LIST CONTAINER HAS NO overflow AT ALL - the rows are the page\'s scroll', () => {
  // (thu-6: one rule now - the bottom padding that clears the lock bar.)
  for (const r of anyRule('.wkv-list')) assert.doesNotMatch(r.body, /overflow|max-height/, `${r.sel} makes no scroll box`);
  assert.match(ROOM, /className="wkv-list"/);
  assert.doesNotMatch(ROOM, /wkv-pan-b/, 'the retired scroll box is rendered nowhere');
  for (const sel of ['.wkv-dock', '.wkv-lineup', '.wkv-panel', '.wkv-pan-h']) {
    assert.doesNotMatch(arcade(sel), /overflow(-y)?:\s*(auto|scroll)/, `${sel} does not scroll`);
  }
});

test('THE LINEUP IS 3 x 2, AND NO SLOT IS TALLER THAN 56 px', () => {
  const grid = arcade('.wkv-dock .wkv-lineup');
  assert.match(grid, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(grid, /grid-auto-rows:\s*56px/);
  const slot = arcade('.wkv-slot');
  assert.match(slot, /max-height:\s*56px/);
  assert.match(slot, /border-style:\s*solid/, 'no dashed boxes');
  assert.match(arcade('.wkv-slot-tap'), /min-height:\s*0/, 'the 74 px tap floor is lifted');
  // six slots, in SLOTS order, so the grid reads QB RB WR / TE FLEX FLEX
  assert.match(ROOM, /<div className="wkv-dock">\s*<div className="wkv-lineup">\s*\{SLOTS\.map/);
});

test('THE SELECTED SLOT KEEPS THE NAVY RING AND THE VOLT TINT', () => {
  // --volt reads navy on the arcade page; the tint is --tok-accent (volt).
  const sel = anyRule('.wkv-slot.sel');
  assert.ok(sel.some((r) => !r.sel.includes('data-theme') && /border-color:\s*var\(--volt\)/.test(r.body)));
  assert.ok(sel.some((r) => r.sel.includes('arcade') && /var\(--tok-accent\) 9%/.test(r.body)));
});

test('THE SLOT RENDERS THE SURNAME', () => {
  assert.match(ROOM, /<span className="wkv-nm">\{surnameOf\(p\.name\)\}<\/span>/);
  assert.match(ROOM, /'Tap to fill'/);
});

test('THE PAGE STACKS NOTHING OVER THE ROOM in the builder', () => {
  const builder = PAGE.slice(PAGE.indexOf('// ---- RULES / BUILDING'));
  assert.doesNotMatch(builder, /className="yr"/, 'no giant "Week N"');
  assert.doesNotMatch(builder, /className="hdr"/, 'no eyebrow');
  assert.match(builder, /<Shell crumb=\{false\}>/, 'and no "← Games" crumb - the room\'s header carries the way back');
  assert.match(builder, /firstVisit=\{firstVisit\}/);
  assert.match(builder, /howOpenByDefault\(\{ seenCookie, entry \}\)/);
  assert.match(builder, /\(await cookies\(\)\)\.get\(WEEKLY_SEEN_COOKIE\)/, 'first visit is read from a cookie, not the DB');
  // every other state keeps its crumb
  // FOUR since sun-11 item 1: a void_all week is a settled state of its own.
  assert.equal((PAGE.match(/<Shell>/g) ?? []).length, 4, 'none, settled, settled-void and locked still render <Shell> with the crumb');
});

test('THE HEADER READS ITS WORDS FROM DATA, never a typed week or format', () => {
  assert.match(ROOM, /const hd = headerParts\(contest\);/);
  assert.match(ROOM, /<h1 className="wkv-title"><b>\{hd\.title\}<\/b> &middot; \{hd\.format\}<\/h1>/);
  const code = ROOM.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /PPR, drop worst/, 'the format words are not typed in the room');
  assert.doesNotMatch(code, /Week \d/, 'nor is a week number');
});

test('THE LOCK BAR STICKS AT THE BOTTOM, above the app tab bar, paying the inset on the web', () => {
  const b = arcade('.wkv-bar');
  assert.match(b, /position:\s*sticky/);
  // On the web: the viewport's bottom, paying the home-indicator inset itself.
  assert.match(b, /bottom:\s*0/);
  assert.match(b, /padding:[^;]*var\(--sv-roombar-inset\)/, 'the home indicator is cleared on the web');
  // In the app: above the tab bar, by the SHARED room-bar rule (mon-11), keyed
  // on the stamp AppTabBar sets only when it renders (apptab.css, and so
  // --sv-appbar-h, loads on every page). No private offset, no "+ 1px".
  const app = read('components/shell/apptab.css');
  const shared = app.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(shared, /html\[data-appbar\]:not\(\[data-clock\]\) :is\([^)]*\.wkv-bar[^)]*\)\s*\{\s*bottom:\s*calc\(var\(--sv-appbar-h\)/);
  assert.match(shared, /html\[data-appbar\]:not\(\[data-clock\]\) \{\s*--sv-roombar-inset:\s*0px;/, 'and the inset is not paid twice');
  assert.doesNotMatch(CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /--sv-appbar-h/, 'no private offset left in weekly.css');
  assert.match(read('components/shell/AppTabBar.js'), /setAttribute\('data-appbar', '1'\)/);
  assert.match(app, /--sv-appbar-h:\s*calc\(63px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(b, /min-height:\s*var\(--wkv-bar-h\)/);
  assert.match(arcade('.wkv-bar .wkv-lock'), /min-height:\s*44px/, 'a 44 px target');
  assert.match(arcade('.wkv-bar .wkv-lock'), /text-transform:\s*uppercase/, 'LOCK IT IN');
  // the volt fill with navy ink is the existing .wkv-lock arcade rule
  assert.match(arcade('.wkv-lock'), /background:\s*var\(--tok-action\);\s*color:\s*var\(--tok-on-action\)/);
});

test('THE LIST\'S LAST ROW CLEARS THE BAR: bottom padding >= the bar\'s height', () => {
  const h = Number(/--wkv-bar-h:\s*(\d+)px/.exec(arcade('.wkv'))?.[1]);
  assert.ok(h >= 44 + 16, `bar height ${h}`);
  assert.match(arcade('.wkv-list'), /padding-bottom:\s*var\(--wkv-bar-h\)/);
});

test('THE BAR IS THE ROOM\'S LAST CHILD and the footer holds no button', () => {
  const tail = ROOM.slice(ROOM.indexOf('<div className="wkv-ft">'));
  const ft = tail.slice(0, tail.indexOf('THE LOCK BAR'));
  assert.doesNotMatch(ft, /<button/, 'no in-flow lock button');
  assert.match(tail, /<div className="wkv-bar"[\s\S]*onClick=\{lockItIn\}[\s\S]*<\/section>/);
});

// A SURNAME NEVER ELLIPSIZES (thu-7). Measured at 390 on PROD's week-4 pool
// (671 distinct surnames, in an open slot and in a kicked slot with its game
// line): two lines at most, nothing clipped. "Smith-Njigba", "Edwards-Helaire"
// and "Westbrook-Ikhine" (the longest) break at the hyphen.
test('THE SLOT NAME WRAPS - no ellipsis, no nowrap, no clamp - and the slot stays 56 px', () => {
  const nm = arcade('.wkv-slot .wkv-nm');
  assert.match(nm, /white-space:\s*normal/);
  assert.match(nm, /text-overflow:\s*clip/);
  assert.match(nm, /overflow:\s*visible/);
  assert.match(nm, /overflow-wrap:\s*anywhere/, 'one unbroken word still breaks rather than spill');
  // no arcade rule anywhere puts an ellipsis, a nowrap or a clamp back on the name
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/arcade/.test(m[1]) || !/\.wkv-nm\b/.test(m[1])) continue;
    assert.doesNotMatch(m[2], /ellipsis|nowrap|line-clamp/, `${m[1].trim()} must not truncate the name`);
  }
  // and the markup renders the whole surname, never a cut one
  assert.match(ROOM, /<span className="wkv-nm">\{surnameOf\(p\.name\)\}<\/span>/);
  // TWO LINES FIT: line-heights are fixed so the sum is a fact, not a hope.
  assert.match(arcade('.wkv-slot'), /max-height:\s*56px/);
  assert.match(arcade('.wkv-slot .wkv-pos'), /line-height:\s*13px/);
  assert.match(nm, /font-size:\s*12px;\s*line-height:\s*1\.05/);
  assert.ok(6 + 13 + 1 + 2 * 12 * 1.05 + 6 <= 56, 'open slot: two name lines fit');
  // a kicked slot also carries its game line: smaller name, tighter padding
  assert.match(arcade('.wkv-slot.kicked .wkv-nm'), /font-size:\s*11px;\s*line-height:\s*1\b/);
  assert.match(arcade('.wkv-slot.kicked .wkv-slot-tap'), /padding-top:\s*4px;\s*padding-bottom:\s*4px/);
  assert.match(arcade('.wkv-slot.kicked .wkv-st'), /line-height:\s*11px/);
  assert.ok(4 + 13 + 1 + 2 * 11 + 1 + 11 + 4 <= 56, 'kicked slot: two name lines and the game line fit');
});
