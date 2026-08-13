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

test('NFL ROWS LINK, CFB ROWS DO NOT - there is no /cfb/game', () => {
  assert.match(games, /g\.leagueSlug === 'nfl'\s*\n?\s*\? <Link className="tg-row tg-row--link" href=\{`\/nfl\/game\/\$\{g\.slug\}`\}/);
  assert.match(games, /: <div className="tg-row">\{body\}<\/div>/);
  assert.ok(!/cfb\/game/.test(games), 'no link to a route that does not exist');
});

test('a game that has not kicked off shows a TIME, never a 0-0', () => {
  assert.match(games, /\{played \? \(g\.awayScore \?\? ABSENT\) : ''\}/);
  assert.match(games, /\{!played \? <span className="tg-time">\{fmtTime\(g\.kickoffAt\)\}<\/span> : null\}/);
  assert.match(games, /import \{ ABSENT \} from '@\/lib\/gridiron\/lineScore'/,
    'one absence glyph across the gridiron surface');
});

test('only a FINAL promotes a winner', () => {
  // A leader at halftime has not won anything.
  assert.match(games, /const homeWin = final && g\.homeScore > g\.awayScore/);
  assert.match(games, /const awayWin = final && g\.awayScore > g\.homeScore/);
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
  assert.match(header, /\{ key: 'today', label: 'TODAY', href: '\/' \}/);
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
  assert.match(chrome, /@media \(max-width: 900px\) \{\s*\n\s*\.gh-nav, \.gh-right \{ display: none; \}/);
});

test('/membership stays shell-gated in the new header', () => {
  assert.match(header, /\.\.\.\(shell \? \[\] : \[\{ label: 'Membership', href: '\/membership' \}\]\)/);
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
  for (const href of ['/schedule', '/stats', '/market', '/world-cup-2026/bracket',
    '/world-cup-2026/rankings', '/nfl/fantasy', '/nfl/rankings', '/scores', '/sim', '/']) {
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
