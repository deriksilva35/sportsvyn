// app/cfb/game/cfbGamePage.test.mjs - the college game page and the four
// surfaces that now point at it.
//
// The tests worth the most here are the two NEGATIVES: that the NFL route's
// guard is untouched, and that the Pick'em link cannot be hit by a pick tap.
// Both are things a later edit could break while looking entirely reasonable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const CFB = src('app/cfb/game/[slug]/page.js');
const NFL = src('app/nfl/game/[slug]/page.js');

// ------------------------------------------------------------ the route

test('the CFB route refuses anything that is not a CFB game', () => {
  const code = strip(CFB);
  assert.match(code, /if \(!game \|\| game\.leagueSlug !== 'cfb'\) notFound\(\);/);
  // getGamePage resolves BOTH gridiron leagues, so without this an NFL slug
  // would render here too and two routes would answer for one game.
  assert.match(code, /import \{ notFound \} from 'next\/navigation'/);
});

test('THE NFL GUARD IS UNTOUCHED - this relay does not alter its refusal', () => {
  assert.match(strip(NFL), /if \(!game \|\| game\.leagueSlug !== 'nfl'\) notFound\(\);/);
  // And the NFL page must not have grown a CFB branch: siblings, not a shared
  // conditional.
  const code = strip(NFL);
  assert.doesNotMatch(code, /leagueSlug === 'cfb'/);
  assert.doesNotMatch(code, /'cfb'/, 'the NFL route should not mention cfb at all');
});

test('it is a SIBLING file, not a conditional inside the NFL page', () => {
  // Distinct files, distinct default exports.
  assert.match(CFB, /export default async function CfbGamePage/);
  assert.match(NFL, /export default async function GamePage/);
});

test('the CFB page renders what CFB has, and does not fake what it lacks', () => {
  const code = strip(CFB);
  for (const present of ['lineScoreGrid', 'liveChip', 'DriveStrip', 'DriveChart', 'GameFacts']) {
    assert.match(code, new RegExp(present), `${present} must render`);
  }
  // GameTabs MOVED FROM absent TO present, 29 Aug. It used to be listed here
  // because all four NFL panels had zero CFB rows. Three of them still do -
  // match_briefs, gridiron_game_events and metadata.team_box are NFL-only - but
  // the box score is not one of them: it lives in cfb_player_game_stats (078)
  // and is populated same-day. So the rail is legitimate, and the rule this
  // test actually defends is unchanged: the page must not render a panel whose
  // data does not exist.
  for (const absent of ['BriefPanel', 'ScoringPanel', 'TeamBoxPanel', 'fantasyLeaders']) {
    assert.doesNotMatch(code, new RegExp(absent), `${absent} must NOT render for CFB`);
  }
  // And the rail is conditional on the data, never unconditional.
  assert.match(code, /GameTabs/, 'the box-score rail renders');
  assert.match(code, /panels\.length \? \(/, 'but only when there is a panel to show');
  assert.match(code, /const panels = boxTeams\.length \?/, 'and a panel only when a team has tables');
});

test('the footer names the NCAA, not the NFL', () => {
  assert.match(CFB, /NOT AFFILIATED WITH[\s\S]{0,80}NCAA/);
  assert.doesNotMatch(CFB, /NATIONAL\s+FOOTBALL\s+LEAGUE/);
});

// ------------------------------------- present-but-empty, never hidden (b)

test('the DRIVES section always renders - empty state, not a missing section', () => {
  const code = strip(CFB);
  // The section is NOT wrapped in a plays-length conditional the way the NFL
  // page's is; the emptiness lives inside it.
  const sect = code.slice(code.indexOf('aria-label="Drive chart"'));
  assert.doesNotMatch(
    code.slice(0, code.indexOf('aria-label="Drive chart"')).slice(-200),
    /gamecast\?\.plays\?\.length \? \(\s*<section/,
    'the section must not be conditional on plays existing',
  );
  assert.match(sect, /sim\.plays\.length \? \(/, 'the CONTENT switches, not the section');
  assert.match(sect, /Drive chart appears once the game kicks off\./);
  assert.match(sect, /Play data pending/);
  assert.match(sect, /No play-by-play stored for this game\./);
});

test('a live CFB game shows real data, never the simulated badge', () => {
  const code = strip(CFB);
  // simulated comes from simulateAsOf, which only marks a cut when ?asOf= is
  // present - the same rule the NFL page and the poller obey.
  assert.match(code, /const asOf = rawAsOf != null && \/\^\\d\+\$\/\.test\(String\(rawAsOf\)\) \? Number\(rawAsOf\) : null;/);
  assert.match(code, /simulated=\{sim\.simulated\}/);
  assert.match(code, /rawAsOf = Array\.isArray\(sp\.asOf\)/, 'asOf comes from the query string only');
});

// ------------------------------------------------- the four linking surfaces

test('SURFACE 1 - the scoreboard links both codes, and the stale comment is gone', () => {
  const s = src('components/gridiron/Scoreboard.js');
  assert.match(s, /const GAME_ROUTE = \{ nfl: '\/nfl\/game', cfb: '\/cfb\/game' \}/);
  assert.match(strip(s), /GAME_ROUTE\[g\.leagueSlug\] \?/);
  assert.doesNotMatch(strip(s), /g\.leagueSlug === 'nfl' \?/, 'the nfl-only gate must be gone');
  // The comment claimed no /cfb/game route exists. It does now.
  assert.doesNotMatch(s, /there is no\s*\n?\s*\*?\s*\/cfb\/game route/);
});

test('SURFACE 2 - TodaysGames links CFB rows too', () => {
  const s = src('components/home/TodaysGames.js');
  assert.match(strip(s), /\{ nfl: '\/nfl\/game', cfb: '\/cfb\/game' \}\[g\.leagueSlug\]/);
  assert.doesNotMatch(strip(s), /g\.leagueSlug === 'nfl'\s*\n?\s*\?/);
  assert.doesNotMatch(s, /CFB ROWS DO NOT/, 'the stale comment must be corrected');
});

test('SURFACE 3 - /match/[slug] 308s CFB, same shape as nfl and epl', () => {
  const s = strip(src('app/match/[slug]/page.js'));
  assert.match(s, /if \(match\.league_slug === 'cfb'\) permanentRedirect\(`\/cfb\/game\/\$\{slug\}`\);/);
  // Ordering matters: the redirect must precede the soccer readers, like the
  // other two, so a football game never pays for eleven queries it won't use.
  const cfbAt = s.indexOf("league_slug === 'cfb'");
  const nflAt = s.indexOf("league_slug === 'nfl'");
  assert.ok(nflAt > 0 && cfbAt > nflAt, 'cfb redirect sits with the other two');
  assert.doesNotMatch(src('app/match/[slug]/page.js'), /CFB stays here/, 'stale comment corrected');
});

test('SURFACE 4 - the Pick\'em link is in the HEADER and cannot swallow a pick', () => {
  const s = src('components/pickem/PickemBoard.js');
  const code = strip(s);

  // The anchor is inside .pk-eb.
  const eb = code.slice(code.indexOf('className={`pk-eb'), code.indexOf('className="pk-sides"'));
  assert.match(eb, /pk-gamelink/, 'the link lives in the eyebrow header');

  // ...and .pk-eb closes BEFORE .pk-sides opens - siblings, not nested. So the
  // anchor is not an ancestor of any pick button.
  const sides = code.slice(code.indexOf('className="pk-sides"'));
  assert.doesNotMatch(sides.slice(0, sides.indexOf('</div>')), /pk-gamelink/,
    'no link may appear inside the pick-button subtree');

  // The pick buttons carry the ONLY click handler; nothing on the row or the
  // eyebrow does, so a link tap has nothing to bubble into.
  assert.match(code, /onClick=\{\(\) => tap\(g, side\)\}/);
  assert.equal((code.match(/onClick=/g) ?? []).length, 1, 'exactly one click handler in the row');
  assert.doesNotMatch(code, /stopPropagation|preventDefault/,
    'separation must be structural, not a propagation hack a later edit can undo');

  // And the href is derived from the contest's own sport, not assumed.
  assert.match(code, /const GAME_ROUTE = \{ cfb: '\/cfb\/game', nfl: '\/nfl\/game' \}/);
  assert.match(code, /function gameHref\(contest, g\)/);
  assert.match(code, /GAME_ROUTE\[contest\?\.sport\]/);
  assert.match(code, /base && g\?\.slug \? `\$\{base\}\/\$\{g\.slug\}` : null/,
    'no link when we have no route or no slug - never a href to nowhere');
});

test('the Pick\'em link has its own tap target, physically clear of the picks', () => {
  const css = src('app/pickem/pickem.css');
  assert.match(css, /\.pk-gamelink \{/);
  assert.match(css, /padding: 6px 8px/, 'a real tap target, not a bare 10px word');
  // .pk-eb keeps its 9px gap above the buttons.
  assert.match(css, /\.pk-game \.pk-eb \{[^}]*margin-bottom: 9px/);
  // The eyebrow's first-child rule must still match the LEFT span - inserting
  // the link before it would have silently killed the live-red styling.
  assert.match(css, /\.pk-eb\.live > span:first-child/);
  const code = strip(src('components/pickem/PickemBoard.js'));
  const eb = code.slice(code.indexOf('className={`pk-eb'));
  assert.ok(eb.indexOf('{eyebrowLeft}') < eb.indexOf('pk-gamelink'),
    'the link must come AFTER the left span or .pk-eb.live > span:first-child breaks');
});

test('the slug the link needs is actually exposed by the view', () => {
  // A href built from a field the reader never returns would render
  // /cfb/game/undefined on every row.
  assert.match(src('lib/pickem/view.js'), /slug: g\.slug/);
});
