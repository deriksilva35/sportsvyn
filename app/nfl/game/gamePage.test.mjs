// app/nfl/game/gamePage.test.mjs - the wiring around /nfl/game/[slug].
//
// The shaping is unit-tested in lib/gridiron/gameDetail.test.mjs. What is left
// is the composition: does the tab rail come from the data or from a list, does
// the old URL redirect, does the scoring module stay on the server, and is the
// brief writer actually reachable for the NFL. None of those can be checked by
// calling a function - they are facts about how the files are put together, and
// each of them has a failure mode that renders fine and is wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
// Comments describe the rules; they must not be able to satisfy them. This repo
// has tripped its own source scans on its own prose four times.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const page = stripComments(src('app/nfl/game/[slug]/page.js'));
const tabs = stripComments(src('components/gridiron/GameTabs.js'));
const detail = stripComments(src('lib/gridiron/gameDetail.js'));
const brief = stripComments(src('lib/gridiron/gameBrief.js'));
const cron = stripComments(src('app/api/cron/generate-briefs/route.js'));
const preseasonCron = stripComments(src('app/api/cron/nfl-preseason/route.js'));
const matchPage = stripComments(src('app/match/[slug]/page.js'));
const board = stripComments(src('components/gridiron/Scoreboard.js'));
const css = src('app/nfl/game/[slug]/game.css');

// ---------------------------------------------------------------------------
// One render, no per-tab fetches
// ---------------------------------------------------------------------------

test('THE TAB RAIL IS BUILT FROM DATA, not from a list of sections', () => {
  // Each entry is conditional on its own panel having something in it. A tab
  // that always renders and sometimes opens onto nothing is the placeholder
  // this page is not allowed to have.
  assert.match(page, /brief \? \{ key: 'brief'/);
  assert.match(page, /quarters\.length \? \{ key: 'scoring'/);
  assert.match(page, /hasPlayers \? \{ key: 'players'/);
  assert.match(page, /teamBox \? \{ key: 'teambox'/);
  assert.match(page, /\]\.filter\(Boolean\)/);
});

test('a game with no panels renders the FACTS, not an empty rail', () => {
  assert.match(page, /panels\.length \? \([\s\S]*?\) : \(\s*<PreGameFacts/);
  assert.match(page, /function PreGameFacts/);
  assert.match(page, /Scoring summary and player lines land once the game is played\./);
});

test('every panel is server-rendered up front - the island only switches them', () => {
  assert.match(page, /nodes=\{\{/, 'panel content is passed in, not fetched on click');
  assert.ok(!/useEffect|fetch\(/.test(tabs), 'the island makes no requests of its own');
  assert.match(tabs, /const \[active, setActive\] = useState/);
});

test('panels are keyed, not positional', () => {
  // An array would have paired the wrong panel with the wrong tab the first
  // time a game had a brief but no scoring plays.
  assert.match(tabs, /nodes\[p\.key\]/);
  assert.ok(!/children\[/.test(tabs));
});

test('the page never renders a score for a game that has not been played', () => {
  assert.match(page, /show=\{final \|\| live\}/);
  assert.match(page, /\{show \? score : ''\}/);
});

test('NO RECORD CHIPS. The header states the game, and preseason has no record', () => {
  assert.ok(!/\brec\b|record/i.test(page.replace(/recordDecision/g, '')),
    'the lock draws them; the brief rules them out for these pages');
});

// ---------------------------------------------------------------------------
// One scoring methodology
// ---------------------------------------------------------------------------

test('THE SCORING MODULE NEVER SHIPS TO THE BROWSER', () => {
  assert.ok(!/fantasy\/scoring/.test(tabs), 'the island imports no scoring rules');
  assert.match(detail, /import \{ fantasyPoints \} from '\.\.\/fantasy\/scoring\.js'/);
  // The toggle picks between numbers the server already produced.
  assert.match(detail, /export function pointsAllFormats/);
  assert.match(tabs, /r\.pts\[format\]/);
});

test('the format toggle offers three formats, PPR first', () => {
  assert.match(tabs, /\{ key: 'ppr', label: 'PPR' \}/);
  assert.match(tabs, /useState\('ppr'\)/);
  assert.match(detail, /SCORING_FORMATS = \['ppr', 'half-ppr', 'standard'\]/);
  // '2qb' is a roster shape, not a scoring system - scoring.js says so at length.
  assert.ok(!/'2qb'/.test(tabs));
});

test('the leaders list is recomputed per format on the SERVER', () => {
  assert.match(page, /for \(const f of SCORING_FORMATS\) leaders\[f\] = fantasyLeaders\(game, f, 5\)/);
  assert.match(tabs, /leaders\[format\]/);
});

// ---------------------------------------------------------------------------
// Absence over inference
// ---------------------------------------------------------------------------

test('the absence glyph has ONE definition across the gridiron surface', () => {
  assert.match(detail, /import \{ ABSENT \} from '\.\/lineScore\.js'/);
  assert.ok(!/ABSENT = /.test(detail), 'not redefined here');
});

test('the team box is REG-only, and is not even requested for preseason', () => {
  assert.match(detail, /includeTeamStats && m\.season_phase !== 'PRE'/);
  assert.match(page, /game\.teamBox && Object\.keys\(game\.teamBox\)\.length \? game\.teamBox : null/);
});

test('hyphens only, throughout the page and its stylesheet', () => {
  for (const [name, text] of [['page', page], ['tabs', tabs], ['css', css]]) {
    assert.ok(!/[—–](?!')/.test(text.replace(/'–'/g, '')), `${name} uses an em or en dash in prose`);
  }
});

// ---------------------------------------------------------------------------
// The old URL
// ---------------------------------------------------------------------------

test('AN NFL SLUG AT /match REDIRECTS, before any soccer reader runs', () => {
  assert.match(matchPage, /import \{ notFound, permanentRedirect \} from 'next\/navigation'/);
  assert.match(matchPage, /if \(match\.league_slug === 'nfl'\) permanentRedirect\(`\/nfl\/game\/\$\{slug\}`\)/);
  const redirectAt = matchPage.indexOf('permanentRedirect(`/nfl/game/');
  const readersAt = matchPage.indexOf('getWatchScore(match.id)');
  assert.ok(redirectAt > -1 && redirectAt < readersAt,
    'the redirect must throw before eleven queries are spent on a page nobody sees');
  assert.match(matchPage, /l\.slug\s+AS league_slug/, 'and the league has to be selected to be checked');
});

test('a soccer slug at the gridiron route is a 404, not a redirect loop', () => {
  assert.match(page, /if \(!game \|\| game\.leagueSlug !== 'nfl'\) notFound\(\)/);
});

test('the scorecard gains ONE link, per league, where the page exists', () => {
  // WAS "only where the page exists", meaning NFL - CFB had no route and a
  // link to a 404 is worse than no link. /cfb/game now exists, so the gate is
  // a per-league MAP rather than an nfl equality: each code owns a sibling
  // route, and a league with no route still gets no link.
  assert.match(board, /const GAME_ROUTE = \{ nfl: '\/nfl\/game', cfb: '\/cfb\/game' \}/);
  assert.match(board, /\{GAME_ROUTE\[g\.leagueSlug\] \?/);
  // </Link> since the soft-nav conversion - a plain </a> was the WKWebView
  // teardown glitch. The claim (one link, route-gated) is unchanged.
  assert.match(board, /href=\{`\$\{GAME_ROUTE\[g\.leagueSlug\]\}\/\$\{g\.slug\}`\}>Full game →<\/Link>/);
  // Still exactly one link in the expand.
  assert.equal((board.match(/className="gi-full"/g) ?? []).length, 1);
  // The expand itself is unchanged: line score, or the pre-game facts.
  assert.match(board, /\{hasLine \? <LineScore g=\{g\} \/> : <PreGamePane g=\{g\} \/>\}/);
});

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

test('NFL joins the brief allowlist and CFB does not', () => {
  assert.match(cron, /export const BRIEF_LEAGUE_SLUGS = \[[\s\S]*?'nfl',\s*\]/);
  assert.ok(!/'cfb'/.test(cron.match(/BRIEF_LEAGUE_SLUGS = \[[\s\S]*?\]/)[0]),
    'the college feed serves no scoring plays - its envelope would be the thin brief');
});

test('football games get the FOOTBALL envelope', () => {
  assert.match(cron, /GRIDIRON_SLUGS\.has\(m\.league_slug\)\s*\n?\s*\? await generateGameBrief\(m\.id\)\s*\n?\s*: await generateBriefFromDb\(m\.id\)/);
  assert.match(cron, /SELECT m\.id, m\.slug, l\.slug AS league_slug/);
});

test('SHIPPING THE WRITER AND TURNING IT ON ARE TWO DECISIONS', () => {
  assert.match(cron, /process\.env\.GRIDIRON_BRIEFS_ENABLED === '1'/);
  assert.match(cron, /export function activeLeagueSlugs\(enabled\)/);
  assert.match(cron, /l\.slug = ANY\(\$\{slugs\}::text\[\]\)/, 'the switch reaches the query');
});

test('a gridiron game with no plays is SKIPPED, never briefed thin', () => {
  assert.match(brief, /if \(!g\.events\.length\) return null/);
  assert.match(cron, /outcome: 'skipped-no-data'/);
});

test('the envelope carries no numeric period, on purpose', () => {
  // aiBrief's hallucination gate treats a bare ordinal as a numeral that must
  // be in the source. A quarter NUMBER would license "in the 4th" for every
  // quarter of the game, including the ones where nothing happened.
  assert.match(brief, /quarter: e\.quarter_label \?\? null/);
  const envelope = brief.slice(brief.indexOf('export async function assembleGridironEnvelope'),
    brief.indexOf('function topLines'));
  assert.ok(!/minute/.test(envelope), 'no minute key reaches the model or the gate');
  assert.ok(!/quarter: \d|quarter: e\.quarter\b/.test(envelope), 'and no quarter number either');
});

test('the deterministic fallback speaks football', () => {
  assert.match(brief, /export function gridironFallback/);
  assert.match(brief, /generateBrief\(envelope, \{ fallback: gridironFallback \}\)/);
  const ai = stripComments(src('lib/aiBrief.js'));
  assert.match(ai, /export async function generateBrief\(matchData, \{ fallback = templatedFallback \} = \{\}\)/);
});

test('named players in the stat lines are SOURCED for the gate', () => {
  // Football has no start XI, so its players arrive in player_lines. Without
  // this walk every rusher the model correctly named would read as invented.
  const ai = stripComments(src('lib/aiBrief.js'));
  assert.match(ai, /for \(const side of envelope\.player_lines \?\? \[\]\)/);
  assert.match(brief, /player_lines:/);
});

test('only a PUBLISHED brief renders', () => {
  assert.match(brief, /AND published_at IS NOT NULL/);
  assert.match(page, /AUTO-GENERATED FROM MATCH DATA/);
});

// ---------------------------------------------------------------------------
// The fetch cadence
// ---------------------------------------------------------------------------

test('the detail pass rides the score sweep and respects the same budget', () => {
  assert.match(preseasonCron, /const detail = await detailPass\(\{/);
  assert.match(preseasonCron, /budgetLeft: DAILY_REQUEST_CAP - \(spent \+ 1\)/);
  assert.match(preseasonCron, /if \(requests \+ 2 > budgetLeft\) break/,
    'two requests a game, stopped BEFORE the overrun');
  assert.match(preseasonCron, /requestsToday: spent \+ 1 \+ detail\.requests/);
});

test('a failed detail fetch cannot cost the sweep or the other games', () => {
  assert.match(preseasonCron, /for \(const t of targets\) \{[\s\S]*?try \{[\s\S]*?\} catch \(err\) \{/);
});

test('the fetch stamp is written LAST, and only when something landed', () => {
  // A stamp written on a failed fetch records the game as done and it is never
  // retried.
  assert.match(detail, /if \(summary\.events > 0 \|\| summary\.playerLines > 0\) \{/);
  assert.match(detail, /final: m\.status === 'final'/);
  const stampAt = detail.indexOf("summary.events > 0 || summary.playerLines > 0");
  assert.ok(stampAt > detail.indexOf('summary.playerLines = lines.length'),
    'the stamp comes after both fetches');
});
