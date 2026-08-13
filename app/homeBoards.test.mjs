// app/homeBoards.test.mjs — the two Top 5 ranking boards on the homepage.
//
// WHAT THESE GUARD. The boards are the /nfl and /cfb Today-page instrument
// reused, not a homepage copy of one, and the whole value of that is that it
// stays reused. Three ways it silently stops being true:
//
//   · someone forks EditorialBoard for the homepage, and the same ranking then
//     renders two different ways on two pages
//   · a board read loses its .catch, so one league's ranking table taking a
//     bad day takes the entire homepage down with it
//   · the "Full board ->" links drift off the routes that actually exist, which
//     is invisible in review and only shows up as a 404 in the wild
//
// The page is a server component that reaches for the database, so it cannot be
// rendered here. Its wiring is asserted on source; the routes it links to are
// asserted against the filesystem, which is the part a source scan alone would
// happily let rot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boardHref, previewEntries, darkHorseCount, RANKING_TABS, resolveActiveTab,
} from '../lib/gridiron/rankingsHub.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const page = stripComments(src('app/page.js'));
const css = src('app/home.css');

// ---------------------------------------------------------------------------
// The instrument is shared, not copied
// ---------------------------------------------------------------------------

test('the homepage renders the real EditorialBoard, not a homepage variant', () => {
  assert.match(page, /import EditorialBoard from '@\/components\/gridiron\/EditorialBoard'/,
    'the shared component, imported by path');
  assert.match(page, /<EditorialBoard[^>]*preview/,
    'preview mode: top 5 + dark-horse teaser + full-board link');
  // A local re-implementation would show up as board markup living in page.js.
  assert.ok(!/gi-ed-row|gi-ed-rk|gi-ed-list/.test(page),
    'board row markup must live in EditorialBoard, never be re-drawn on the homepage');
});

test('the boards are fed by the same reader the league pages use', () => {
  assert.match(page, /getEditorialBoard\('nfl-power', 'nfl'\)/, 'NFL Power Rankings');
  assert.match(page, /getEditorialBoard\('cfb-top25', 'cfb'\)/, 'CFB Top 25');
  // Same reader, same list slugs, same league slugs as the Today pages - so a
  // change to any one of those moves both surfaces together.
  const today = stripComments(src('components/gridiron/TodayPage.js'));
  assert.match(today, /getEditorialBoard\(isNfl \? 'nfl-power' : 'cfb-top25', leagueSlug\)/,
    'if the Today page changes its list slugs, this test names the homepage as the other caller');
});

test('the stylesheet the component needs is actually loaded', () => {
  // EditorialBoard styles live in gridiron.css, which the homepage did not
  // previously import. Without it the board renders as unstyled list items -
  // no border, no ranks column, no ink block.
  assert.match(page, /import '@\/components\/gridiron\/gridiron\.css'/);
});

// ---------------------------------------------------------------------------
// One league dark must not take anything else with it
// ---------------------------------------------------------------------------

test('each board read is caught independently and cannot fail the page', () => {
  for (const call of ["getEditorialBoard('nfl-power', 'nfl')", "getEditorialBoard('cfb-top25', 'cfb')"]) {
    const i = page.indexOf(call);
    assert.ok(i > -1, `${call} must be present`);
    assert.match(page.slice(i, i + call.length + 24), /\.catch\(\(\) => null\)/,
      `${call} must swallow its own failure - a ranking table is one unit on the page, not the page`);
  }
});

test('a dark league yields no empty cell, and two dark leagues yield no section', () => {
  // The filter mirrors EditorialBoard's own guard (it returns null for an empty
  // board), so nothing renders a slot the component refused to fill.
  assert.match(page, /\.filter\(\(b\) => b\.board\?\.entries\?\.length\)/,
    'only boards with entries render');
  assert.match(page, /if \(live\.length === 0\) return null/,
    'both dark -> the section is absent, not an empty frame');
  // The solo modifier is retired with the two-up grid. The boards now STACK in
  // the right rail, so a surviving board already occupies the full column
  // width and there is no half-empty row for it to grow into.
  assert.ok(!/dc-boards--solo/.test(page), 'no width modifier - stacked boards are already full width');
});

// ---------------------------------------------------------------------------
// Placement and layout
// ---------------------------------------------------------------------------

test('THE BOARDS MOVED TO THE RAIL, below the slate', () => {
  // They used to sit inside the Daily Card, two-up, between the Movement Card
  // and Today's Reads. The homepage went two-column, and the rail is where the
  // instruments live now: today's games first, because it is the most
  // perishable thing on the page, then the two standings reads.
  const at = (needle) => {
    const i = page.indexOf(needle);
    assert.ok(i > -1, `${needle} must be on the page`);
    return i;
  };
  const card = at('<article className="daily-card">');
  const rail = at('<aside className="right-rail home-rail">');
  const slate = at('<TodaysGames');
  const boards = at('<RailBoards');
  assert.ok(card < rail, 'the card leads the DOM, so the phone stack puts it first');
  assert.ok(rail < slate && slate < boards, 'inside the rail: slate, then boards');
  // And they are out of the card entirely.
  const reads = at('<TodaysReadsSection');
  assert.ok(reads < rail, 'Today\'s Reads is still card content, and the rail follows the card');
});

test('stacked in a 340px rail, not two-up', () => {
  // Side by side inside the rail would give each board about 165px, narrower
  // than a team name plus a record.
  assert.ok(!/dc-boards/.test(page), 'the two-up grid is gone from the page');
  assert.match(css, /\.home-rail \{[\s\S]*?flex-direction: column;/,
    'the rail stacks its units');
  assert.match(css, /\.home-main--football \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 340px;/);
  // The 760px rule still governs the units themselves once stacked.
  assert.match(css, /@media \(max-width: 760px\)/);
});

test('the board inherits mono, as it does under the .gi shell', () => {
  // .gi-ed-nm declares no font-family on purpose: inside the gridiron routes it
  // inherits JetBrains Mono from .gi. There is no .gi ancestor on the paper
  // card, so without this the SAME instrument reads in the card's serif here
  // and in mono everywhere else.
  assert.match(css, /\.dc-boards \{[^}]*font-family: var\(--font-jetbrains-mono\), monospace/);
  const gi = src('components/gridiron/gridiron.css');
  assert.match(gi, /\.gi \{[^}]*font-family: var\(--font-jetbrains-mono\), monospace/,
    'the wrapper is supplying exactly what .gi supplies');
  assert.ok(!/\.gi-ed-nm \{[^}]*font-family/.test(gi),
    'if .gi-ed-nm ever declares its own family, this wrapper is redundant and should go');
});

// ---------------------------------------------------------------------------
// The links go somewhere real
// ---------------------------------------------------------------------------

test('each board links to a full-rankings route that EXISTS', () => {
  assert.match(page, /boardHref\('nfl', 'power'\)/);
  assert.match(page, /boardHref\('cfb', 'top25'\)/);
  assert.equal(boardHref('nfl', 'power'), '/nfl/rankings?tab=power');
  assert.equal(boardHref('cfb', 'top25'), '/cfb/rankings?tab=top25');
  // The part a source scan would miss: the routes have to be on disk. Both hubs
  // shipped before this board did, so neither link is a promise.
  assert.ok(existsSync(path.join(REPO, 'app/nfl/rankings/page.js')), '/nfl/rankings must exist');
  assert.ok(existsSync(path.join(REPO, 'app/cfb/rankings/page.js')), '/cfb/rankings must exist');
});

test('the tab keys the links carry are real tabs on those hubs', () => {
  // A href to ?tab=power on a hub with no 'power' tab silently falls back to
  // the first tab - the link would "work" and land on the wrong board.
  assert.equal(resolveActiveTab(RANKING_TABS.nfl, 'power').list, 'nfl-power',
    'the NFL link must land on the board the homepage previewed');
  assert.equal(resolveActiveTab(RANKING_TABS.cfb, 'top25').list, 'cfb-top25',
    'the CFB link must land on the board the homepage previewed');
});

// ---------------------------------------------------------------------------
// What the preview actually shows
// ---------------------------------------------------------------------------

test('"Top 5" in the title is what the component renders', () => {
  // The titles promise five rows. previewEntries is what delivers them, and
  // EditorialBoard hardcodes the 5 - so the promise and the slice must agree.
  assert.match(page, /title: 'NFL Power Rankings · Top 5'/);
  assert.match(page, /title: 'The Sportsvyn 25 · Top 5'/);
  const board = stripComments(src('components/gridiron/EditorialBoard.js'));
  assert.match(board, /previewEntries\(board\.entries, 5\)/, 'preview mode slices to five');
  // PROD shapes: nfl-power is 32 entries with 5 dark horses, cfb-top25 is 25
  // with 5. Five rows off the top, five dark horses teased, in both.
  for (const n of [25, 32]) {
    const entries = Array.from({ length: n }, (_, i) => ({ rank: i + 1, band: i >= n - 5 ? 'dark_horse' : null }));
    assert.equal(previewEntries(entries, 5).length, 5);
    assert.equal(darkHorseCount(entries), 5, 'the "+ 5 dark horses" teaser');
  }
});

test('each board is called what the page it links to calls it', () => {
  // A preview headed "CFB Top 25" linking to a page headed "The Sportsvyn 25"
  // makes one board read as two. The CFB board is not a generic poll and the
  // name is the point, so the homepage title carries the list's own name -
  // ranking_lists.name, which is also the hub's tab label.
  const cfbTab = RANKING_TABS.cfb.find((t) => t.key === 'top25');
  assert.equal(cfbTab.label, 'The Sportsvyn 25', 'the hub tab names the board');
  assert.match(page, new RegExp(`title: '${cfbTab.label} · Top 5'`),
    'and the homepage preview must use that same name - if the hub renames the board, rename it here too');
  // The NFL tab label is deliberately shorter ("Power Rankings") because it
  // already sits under /nfl/rankings; unqualified on the homepage it would not
  // say which league, so that one carries ranking_lists.name in full.
  assert.equal(RANKING_TABS.nfl.find((t) => t.key === 'power').label, 'Power Rankings');
  assert.match(page, /title: 'NFL Power Rankings · Top 5'/);
});

test('no movement deltas are rendered, because there are none to render', () => {
  // Every current edition is Edition 0. Edition 0 has no prior, so all rows
  // carry rank_movement NULL - the reader does not even select the column.
  // Drawing a jade or terra delta here would mean inventing one.
  const readers = stripComments(src('lib/gridiron/readers.js'));
  const fn = readers.slice(readers.indexOf('export async function getEditorialBoard'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(!/rank_movement|movement_label|previous_rank/.test(body),
    'the reader selects no movement column - if that changes, the board should show deltas and this test should be rewritten');
  const board = stripComments(src('components/gridiron/EditorialBoard.js'));
  assert.ok(!/jade|terra|movement/i.test(board), 'and the component draws no delta');
});
