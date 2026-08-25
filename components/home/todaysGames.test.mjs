// components/home/todaysGames.test.mjs - the sidebar slate, and the one global
// header.
//
// Two things are checked here that only break in composition. The slate unit's
// rules - absent on an empty day, live first across both leagues, NFL rows link
// and CFB rows do not - are the kind that render fine while being wrong, and
// the day they matter is a Thursday evening. The header's rules are facts about
// how files are wired: a hardcoded MEMBER chip and a TODAY that pointed at /nfl
// both shipped and both looked correct.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const games = stripComments(src('components/home/TodaysGames.js'));
const header = stripComments(src('components/GlobalHeader.js'));
const headerServer = stripComments(src('components/GlobalHeaderServer.js'));
const home = stripComments(src('app/page.js'));
const footer = stripComments(src('components/SiteFooter.js'));
const css = src('app/home.css');

// ---------------------------------------------------------------------------
// The slate unit
// ---------------------------------------------------------------------------

test('AN EMPTY DAY RENDERS NOTHING - no frame, no heading, no "no games"', () => {
  // A permanently empty box in a rail is how the World Cup right column died,
  // and it is why the football homepage went single-column in the first place.
  assert.match(games, /if \(games\.length === 0\) return null/);
  const before = games.indexOf('if (games.length === 0) return null');
  const frame = games.indexOf('<section className="tg"');
  assert.ok(before > -1 && before < frame, 'the guard precedes any markup');
  assert.ok(!/No games|no games today|nothing scheduled/i.test(games), 'and it says nothing instead');
});

test('LIVE GAMES SORT FIRST ACROSS BOTH LEAGUES, not within each', () => {
  // getSlateByDate already orders live-first in SQL, but it returns two arrays.
  // Concatenating them would bury a live college game under a full NFL slate
  // that has not kicked off.
  assert.match(games, /\[\.\.\.games\]\.sort\(\(a, b\) => \(b\.status === 'live'\) - \(a\.status === 'live'\)\)/);
  const reader = stripComments(src('lib/gridiron/readers.js'));
  assert.match(reader, /ORDER BY \(m\.status = 'live'\) DESC/, 'and the reader keeps its own ordering');
});

test('BOTH GRIDIRON CODES LINK; anything without a route stays a plain row', () => {
  // WAS "CFB ROWS DO NOT - there is no /cfb/game". There is now, so the claim
  // inverts: the row links whenever its league HAS a route, and the fallback
  // <div> is what protects the leagues that still do not (soccer).
  assert.match(games, /const route = \{ nfl: '\/nfl\/game', cfb: '\/cfb\/game' \}\[g\.leagueSlug\]/);
  assert.match(games, /route\s*\n?\s*\? <Link className="tg-row tg-row--link" href=\{`\$\{route\}\/\$\{g\.slug\}`\}/);
  assert.match(games, /: <div className="tg-row">\{body\}<\/div>/,
    'a league with no game route must still render, just not as a link');
});

test('a game that has not kicked off shows a TIME, never a 0-0', () => {
  assert.match(games, /\{played \? <b>\{g\.awayScore \?\? ABSENT\}<\/b> : null\}/);
  assert.match(games, /\{!played \? fmtTime\(g\.kickoffAt\) : null\}/);
  assert.match(games, /import \{ ABSENT \} from '@\/lib\/gridiron\/lineScore'/,
    'one absence glyph across the gridiron surface');
});

test('ONE LINE PER GAME - the row has no block children at all', () => {
  // The first version stacked a status <div> over a teams <div> holding two
  // more <div>s. That is three block elements and therefore three lines however
  // it is styled: on a phone each game stood about five lines tall and six
  // games did not fit a screen. No CSS fixes that - the structure had to change.
  // The row CONTAINER is a <Link> for either gridiron code and a <div> for
  // anything with no game route. What must contain no block element is the BODY - that is what was
  // stacking.
  // Slice ends at the route lookup that follows the body - the old marker
  // ('return g.leagueSlug') stopped existing when CFB gained a route, and a
  // slice that misses its end silently tests the whole rest of the file.
  const body = games.slice(games.indexOf('const body = ('), games.indexOf('const route ='));
  assert.ok(!/<div/.test(body), 'every element inside a row is an inline span');
  const row = body;
  assert.match(row, /<span className=\{`tg-when/);
  assert.match(row, /<span className="tg-badge">/);
  assert.match(row, /<span className="tg-match">/);
  // when | badge | matchup, on one baseline.
  assert.match(css, /\.tg-row \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: 58px 26px minmax\(0, 1fr\);/);
  assert.match(css, /\.tg-row \{[\s\S]*?white-space: nowrap;/, 'a row never wraps');
});

test('the WHEN column carries ONE fact at a time', () => {
  // A time next to a finished game is noise; a score next to a game that has
  // not kicked off is a lie.
  const row = games.slice(games.indexOf('function Row('), games.indexOf('export default function'));
  assert.match(row, /\{live \? <><span className="tg-dot" \/>LIVE<\/> : null\}/);
  assert.match(row, /\{final \? 'FINAL' : null\}/);
  assert.match(row, /\{!played \? fmtTime\(g\.kickoffAt\) : null\}/);
});

test('only a FINAL promotes a winner', () => {
  // A leader at halftime has not won anything.
  assert.match(games, /const homeWin = final && g\.homeScore > g\.awayScore/);
  assert.match(games, /const awayWin = final && g\.awayScore > g\.homeScore/);
  assert.match(css, /\.tg-side\.dim, \.tg-side\.dim b \{ color: var\(--muted\); \}/);
});

// ---------------------------------------------------------------------------
// The phone. Every rule below shipped broken once.
// ---------------------------------------------------------------------------

test('THE MOBILE RULES ARE PARENT-SCOPED, because import order is not a mechanism', () => {
  // .gh-right and .gi-head-right are both (0,1,0) and live in DIFFERENT CSS
  // chunks, so the winner was decided by whichever chunk the route loaded last.
  // It shipped losing: the served sheet had .gh-nav,.gh-right{display:none} at
  // byte 10153 and .gi-head-right{display:flex} at 11232, so the header never
  // collapsed at any width - the nav crushed the wordmark to a sliver and
  // truncated TODAY to "TC". `.gh .gh-nav` is (0,2,0) and wins in any order.
  const chrome = src('components/site-chrome.css');
  const mobile = chrome.slice(chrome.indexOf('@media (max-width: 900px)'));
  for (const sel of ['.gh .gh-nav', '.gh .gh-burger', '.gh .wordmark',
    '.gh .gh-right .gh-my', '.gh .gh-right .gh-signin', '.gh .gh-right .gh-account']) {
    assert.ok(mobile.includes(sel), `${sel} must be parent-scoped`);
  }
  // The unscoped forms must be gone - they are the ones that lost.
  assert.ok(!/^\s*\.gh-nav, \.gh-right \{ display: none/m.test(chrome));
});

test('THE CTA SURVIVES THE COLLAPSE - the funnel does not shrink on phones', () => {
  // Hiding .gh-right wholesale would have taken MOCK DRAFT with it. The
  // container stays; its other children go.
  const chrome = src('components/site-chrome.css');
  const mobile = chrome.slice(chrome.indexOf('@media (max-width: 900px)'));
  assert.ok(!/\.gh \.gh-right \{ display: none/.test(mobile), 'the container is not hidden');
  assert.ok(!/\.gh-cta[^{]*\{[^}]*display: none/.test(mobile), 'and neither is the CTA');
  assert.match(mobile, /\.gh \.wordmark \{ flex: 0 0 auto;/,
    'the wordmark is an img with width:auto - a flex parent under pressure squeezes it to a sliver');
});

test('NOTHING TRUNCATES: every hidden label is in the drawer', () => {
  // The nav list moved to lib/nav.js so it could be unit tested on its own -
  // see lib/nav.test.mjs, which exists because The Daily shipped unreachable.
  // This still asserts the DRAWER renders the whole list rather than a subset.
  const nav = src('lib/nav.js');
  const drawer = header.slice(header.indexOf('{drawerOpen && ('));
  for (const label of ['TODAY', 'GAMES', 'SCORES', 'NFL', 'CFB', 'SOCCER']) {
    assert.ok(nav.includes(`label: '${label}'`) || drawer.includes(label), `${label} reachable`);
  }
  assert.match(drawer, /MY SPORTSVYN/, 'the label hidden from the bar is in the drawer');
  assert.match(drawer, /SIGN IN/);
  assert.match(drawer, /\{NAV\.map/, 'and the whole nav, not a subset');
});

test('A BOARD TITLE NEVER BREAKS MID-PHRASE', () => {
  // "The Sportsvyn 25 · Top 5" wrapped as "THE SPORTSVYN 25 · TOP / 5" in the
  // rail, which reads as a title that ran out of room rather than a label
  // somebody chose. Name and slice are two facts on two lines.
  const board = stripComments(src('components/gridiron/EditorialBoard.js'));
  assert.match(board, /function Head\(\{ title, slice, editionNumber \}\)/);
  assert.match(board, /<span className="gi-ed-title">\{title\}<\/span>/);
  assert.match(board, /\{slice \? <span className="gi-ed-slice">\{slice\}<\/span> : null\}/);
  const grid = src('components/gridiron/gridiron.css');
  assert.match(grid, /\.gi-ed-slice \{[^}]*white-space: nowrap;/, '"Top / 5" is not a thing');
  assert.match(grid, /\.gi-ed-title \{ display: block;/);
  // The homepage passes them separately; the league pages pass no slice and are
  // therefore unchanged.
  assert.match(home, /title: 'The Sportsvyn 25', slice: 'Top 5'/);
  assert.match(home, /slice=\{b\.slice\}/);
  const today = stripComments(src('components/gridiron/TodayPage.js'));
  assert.ok(!/slice=/.test(today), 'league Today pages are untouched');
});

test('the slate is read on the EASTERN day, not the page\'s Pacific one', () => {
  // The Daily Card's own label is PT. A football day is an ET day everywhere
  // else in this codebase, and a 10pm PT Thursday kickoff is already Friday in
  // PT - reading the slate in PT would show tomorrow's games under today's
  // heading for three hours every evening.
  assert.match(home, /const etDay = new Intl\.DateTimeFormat\('en-CA', \{\s*\n?\s*timeZone: 'America\/New_York'/);
  assert.match(home, /getSlateByDate\(etDay\)\.catch\(\(\) => null\)/);
});

// ---------------------------------------------------------------------------
// The homepage layout
// ---------------------------------------------------------------------------

test('the rail carries the slate and BOTH boards, stacked', () => {
  assert.match(home, /<aside className="right-rail home-rail">/);
  assert.match(home, /<TodaysGames slate=\{slate\} label=\{etLabel\} \/>/);
  assert.match(home, /<RailBoards boards=\{\{ nfl: nflBoard, cfb: cfbBoard \}\} \/>/);
  // Side by side inside a 340px rail gives each board about 165px, which is
  // narrower than a team name plus a record.
  assert.ok(!/dc-boards/.test(home), 'the two-up grid is gone from the card');
});

test('DOM ORDER IS THE MOBILE STACK: card first, rail second', () => {
  const card = home.indexOf('<article className="daily-card">');
  const rail = home.indexOf('<aside className="right-rail home-rail">');
  assert.ok(card > -1 && rail > card, 'somebody who opened the homepage came for the card');
});

test('the rail collapses at 1024px, where the grid itself gives way', () => {
  assert.match(css, /\.home-main--football \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 340px;/);
  assert.match(css, /@media \(max-width: 1024px\) \{\s*\n\s*\.home-main--football \{\s*\n\s*grid-template-columns: minmax\(0, 1fr\);/);
  // The 760px rule the boards carry is about units inside a column and still
  // applies once they are stacked.
  assert.match(css, /@media \(max-width: 760px\)/);
});

test('the slate is one unit on the page, not the page', () => {
  assert.match(home, /getSlateByDate\(etDay\)\.catch\(\(\) => null\)/,
    'a failed read costs a unit, never a column');
});

// ---------------------------------------------------------------------------
// One global header
// ---------------------------------------------------------------------------

test('THERE IS EXACTLY ONE HEADER, and the old one is gone', () => {
  let missing = false;
  try { src('components/SiteHeader.js'); } catch { missing = true; }
  assert.ok(missing, 'components/SiteHeader.js is retired');
  let missingServer = false;
  try { src('components/SiteHeaderServer.js'); } catch { missingServer = true; }
  assert.ok(missingServer, 'components/SiteHeaderServer.js is retired');
});

test('THE WORDMARK ALWAYS GOES HOME', () => {
  // It used to land in three different places: /scores by default, /nfl or /cfb
  // wherever a caller overrode it.
  assert.match(header, /<Wordmark href="\/" \/>/);
  const hub = stripComments(src('components/gridiron/RankingsHub.js'));
  const today = stripComments(src('components/gridiron/TodayPage.js'));
  for (const [name, s] of [['RankingsHub', hub], ['TodayPage', today]]) {
    assert.ok(!/<Wordmark/.test(s), `${name} no longer renders its own wordmark`);
  }
});

test('TODAY MEANS THE DAILY CARD, not the NFL page', () => {
  // It pointed at /nfl from all three gridiron call sites, so on /cfb the
  // "today" link took you to the other league.
  assert.match(src('lib/nav.js'), /\{ key: 'today', label: 'TODAY', href: '\/' \}/);
  for (const rel of ['components/gridiron/TodayPage.js', 'components/gridiron/RankingsHub.js', 'app/scores/page.js']) {
    const s = stripComments(src(rel));
    assert.ok(!/>TODAY</.test(s), `${rel} no longer hardcodes its own TODAY link`);
  }
});

test('THE MEMBER CHIP TELLS THE TRUTH', () => {
  // It was hardcoded markup in the ink header - it rendered for signed-out
  // visitors on every gridiron page.
  assert.match(headerServer, /import \{ getEntitlements \} from '@\/lib\/membership'/);
  assert.match(headerServer, /isMember=\{!!ent\?\.sim\}/);
  assert.match(header, /\{isMember \? <span className="gi-member">MEMBER<\/span> : null\}/);
  // Signed out means SIGN IN, and a failed membership read means "not a member",
  // which is the safe direction for a badge.
  assert.match(header, /: <Link href=\{signinHref\} className="gh-signin">SIGN IN<\/Link>/);
  assert.match(headerServer, /getEntitlements\(userId\)\.catch\(\(\) => null\)/);
  assert.match(headerServer, /userId \? getEntitlements/, 'signed-out users skip the read entirely');
});

test('the funnel keeps its place in BOTH auth states', () => {
  const cta = header.match(/<Link href="\/sim" className="gh-cta">MOCK DRAFT<\/Link>/g) ?? [];
  assert.equal(cta.length, 2, 'desktop bar and mobile drawer');
  // It sits outside the isAuthed branch, so signing in cannot remove it.
  const authBranch = header.indexOf('{isAuthed');
  assert.ok(header.indexOf('className="gh-cta"') < authBranch);
});

test('the mobile drawer survived the merge', () => {
  // The ink bar had no mobile treatment at all - it scrolled sideways and the
  // account menu went with it. That is where the app traffic is.
  assert.match(header, /className="gh-burger"/);
  assert.match(header, /\{drawerOpen && \(/);
  const chrome = src('components/site-chrome.css');
  // Parent-scoped now - see the mobile-rules test for why the unscoped form
  // could not be relied on.
  assert.match(chrome, /@media \(max-width: 900px\) \{\s*\n\s*\.gh \.gh-nav \{ display: none; \}/);
});

test('/membership stays shell-gated in the new header', () => {
  // Moved into accountMenu() in lib/nav.js, where lib/nav.test.mjs asserts the
  // behaviour directly rather than by matching source text.
  assert.match(src('lib/nav.js'), /shell \? \[\] : \[\{ key: 'membership'/);
});

test('section sub-navs are NOT unified away', () => {
  // A league's Today / Scores & Schedule / Rankings / Fantasy strip answers a
  // different question, and flattening it would remove the site's only sense
  // of place.
  const today = stripComments(src('components/gridiron/TodayPage.js'));
  assert.match(today, /<nav className="gi-subnav">/);
  const hub = stripComments(src('components/gridiron/RankingsHub.js'));
  assert.match(hub, /<nav className="gi-subnav">/);
});

// ---------------------------------------------------------------------------
// Nothing went dark
// ---------------------------------------------------------------------------

test('EVERY ROUTE THE OLD NAV CARRIED STILL HAS A WAY IN', () => {
  // /schedule and /stats had ZERO link sites outside the retiring header, and
  // /market dropped to a single panel link on /my. The footer is where they
  // land. A route with no way in is not a decision anyone made.
  //
  // THE WORLD CUP ROUTES ARE THE EXCEPTION, AND THEY PROVE THE RULE: their
  // delisting IS a decision someone made (EPL relay 1, 23 Aug - the
  // tournament ended 19 Jul and soccer's front door is no longer a bracket).
  // The routes still SERVE for anyone holding a link; they are simply not
  // advertised. Everything else here would be an accident, which is what
  // this pin exists to catch.
  for (const href of ['/schedule', '/stats', '/market',
    '/nfl/fantasy', '/nfl/rankings', '/scores', '/sim', '/']) {
    assert.ok(footer.includes(`href="${href}"`), `${href} must be reachable from the footer`);
  }
});

test('the footer no longer points its own links at nothing', () => {
  // Daily Card, Rankings and Stats sat on href="#" while the routes existed.
  const read = footer.slice(footer.indexOf('<h4>Read</h4>'), footer.indexOf('<h4>About</h4>'));
  assert.ok(!/href="#"/.test(read), 'no dead hrefs in the Read column');
  const soccer = footer.slice(footer.indexOf('<h4>Soccer</h4>'), footer.indexOf('<h4>About</h4>'));
  assert.ok(!/href="#"/.test(soccer), 'nor in Soccer');
});
