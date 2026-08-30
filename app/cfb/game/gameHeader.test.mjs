// app/cfb/game/gameHeader.test.mjs — D8: the header row, the rail, and the
// typography sweep. Run: node --test app/cfb/game/gameHeader.test.mjs
//
// WHY THIS FILE EXISTS, and it is worth saying plainly: c09beb4 shipped a
// broken header and EVERY served check passed. Occurrence counts found the
// chip, the bytes grew, the rules were in the chunk - and the row had wrapped
// onto two lines on a phone, because nothing anywhere asserted GEOMETRY.
//
// THE BUG WAS A CHILD COUNT. .gg-teamrow was `grid-template-columns: 44px 1fr
// auto` with auto-placed children, so three children landed right and a fourth
// wrapped onto a second implicit row, taking the score with it. Adding the
// record chip made every row four children and a ranked row five. No CSS rule
// changed; the grid was silently depending on a count the markup was free to
// change, which is the same flex/grid trap that bit the drive chart twice.
//
// So these tests pin the two halves that make a flex row single-line: every
// fixed child declares flex:none, and the one child allowed to give way
// declares min-width:0. Neither can be asserted by counting occurrences.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const CSS = src('app/nfl/game/[slug]/game.css');
const CFB = src('app/cfb/game/[slug]/page.js');
const NFL = src('app/nfl/game/[slug]/page.js');
const TABS = src('components/gridiron/GameTabs.js');

// Anchored at a line start so a selector that is also the TAIL of a grouped
// selector list cannot be mistaken for its own rule - ".gg-teamrow .score"
// appears at the end of the shared flex:none group as well as on its own.
const rule = (sel) => {
  const re = new RegExp(`^${sel.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm');
  const m = re.exec(CSS);
  assert.ok(m, `${sel} has no rule of its own`);
  return CSS.slice(m.index, CSS.indexOf('}', m.index) + 1);
};

// ------------------------------------------------------- the header geometry

test('THE HEADER ROW IS A FLEX LINE THAT CANNOT WRAP', () => {
  const r = rule('.gg-teamrow');
  assert.match(r, /display: flex/);
  assert.match(r, /flex-wrap: nowrap/);
  // THE GRID IS GONE. It is named here so a future edit that reaches for
  // grid-template-columns on this row has to read why it was removed.
  assert.doesNotMatch(r, /display: grid/);
  assert.doesNotMatch(r, /grid-template-columns/);
});

test('EVERY FIXED CHILD DECLARES flex:none — the count can never matter again', () => {
  // This is the actual fix. Under the old grid, adding or removing a child
  // re-placed all the others; under flex with each part pinned, a new child
  // takes its own space and moves nobody.
  const r = rule('.gg-teamrow .rk, .gg-teamrow .abbr, .gg-teamrow .gg-rec, .gg-teamrow .score');
  assert.match(r, /flex: none/);
  for (const child of ['.rk', '.abbr', '.gg-rec', '.score']) {
    assert.ok(r.includes(child), `${child} must be pinned flex:none or it will stretch`);
  }
});

test('THE NAME IS THE ONLY CHILD THAT GIVES WAY, and it has min-width:0', () => {
  const r = rule('.gg-teamrow .tname');
  assert.match(r, /flex: 1 1 auto/);
  // min-width:0 IS THE HALF PEOPLE FORGET. A flex item will not shrink below
  // its content width without it; the row overflows instead of ellipsising,
  // which is how a long team name pushes a score off the screen.
  assert.match(r, /min-width: 0/);
  assert.match(r, /text-overflow: ellipsis/);
  assert.match(r, /white-space: nowrap/);
});

test('THE SCORE IS RIGHT-ALIGNED ON THE SAME LINE, both rows', () => {
  const r = rule('.gg-teamrow .score');
  assert.match(r, /margin-left: auto/, 'pushed to the right edge, not floated or absolute');
  assert.match(r, /text-align: right/);
  assert.match(r, /font-variant-numeric: tabular-nums/, 'so 7 and 42 line up between the rows');
});

test('the box math is written down, with the worst case named', () => {
  // A layout claim nobody can re-derive is a layout claim nobody can check.
  const c = CSS.slice(CSS.indexOf('BOX MATH AT 375'), CSS.indexOf('.gg-teamrow {'));
  assert.match(c, /North Dakota State/);
  assert.match(c, /343/, 'the usable width after .gg-wrap padding');
  assert.match(c, /203/, 'what is left for the name');
});

test('MARKUP ORDER IS LAYOUT ORDER, and both codes agree on it', () => {
  const row = (s) => {
    const i = s.indexOf('function TeamRow');
    return s.slice(i, s.indexOf('\n}', i));
  };
  const cfb = row(CFB);
  // badge, abbr, name, record, score - in that source order.
  const order = ['<RankBadge', 'className="abbr"', 'className="tname"', 'className="gg-rec"', 'className="score"'];
  let at = -1;
  for (const m of order) {
    const i = cfb.indexOf(m);
    assert.ok(i > at, `${m} is out of order in the CFB header row`);
    at = i;
  }
  // The NFL row is the same minus the badge it has no poll for.
  const nfl = row(NFL);
  assert.equal(nfl.includes('<RankBadge'), false);
  let bt = -1;
  for (const m of ['className="abbr"', 'className="tname"', 'className="gg-rec"', 'className="score"']) {
    const i = nfl.indexOf(m);
    assert.ok(i > bt, `${m} is out of order in the NFL header row`);
    bt = i;
  }
});

test('the winner law is the SCOREBOARD\'s: loser muted, winner left alone', () => {
  // /scores says "Winner full white, loser muted" and the game page says the
  // same thing in the same way. Volt is this product's ACTIVE/SELECTED colour -
  // the sub-nav, the chips, the rank badge - and spending it on a winner would
  // make a finished game look like a selected one.
  assert.match(CSS, /\.gg-teamrow\.loser \.tname, \.gg-teamrow\.loser \.score \{ color: var\(--muted\); \}/);
  const gi = src('components/gridiron/gridiron.css');
  assert.match(gi, /Winner full white, loser muted/);
});

// ------------------------------------------------------------ the em dashes

test('NO EM DASH REACHES A READER, in either relay\'s new strings', () => {
  // The surface's typography is hyphens. An em dash in rendered copy reads as
  // a different voice the moment it lands beside the rest of the page.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = [
    'lib/cfb/boxScore.js', 'lib/standings/view.js', 'lib/standings/columns.js',
    'lib/standings/read.js', 'components/standings/StandingsPage.js',
    'components/gridiron/GameTabs.js', 'components/pickem/PickemBoard.js',
    'components/gridiron/Scoreboard.js', 'components/soccer/MatchCenter.js',
    'app/cfb/game/[slug]/page.js', 'app/nfl/game/[slug]/page.js',
    'app/cfb/standings/page.js', 'app/nfl/standings/page.js',
    'lib/gridiron/oddsReader.js', 'lib/gridiron/gameTabsNav.js',
  ];
  for (const f of files) {
    const code = stripComments(src(f));
    assert.equal(code.includes('—'), false, `${f} renders an em dash`);
    assert.equal(code.includes('\\u2014'), false, `${f} renders an escaped em dash`);
  }
  // The specific string this sweep was called for.
  assert.match(src('lib/cfb/boxScore.js'), /'Final - complete box score pending'/);
});

test('the ABSENT glyph is untouched - an en dash is not an em dash', () => {
  // U+2013 is the product's absence mark and appears in tables everywhere.
  // The sweep must not have caught it.
  assert.match(src('lib/cfb/boxScore.js'), /const ABSENT = '–'/);
});

// --------------------------------------------------------------- the rail

test('THE RAIL SITS UNDER LINE SCORE and swaps sections rather than stacking', () => {
  const ls = CFB.indexOf('aria-label="Line score"');
  const rail = CFB.indexOf('<GameTabs');
  const facts = CFB.indexOf('<GameFacts');
  assert.ok(ls > 0 && rail > ls, 'the rail must come after the line score');
  assert.ok(rail < facts, 'and before the game facts');
  // The drives section is a NODE handed to the rail, not a sibling section -
  // that is what makes the two swap instead of stacking.
  assert.match(CFB, /nodes=\{\{ drives: drivesNode \}\}/);
  assert.equal((CFB.match(/aria-label="Drive chart"/g) ?? []).length, 1,
    'exactly one drives section exists, and the rail owns it');
});

test('DRIVES IS THE DEFAULT, and PLAYER LINES obeys the tab rule', () => {
  const p = CFB.slice(CFB.indexOf('const panels = ['), CFB.indexOf('const activeTab'));
  // Order is default: GameTabs opens on panels[0].
  assert.match(p, /\{ key: 'drives', label: 'DRIVES' \}/);
  assert.ok(p.indexOf("key: 'drives'") < p.indexOf("key: 'players'"), 'drives is first, so drives is default');
  assert.match(p, /boxTeams\.length \? \{ key: 'players', label: 'PLAYER LINES' \} : null/);
  assert.match(TABS, /useState\(initial \?\? panels\[0\]\?\.key\)/);
});

test('ONE PANEL MEANS NO RAIL - a single tab is furniture, not a control', () => {
  assert.match(CFB, /\{panels\.length > 1 \? \(/);
  assert.match(CFB, /\) : drivesNode\}/);
});

test('ODDS STAYS WHERE THE PREGAME GUARD PUT IT - it is not a tab', () => {
  const odds = CFB.indexOf('<OddsStrip');
  const rail = CFB.indexOf('<GameTabs');
  assert.ok(odds > 0 && odds < rail, 'the odds strip stays above the rail, pregame-guarded');
  assert.match(CFB, /isPreGame\(game\.status\) && odds \? <OddsStrip/);
  assert.equal(CFB.includes("key: 'odds'"), false, 'and never becomes a panel');
});

test('the NFL page inherits the component, and is otherwise untouched here', () => {
  assert.match(NFL, /<GameTabs/);
  // It declares its own panels; this relay did not add a drives panel to it.
  assert.match(NFL, /const panels = \[/);
  assert.equal(NFL.includes("key: 'drives'"), false);
});
