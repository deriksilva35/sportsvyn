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
  assert.deepEqual(anyRule('.wkv-list'), [], 'no rule styles .wkv-list');
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
  assert.equal((PAGE.match(/<Shell>/g) ?? []).length, 3, 'none, settled and locked still render <Shell> with the crumb');
});

test('THE HEADER READS ITS WORDS FROM DATA, never a typed week or format', () => {
  assert.match(ROOM, /const hd = headerParts\(contest\);/);
  assert.match(ROOM, /<h1 className="wkv-title"><b>\{hd\.title\}<\/b> &middot; \{hd\.format\}<\/h1>/);
  const code = ROOM.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /PPR, drop worst/, 'the format words are not typed in the room');
  assert.doesNotMatch(code, /Week \d/, 'nor is a week number');
});
