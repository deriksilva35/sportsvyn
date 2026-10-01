// components/sim/draftOneScroll.test.mjs - the draft room at 390 x 844 (thu-7),
// as SOURCE and CSS facts. The DOM half lives in draftRoomV2.test.mjs (tab
// swap, scroll memory, the measured --dv-stick, AUTO in the clock bar, the
// fold); this half pins what jsdom cannot see: which boxes scroll, what
// sticks where, and that the dark page and the desktop room did not move.
//
// THE DEFECT: on a phone the room was a 68dvh swipe pager whose three pages
// each scrolled (overflow-y: auto) inside a page that also scrolled, with the
// BOARD / PICK / ROSTER tabs BELOW the pager and the first player row ~660 px
// down. Measured on the harness when this shipped - see the commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rules } from '../../lib/brand/darkParity.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');
const CSS = read('components/sim/sim.css');
const ROOM = read('components/sim/DraftRoom.js');
const PAGE = read('app/sim/draft/[id]/page.js');
const ARC = ':where(:root[data-theme="arcade"])';
const PHONE = '@media (max-width: 900px)';
const ALL = rules(CSS);

/** Every declaration body whose selector list holds exactly `sel` (already context-prefixed). */
function body(sel) {
  return ALL.filter((r) => r.sel.split(',').map((x) => x.trim()).includes(sel)).map((r) => r.body).join(';');
}
const phone = (sel) => body(`${PHONE} ${ARC} ${sel}`);

test('THE PAGER IS NOT A SCROLLER on the arcade phone page: no height, no overflow, no snap', () => {
  const p = phone('.pager');
  assert.match(p, /display:\s*block/);
  assert.match(p, /height:\s*auto/);
  assert.match(p, /overflow:\s*visible/);
  assert.match(p, /scroll-snap-type:\s*none/);
  assert.match(phone('.room .pager .page'), /overflow:\s*visible/);
  assert.match(phone('.pager .page .zone-body'), /overflow:\s*visible/);
  // and nothing in the arcade phone block brings a vertical box back
  const arcPhone = ALL.filter((r) => r.sel.startsWith(`${PHONE} ${ARC}`));
  for (const r of arcPhone) {
    assert.doesNotMatch(r.body, /overflow(-y)?:\s*(auto|scroll)/, `${r.sel} must not scroll`);
    assert.doesNotMatch(r.body, /\d+(dvh|vh|svh)/, `${r.sel} must not size to the viewport`);
  }
});

test('ONE PAGE SHOWN AT A TIME, chosen by .room[data-page] - which the room renders', () => {
  assert.match(phone('.room .pager .page'), /display:\s*none/);
  // one rule, three selectors: rules() prefixes the @media context to the
  // first selector of a list only, so this reads the list itself
  const show = ALL.find((r) => r.sel.startsWith(PHONE) && r.sel.includes('.room[data-page="PICK"]'));
  assert.ok(show, 'the show rule is in the phone block');
  for (const [name, cls] of [['BOARD', 'pg-board'], ['PICK', 'pg-pick'], ['ROSTER', 'pg-roster']]) {
    assert.ok(show.sel.includes(`${ARC} .room[data-page="${name}"] .pager .page.${cls}`), name);
  }
  assert.match(show.body, /display:\s*flex/);
  assert.match(ROOM, /className=\{`room\$\{view === 'board' \? ' room--board' : ''\}`\} data-page=\{PAGES\[page\]\}/);
});

test('THE STICKY STACK: clock bar, tabs, then the list header and the board\'s seat row, by fixed heights', () => {
  const room = phone('.room');
  assert.match(room, /--dv-clk-h:\s*64px/);
  assert.match(room, /--dv-seg-h:\s*40px/);
  assert.match(room, /--dv-stack:\s*calc\(var\(--dv-stick, 0px\) \+ var\(--dv-clk-h\) \+ var\(--dv-seg-h\)\)/);
  const clk = phone('.dv-clk');
  assert.match(clk, /position:\s*sticky/);
  assert.match(clk, /top:\s*var\(--dv-stick, 0px\)/);
  assert.match(clk, /height:\s*var\(--dv-clk-h\)/);
  const seg = phone('.room-seg');
  assert.match(seg, /position:\s*sticky/);
  assert.match(seg, /top:\s*calc\(var\(--dv-stick, 0px\) \+ var\(--dv-clk-h\)\)/);
  assert.match(seg, /height:\s*var\(--dv-seg-h\)/);
  assert.match(seg, /order:\s*1/, 'the tabs sit ABOVE the list now');
  assert.match(phone('.pager .page .nhead'), /--nhead-top:\s*var\(--dv-stack\)/);
  assert.match(phone('.pg-board .bg2 .bh'), /position:\s*sticky;\s*top:\s*var\(--dv-stack\)/);
  assert.match(phone('.pager .page .p-row'), /scroll-margin-top:\s*calc\(var\(--dv-stack\) \+ 34px\)/);
  // stacking: clock over tabs over the list header (numcols.css owns its z 5)
  const z = (b) => Number(b.match(/z-index:\s*(\d+)/)[1]);
  assert.ok(z(clk) > z(seg) && z(seg) > 5);
});

test('THE STACK STARTS UNDER THE WEB\'S STICKY HEADER: --dv-stick is measured from .sim-head, never typed', () => {
  assert.match(ROOM, /document\.querySelector\('\.sim-head'\)/);
  assert.match(ROOM, /setProperty\('--dv-stick', `\$\{Math\.round\(bar\.getBoundingClientRect\(\)\.height\)\}px`\)/);
  assert.match(ROOM, /isShellClient\(\{ cookie: document\.cookie \}\)/, 'not in the app, where the header goes');
  assert.doesNotMatch(CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /--dv-stick:\s*\d/, 'no typed header height');
});

test('THE PICK BAR STICKS TO THE BOTTOM, above the app tab bar only where that bar shows', () => {
  const ft = phone('.dv-ft');
  assert.match(ft, /position:\s*sticky/);
  assert.match(ft, /bottom:\s*0/);
  assert.match(ft, /order:\s*4/, 'last in the room - it used to render ABOVE the pager');
  assert.match(ft, /padding-bottom:\s*calc\(10px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  const app = body(`${PHONE} :where(:root[data-theme="arcade"][data-appbar]:not([data-clock])) .dv-ft`);
  assert.match(app, /bottom:\s*var\(--sv-appbar-h\)/);
  // --sv-appbar-h is on :root EVERYWHERE (apptab.css loads in the root
  // layout), so the offset must be gated on data-appbar, never on the var.
  assert.doesNotMatch(ft, /--sv-appbar-h/);
});

test('AUTO IS IN THE CLOCK BAR, on the phone page only; the room-head that held it folds away', () => {
  assert.match(body(`${ARC} .dv-auto`), /display:\s*none/, 'hidden everywhere but the phone');
  assert.match(phone('.dv-auto'), /display:\s*inline-flex/);
  assert.match(phone('.room-head'), /display:\s*none/);
  // the SAME handler as the room-head switch - confirm on, single tap off
  assert.match(ROOM, /className=\{`dv-auto\$\{auto \? ' on' : ''\}`\}\s*onClick=\{toggleAuto\}/);
  assert.equal((ROOM.match(/onClick=\{toggleAuto\}/g) ?? []).length, 2, 'two switches, one handler');
  assert.match(ROOM, /\{arcade && !complete && \(/);
});

test('THE FILTERS FOLD on the arcade page; desktop opens the fold and hides its summary', () => {
  assert.match(ROOM, /<details className="dv-filt" ref=\{filtRef\}>\s*<summary>\{filtSummary\}<\/summary>\s*\{moreFilters\}\s*<\/details>\s*\) : moreFilters\}/);
  assert.match(ROOM, /`Filters\$\{filtOn \? ` \(\$\{filtOn\}\)` : ''\} · Sort: \$\{sortOpts\.find\(\(o\) => o\.key === activeSort\)\?\.label \?\? 'ADP'\}`/);
  assert.match(ROOM, /window\.matchMedia\('\(min-width: 901px\)'\)\.matches\) d\.open = true/);
  assert.match(body(`@media (min-width: 901px) ${ARC} .dv-filt > summary`), /display:\s*none/);
});

test('THE GAME LOG IS NOT A VERTICAL BOX on the phone page (it still pans sideways)', () => {
  assert.match(phone('.s-scroll'), /max-height:\s*none/);
});

test('THE PAGE HANDS THE ROOM ITS THEME from arcadeFor(isShell)', () => {
  assert.match(PAGE, /import \{ arcadeFor \} from '@\/lib\/brand\/theme';/);
  assert.match(PAGE, /arcade=\{arcadeFor\(isShell\)\}/);
});

test('DESKTOP AND DARK ARE UNTOUCHED: every new rule is arcade-scoped; the dark pager is as it was', () => {
  const block = CSS.slice(CSS.indexOf('ONE SCROLL (thu-7'));
  for (const r of rules(block.slice(block.indexOf('*/') + 2))) {
    assert.match(r.sel, /data-theme="arcade"/, `${r.sel} is not arcade-scoped`);
  }
  assert.match(CSS, /\.pager \{ display: flex; order: 2; height: 68dvh;/, 'the dark phone pager still swipes');
  assert.match(CSS, /\.zone-body \{ padding: 8px 10px; max-height: 70vh; overflow-y: auto; \}/, 'the desktop columns still scroll');
});
