// lib/games/relay6.test.mjs - the three surfaces relay 6 touched.
//
// All three are about WHERE something sits, which is exactly what a render
// test cannot see and a source test can: a card above the grade rather than
// below it, a share block above the rows rather than under them, two lines
// under the hero rather than at the bottom of the page. Position is the
// whole change in each case, so position is what these assert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// ------------------------------------------------- 1: the mock exit

const RESULTS = src('components/sim/DraftResults.js');

test('the mock exit card carries the ratified copy, verbatim', () => {
  assert.match(RESULTS, /This one was practice/);
  assert.match(RESULTS, /The ranked Draft opens Tuesday\. Same rooms, same\s*\n?\s*engine, and it goes\s*\n?\s*on a leaderboard\./);
  assert.match(RESULTS, /Take a seat in the ranked Draft/);
  assert.match(RESULTS, /href="\/draft"/);
  assert.match(RESULTS, /href="\/games\/how-it-works">How the games work/);
});

test('it sits ABOVE the grade, which is the entire point', () => {
  const exit = RESULTS.indexOf('mock-exit');
  const grade = RESULTS.indexOf('grade-block');
  assert.ok(exit > 0 && grade > 0, 'both blocks exist');
  assert.ok(exit < grade,
    'the exit must precede the grade block - below it is past the roster, '
    + 'the ledger and the read, a scroll nobody making a decision performs');
});

test('NOTHING ELSE on that screen changed - the app-store banner stays', () => {
  // The item said the banner stays. It is rendered by the ROUTE, not by
  // DraftResults, so the check belongs there: the predicate that shows it
  // must be untouched, and it must still be the same one the tab bar uses.
  const page = src('app/sim/draft/[id]/page.js');
  assert.match(page, /const showTabBar = status !== 'in_progress' && !\(isRanked && status === 'completed'\)/);
  assert.match(page, /\{showTabBar && <GetTheAppBanner shell=\{isShell\} \/>\}/);
  assert.match(page, /\{showTabBar && <SimTabBar \/>\}/);
});

test('the exit is on the MOCK results only, not the tracker or the ranked page', () => {
  // Practice is what the card is about. A tracked room is a real draft and a
  // ranked completion already belongs to Games - neither should be told
  // "this one was practice".
  assert.doesNotMatch(src('components/sim/TrackerResults.js'), /mock-exit|This one was practice/);
  assert.doesNotMatch(src('components/draft/RankedComplete.js'), /mock-exit|This one was practice/);
});

// ------------------------------------------------- 2: the Daily share

const BOARD = src('components/daily/season/SeasonBoard.js');

test('the share block is ABOVE the grade rows', () => {
  const share = BOARD.indexOf('className="sbd-share"');
  const grade = BOARD.indexOf('className="sbd-grade"');
  assert.ok(share > 0 && grade > 0);
  assert.ok(share < grade, 'the share must precede the grade rows');
});

test('the button reads "Share your board", and actually shares', () => {
  assert.match(BOARD, /Share your board/);
  assert.doesNotMatch(BOARD, /\{copied \? 'Copied' : 'Copy'\}/, 'the old Copy label is gone');
  // A button labelled Share that only writes the clipboard is a small lie on
  // a phone. Same order ShareGrade uses: share sheet, then clipboard.
  assert.match(BOARD, /if \(navigator\.share\)/);
  assert.match(BOARD, /await navigator\.share\(\{ text: shareText \}\)/);
  assert.match(BOARD, /await navigator\.clipboard\.writeText\(shareText\)/);
  const s = BOARD.indexOf('navigator.share');
  const c = BOARD.indexOf('navigator.clipboard.writeText(shareText)');
  assert.ok(s < c, 'the share sheet is tried before the clipboard fallback');
});

test('the glyph row is still exactly the size the Daily mock uses', () => {
  // Not changed by this relay, and asserted so that MOVING the block cannot
  // quietly become RESIZING it. The mock is the spec.
  const css = src('components/daily/season/seasonBoard.css');
  const mock = src('docs/design/daily-full-mock-v3.html');
  assert.match(mock, /\.g\{font-family:var\(--mono\);font-size:18px;letter-spacing:\.09em;line-height:1\.5\}/);
  assert.match(css, /\.sbd-share \.sbd-g \{ font-family: var\(--font-mono\); font-size: 18px; letter-spacing: \.09em; line-height: 1\.5; \}/);
});

test('the caption copy is untouched', () => {
  // The item said to leave it alone.
  assert.match(BOARD, /\{ranked \? edition : 'Practice'\} · \{year\}/);
  assert.match(BOARD, /\{grade\.mine\.toLocaleString\(\)\} pts · \{grade\.pct\}% · \{clockLabel\}/);
});

// ------------------------------------------------- 3: /games for a stranger

const GAMES = src('app/games/page.js');

test('the stranger lines are verbatim and sit under the hero', () => {
  assert.match(GAMES, /Free\. An email and a handle\. Nothing to install\./);
  assert.match(GAMES, /How to play each game/);
  const hero = GAMES.indexOf('<Hero hero={v.hero}');
  const lines = GAMES.indexOf('lob-stranger');
  const boards = GAMES.indexOf("Today&rsquo;s boards");
  assert.ok(hero < lines, 'under the hero, not above it - the hero stays');
  assert.ok(lines < boards, 'and above Today\'s boards');
});

test('they are SIGNED OUT only, and the existing ghost link is untouched', () => {
  assert.match(GAMES, /\{!signedIn && \(\s*\n\s*<div className="lob-stranger">/);
  // The link under Today's boards stays for everyone - this is a second
  // entrance, not a replacement.
  assert.match(GAMES, /href="\/games\/how-it-works">How the games work/);
});

test('both explainer links point where the email points', () => {
  const email = src('docs/email/launch-email-sep8.html');
  assert.match(email, /https:\/\/sportsvyn\.com\/games\/how-it-works/);
  // COUNT HREFS, NOT MENTIONS. A comment on this page explains why the
  // explainer reads no session, and it names the path - counting bare
  // occurrences picked that prose up as a third link.
  assert.equal((GAMES.match(/href="\/games\/how-it-works"/g) ?? []).length, 2,
    'two entrances to the one explainer: under the hero, and under the boards');
});
