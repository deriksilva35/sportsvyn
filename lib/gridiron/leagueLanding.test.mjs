// lib/gridiron/leagueLanding.test.mjs — the league landing's claims, tested
// without rendering anything. Run: node --test lib/gridiron/leagueLanding.test.mjs
//
// EVERY ASSERTION HERE IS ABOUT SOMETHING A READER WOULD BELIEVE: that a chip's
// rank came from the AP poll and not from row order, that an arrow means a team
// moved, that a volt button means an action is available. None of those can be
// checked by counting occurrences in served HTML, which is exactly how a broken
// header shipped last week.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  railRecord, railMovement, railChip, railChips, landingEyebrow, livePill,
  stripGamesFor, tileIsOpen, tileNumber, stripTiles, scoresSlice, leagueUnit,
} from './leagueLanding.js';
import { GAME_META, GAME_ORDER } from '../games/lobby.js';
import { sameGroup, pickGroup, DEFAULT_GROUP } from './landingModules.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ------------------------------------------------------------------ the rail

test('THE RAIL DERIVES FROM A NAMED POLL, never from row order', () => {
  // The law that matters: CFBD's polls array changes membership by week, so an
  // index reads a different poll with an identical shape. The rail reads
  // ap_rankings, and rankings.js maps the poll NAME to that table - so there is
  // no array here to index into by accident.
  const rail = strip(src('lib/gridiron/leagueRail.js'));
  assert.match(rail, /FROM ap_rankings ap/);
  assert.doesNotMatch(rail, /polls\[\d\]|\[0\]/);
  assert.match(strip(src('lib/cfb/rankings.js')), /\[AP_POLL\]: 'ap_rankings'/);
  // and the rank rendered is the poll's own column, not an enumeration index.
  assert.match(strip(src('components/league/RankRail.js')), /\{c\.rank\}/);
  assert.doesNotMatch(strip(src('components/league/RankRail.js')), /map\(\(c, ?i\)/);
});

test('MOVEMENT IS NULL ON THE FIRST WEEK, and null when a team holds', () => {
  assert.equal(railMovement({ rank: 5, previous_rank: null }), null, 'no prior poll, no arrow');
  assert.equal(railMovement({ rank: 5, previous_rank: 5 }), null, 'held is not moved');
  assert.equal(railMovement({ rank: 3, previous_rank: 9 }), 'up');
  assert.equal(railMovement({ rank: 12, previous_rank: 4 }), 'down');
  assert.equal(railMovement({}), null);
  // The reader joins the PRIOR week and lets it be null rather than defaulting.
  assert.match(strip(src('lib/gridiron/leagueRail.js')), /LEFT JOIN ap_rankings prev/);
});

test('a chip may only claim knowledge - 0-0 and absent both render nothing', () => {
  assert.equal(railRecord({ wins: 1, losses: 0, ties: 0 }), '1-0');
  assert.equal(railRecord({ wins: 9, losses: 3, ties: 1 }), '9-3-1');
  assert.equal(railRecord({ wins: 0, losses: 0, ties: 0 }), null);
  assert.equal(railRecord({ wins: null, losses: null }), null);
  assert.equal(railRecord(null), null);
});

test('railChip falls back to the seeded label rather than rendering an empty chip', () => {
  const c = railChip({ rank: 1, team_id: null, abbreviation: null, name: 'Los Angeles Rams' });
  assert.equal(c.abbr, 'Los Angeles Rams');
  assert.equal(railChips([]).length, 0);
});

test('NO CHIPS, NO RAIL - an empty rail is furniture announcing an absence', () => {
  assert.match(strip(src('components/league/RankRail.js')), /if \(!chips\?\.length\) return null/);
});

// --------------------------------------------------------------- the header

test('THE EYEBROW NAMES TODAY, AND THE DAY LEADS', () => {
  // THE BUG THIS PINS: the eyebrow was handed allGames[0].kickoffAt, the
  // week's FIRST kickoff, so on Sunday 13 Sep the tab called Today read
  // "Week 1 · Wed Sep 9" and named a past Wednesday. Three fixtures, three
  // different days, one week number - only the day may move.
  const at = (iso) => landingEyebrow({ week: 1, phase: 'REG', now: new Date(iso) });
  assert.equal(at('2026-09-09T16:00:00Z'), 'Wed Sep 9 · Week 1', 'the old first kickoff');
  assert.equal(at('2026-09-13T16:00:00Z'), 'Sun Sep 13 · Week 1', 'four days later, four days later');
  assert.equal(at('2026-08-29T16:00:00Z'), 'Sat Aug 29 · Week 1');
  // The day leads and the week follows it as context, which is the flip.
  assert.match(at('2026-09-13T16:00:00Z'), /^Sun Sep 13 · Week 1$/);
});

test('THE EYEBROW OBEYS THE REG-ONLY LANDMARK LAW', () => {
  const now = new Date('2026-08-29T16:00:00Z');
  assert.equal(landingEyebrow({ week: 1, phase: 'REG', now }), 'Sat Aug 29 · Week 1');
  // A preseason week 3 is not "Week 3" - it counts differently, so the week is
  // dropped and the date, which is always true, stands alone.
  assert.equal(landingEyebrow({ week: 3, phase: 'PRE', now }), 'Sat Aug 29');
  assert.equal(landingEyebrow({ week: null, phase: 'REG', now }), 'Sat Aug 29');
  // With no week and no phase the date still stands: today is always true,
  // which is exactly why it replaced a kickoff that might not be.
  assert.equal(landingEyebrow({ week: null, phase: null, now }), 'Sat Aug 29');
});

test('the eyebrow reads the viewer zone, so a late ET kickoff is not tomorrow', () => {
  const now = new Date('2026-09-14T02:30:00Z'); // 10:30 PM ET on the 13th
  assert.equal(landingEyebrow({ week: 2, phase: 'REG', now }), 'Sun Sep 13 · Week 2');
});

test('the header no longer hands the eyebrow a kickoff', () => {
  const hdr = readFileSync(new URL('../../components/league/LeagueHeader.js', import.meta.url), 'utf8');
  assert.equal(/landingEyebrow\(\{[^}]*date:/.test(hdr), false, 'no date passed to the eyebrow');
  const today = readFileSync(new URL('../../components/gridiron/TodayPage.js', import.meta.url), 'utf8');
  assert.equal(/date=\{allGames\[0\]/.test(today), false, 'and the landing stopped passing one');
});

test('THE LIVE PILL IS HIDDEN AT ZERO', () => {
  assert.equal(livePill([]), null);
  assert.equal(livePill([{ status: 'final' }, { status: 'scheduled' }]), null);
  assert.equal(livePill([{ status: 'live' }, { status: 'final' }, { status: 'live' }]), 2);
  assert.equal(livePill(null), null);
  // and the component has no rule for an empty pill because it never draws one
  assert.match(strip(src('components/league/LeagueHeader.js')), /\{live \?/);
});

// ---------------------------------------------------------------- the strip

test('LEAGUE MEMBERSHIP IS DATA ON GAME_META, not a branch', () => {
  assert.deepEqual(stripGamesFor('cfb', GAME_META), ['pickem']);
  assert.deepEqual(stripGamesFor('nfl', GAME_META).sort(), ['daily', 'draft', 'pickem', 'weekly']);
  assert.deepEqual(stripGamesFor('epl', GAME_META), []);
  // The surface must not re-implement the answer.
  const s = strip(src('components/league/GamesStrip.js'));
  assert.doesNotMatch(s, /=== 'cfb'|=== 'nfl'/);
});

test('THE TILE COUNT IS THE LEAGUE\'S GAMES - one for CFB, four for NFL', () => {
  const cards = Object.fromEntries(GAME_ORDER.map((k) => [k, { key: k, state: 'open', playable: true }]));
  assert.equal(stripTiles({ leagueSlug: 'cfb', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true }).length, 1);
  assert.equal(stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true }).length, 4);
  // and the order is GAME_ORDER's, not object-key order
  assert.deepEqual(
    stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true }).map((t) => t.key),
    GAME_ORDER,
  );
});

test('PRIMARY-BUTTON LAW: a volt button only where an action is open', () => {
  const open = { state: 'open', playable: true };
  assert.equal(tileIsOpen(open, { signedIn: true }), true);
  // SIGNED OUT IS NEVER OPEN - the tile still shows the game and its lock.
  assert.equal(tileIsOpen(open, { signedIn: false }), false);
  // cardState's own vocabulary, not a second one.
  assert.equal(tileIsOpen({ state: 'entered', playable: true }, { signedIn: true }), false);
  assert.equal(tileIsOpen({ state: 'settled', playable: false }, { signedIn: true }), false);
  assert.equal(tileIsOpen({ state: 'ghost', playable: false }, { signedIn: true }), false);
  assert.equal(tileIsOpen(null, { signedIn: true }), false);
});

test('the volt button count can never exceed the tile count', () => {
  const cards = {
    daily: { state: 'open', playable: true },
    pickem: { state: 'entered', playable: true },
    weekly: { state: 'ghost', playable: false },
    draft: { state: 'settled', playable: false },
  };
  const tiles = stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true });
  const volt = tiles.filter((t) => t.open).length;
  assert.equal(tiles.length, 4);
  assert.equal(volt, 1, 'only the open one');
  assert.ok(volt <= tiles.length);
  // Signed out: four tiles, zero primaries.
  const out = stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: false });
  assert.equal(out.filter((t) => t.open).length, 0);
  // THE STRIP IS THE ONLY VOLT BUTTON ON THE SCREEN: no other league component
  // paints a volt background.
  for (const f of ['components/league/RankRail.js', 'components/league/LeagueScores.js',
                   'components/league/LeagueHeader.js']) {
    assert.doesNotMatch(strip(src(f)), /lgt-btn|background: var\(--volt\)/);
  }
});

test('the tile number comes from the card, never computed here', () => {
  // RELAY B MOVED THE NUMBER ONTO card.count. Relay A read it off `you`, which
  // could only ever say points or a streak; the reader now computes what each
  // game actually counts and hands it over whole.
  assert.deepEqual(tileNumber({ count: { value: '9/16', unit: 'picked' } }), { value: '9/16', unit: 'picked' });
  assert.equal(tileNumber({ count: null }), null, 'a game with nothing to count has no number');
  assert.equal(tileNumber({}), null);
});

// --------------------------------------------------------------- the scores

test('SCORES ORDER IS THE READER\'S PRIORITY: live, upcoming, final', () => {
  const g = [
    { id: 'f', status: 'final', kickoffAt: '2026-08-29T16:00:00Z' },
    { id: 's', status: 'scheduled', kickoffAt: '2026-08-29T23:00:00Z' },
    { id: 'l', status: 'live', kickoffAt: '2026-08-29T20:00:00Z' },
    { id: 's2', status: 'scheduled', kickoffAt: '2026-08-29T19:00:00Z' },
  ];
  assert.deepEqual(scoresSlice(g).shown.map((x) => x.id), ['l', 's2', 's', 'f']);
});

test('the cap and the overflow count are the real numbers', () => {
  const g = Array.from({ length: 14 }, (_, i) => ({ id: i, status: 'final', kickoffAt: `2026-08-29T${10 + i}:00:00Z` }));
  const s = scoresSlice(g, 6);
  assert.equal(s.shown.length, 6);
  assert.equal(s.total, 14);
  assert.equal(s.overflow, 8);
  // No overflow, no link - the component gates on it.
  assert.equal(scoresSlice(g.slice(0, 5), 6).overflow, 0);
  assert.match(strip(src('components/league/LeagueScores.js')), /\{overflow \?/);
});

test('THE UNIT IS THE LEAGUE\'S: college counts a day, the NFL a week', () => {
  assert.equal(leagueUnit('cfb'), 'day');
  assert.equal(leagueUnit('nfl'), 'week');
  assert.equal(leagueUnit('epl'), 'week', 'an unknown code falls to the commoner unit');
});

test('BUT THE UNIT NO LONGER TITLES THE MODULE BY ITSELF', () => {
  // WHAT THIS USED TO CLAIM. It asserted the heading was literally
  // `unit === 'day' ? 'Today' : 'This week'`, and that was a true reading of
  // the code and a false statement on the screen: CFB's unit is the day, the
  // landing hands the module slate.byDay FLATTENED - the whole week - so a CFB
  // landing titled four days of football "Today", every week, with Saturday's
  // games under it on a Tuesday.
  //
  // The unit is still right about how a code's schedule is shaped. It was just
  // never the question. What titles a list is what is IN the list, so the
  // heading now asks the games and degrades to "This week" whenever they span
  // more than one day. The unit test above is unchanged and still passes;
  // this one replaces the markup assertion that encoded the bug.
  // The call gained the reader's zone and the page's clock in the second pass
  // - one day on screen turned out not to be the same claim as "today" - so
  // this matches the CALL rather than its exact arity. The claim is unchanged:
  // the league alone does not decide the heading.
  const s = strip(src('components/league/LeagueScores.js'));
  assert.match(s, /moduleHeading\(unit, shown,/);
  assert.doesNotMatch(s, /unit === 'day' \? 'Today'/,
    'the league alone must not decide the heading again');
});

test('THE SCORE CARD IS REUSED, NOT REBUILT', () => {
  // A second score card is a second grammar for the same fact.
  const s = strip(src('components/league/LeagueScores.js'));
  assert.match(s, /import Scoreboard from '@\/components\/gridiron\/Scoreboard'/);
  assert.doesNotMatch(s, /gi-card|TeamLine|LineScore/);
});

// ------------------------------------------------------- structural guards

test('THE LOGIC LIVES IN A PLAIN MODULE, not in JSX', () => {
  for (const f of ['components/league/LeagueHeader.js', 'components/league/RankRail.js',
                   'components/league/GamesStrip.js', 'components/league/LeagueScores.js']) {
    const code = strip(src(f));
    assert.doesNotMatch(code, /\bsql`|SELECT /i, `${f} must not query`);
    assert.doesNotMatch(code, /\.sort\(|\.filter\(\(g\) =>/, `${f} must not re-shape data`);
  }
});

test('ONE RECORDS LOADER, two callers', () => {
  const loader = strip(src('lib/gridiron/recordsLoader.js'));
  assert.match(loader, /recordChipMap/);
  assert.match(strip(src('app/scores/page.js')), /loadRecordChips\(\)/);
  assert.match(strip(src('components/gridiron/TodayPage.js')), /loadRecordChips\(\)/);
  // and neither caller resolves the season itself any more
  assert.doesNotMatch(strip(src('app/scores/page.js')), /recordChipMap\(/);
});

// ===========================================================================
// RELAY B — the counts, the bottom half, and the retirements
// ===========================================================================

test('THE COUNT COMES FROM THE READER, never from the tile', () => {
  // gamesLobby computes it per game, because only the reader knows what each
  // game counts. tileNumber renders what it was handed and nothing else.
  const lg = strip(src('lib/games/read.js'));
  assert.match(lg, /count: pickem/);
  assert.match(lg, /picked\}\/\$\{pickem\.total\}/, "pick 'em counts picks over the board");
  assert.match(lg, /unit: 'played today'/);
  assert.match(lg, /key === 'weekly'/);
  // The tile does no arithmetic of its own. (tiles.length is the strip
  // deciding whether it has one tile or four - layout, not a count about a
  // game.) What it must never do is compute a game's number.
  const tile = strip(src('components/league/GamesStrip.js'));
  assert.doesNotMatch(tile, /picked|\btotal\b|\.filter\(|Object\.keys/);
});

test('a ghosted game carries NO number', () => {
  // There is no contest to count, so a number would be a claim about nothing.
  assert.match(strip(src('lib/games/lobby.js')), /state: 'ghost'[^}]*count: null/s);
  assert.equal(tileNumber({ count: null }), null);
  assert.equal(tileNumber({ count: { value: '' } }), null);
  assert.deepEqual(tileNumber({ count: { value: '9/16', unit: 'picked' } }), { value: '9/16', unit: 'picked' });
  // A unit is optional - "Room open" has none.
  assert.deepEqual(tileNumber({ count: { value: 'Room open', unit: null } }), { value: 'Room open', unit: null });
});

test("the pick'em count is VIEWER-SCOPED - a stranger gets the board size", () => {
  const lg = strip(src('lib/games/read.js'));
  assert.match(lg, /uid != null\s*\?\s*\{ value: `\$\{pickem\.picked\}/s,
    'my picks only when there is a me');
  assert.match(lg, /: \{ value: String\(pickem\.total\), unit: 'games' \}/,
    'signed out gets the board size, never somebody else\'s progress');
});

// ------------------------------------------------------- standings snapshot

test('THE SNAPSHOT GROUP IS THE FOLLOWED TEAM\'S, else the default', () => {
  const m = strip(src('lib/gridiron/landingModules.js'));
  assert.match(m, /FROM user_team_follows f/);
  assert.match(m, /ORDER BY f\.followed_at ASC/, 'the first follow, deterministically');
  assert.match(m, /DEFAULT_GROUP = Object\.freeze\(\{ cfb: 'ACC', nfl: 'AFC East' \}\)/);
  // A follow we hold but cannot place in this season's groups falls to the
  // default rather than emptying the module.
  assert.match(m, /rows\.some\(\(r\) => sameGroup\(groupLabel\(leagueSlug, r\), followed\)\)/);
  // AND THE COMPARISON IS CASE-INSENSITIVE, which is the whole defect: the
  // constant says 'AFC East', the standings reader returns 'AFC EAST', the
  // strict equality never matched, and the NFL Today tab silently had no
  // standings module at all while CFB worked on an already-uppercase 'ACC'.
  assert.doesNotMatch(m, /groupLabel\(leagueSlug, r\) === /, 'no strict label equality survives');
  assert.match(m, /export const sameGroup = /);
  // The heading is the data's spelling, not the constant's, so a loose match
  // cannot make the module claim a label the standings page does not use.
  assert.match(m, /group: groupLabel\(leagueSlug, top\[0\]\) \|\| want/);
});

test('sameGroup matches across case and padding, and never on a null', () => {
  assert.equal(sameGroup('AFC East', 'AFC EAST'), true, 'the exact pair that was broken');
  assert.equal(sameGroup('ACC', 'ACC'), true);
  assert.equal(sameGroup(' afc east ', 'AFC East'), true);
  assert.equal(sameGroup('AFC East', 'AFC West'), false, 'it is still an equality');
  assert.equal(sameGroup('NFC North', 'AFC North'), false);
  for (const [a, b] of [[null, 'ACC'], ['ACC', null], [null, null], [undefined, 'ACC']]) {
    assert.equal(sameGroup(a, b), false, 'a missing side is not a match');
  }
});

test('a column appears only when somebody has a number in it', () => {
  // CFBD publishes no streak and no points for college; two columns of dashes
  // would be a promise we do not keep.
  const m = strip(src('lib/gridiron/landingModules.js'));
  assert.match(m, /hasStreak: top\.some/);
  assert.match(m, /hasPoints: top\.some/);
  const c = strip(src('components/league/StandingsSnapshot.js'));
  assert.match(c, /\{hasStreak \?/);
  assert.match(c, /!isCfb && hasPoints \?/);
});

test('THE MATCHES-DERIVED getStandings IS GONE, not repointed', () => {
  // It counted final results out of `matches` and disagreed with the
  // provider-sourced team_records - two answers to one question, and the rail
  // showed the wrong one. Its only caller was that rail.
  const readers = src('lib/gridiron/readers.js');
  assert.doesNotMatch(strip(readers), /export async function getStandings/);
  assert.match(readers, /getStandings — DELETED/, 'and the deletion is explained where it stood');
  for (const f of ['components/gridiron/TodayPage.js', 'components/league/StandingsSnapshot.js']) {
    assert.doesNotMatch(strip(src(f)), /getStandings/);
  }
  // The snapshot reads the standings reader instead.
  assert.match(strip(src('lib/gridiron/landingModules.js')), /getLeagueRecords/);
});

// -------------------------------------------------------------- the market

test('ONE ODDS SOURCE - the market module opens no query of its own', () => {
  const m = strip(src('lib/gridiron/landingModules.js'));
  assert.doesNotMatch(m, /odds_markets/, 'the line comes through oddsReader or not at all');
  assert.match(m, /await import\('\.\/oddsReader\.js'\)/);
  assert.match(m, /getSpreadHome|getTotalPoints/);
  const c = strip(src('components/league/MarketModule.js'));
  assert.doesNotMatch(c, /odds_markets|sql`/);
});

test('isPreGame at the FETCH and at the RENDER', () => {
  assert.match(strip(src('lib/gridiron/landingModules.js')), /m\.status = 'scheduled'/);
  assert.match(strip(src('components/league/MarketModule.js')), /isPreGame\(statuses\?\.get/);
});

test('a market row that cannot name its favourite is DROPPED', () => {
  // The spread names a side, so a row missing an abbreviation cannot state who
  // is favoured - and a market row that will not say who is a fixture list.
  assert.match(strip(src('lib/gridiron/landingModules.js')), /g\.home_abbr && g\.away_abbr/);
  assert.match(strip(src('components/league/MarketModule.js')), /if \(!label\) return null/);
});

// ------------------------------------------------------------- week leaders

test('LEADERS ARE REG-ONLY AND WEEK-SCOPED', () => {
  const m = strip(src('lib/gridiron/landingModules.js'));
  assert.match(m, /m\.season_year = \$2 AND m\.week = \$3 AND m\.season_phase = 'REG'/,
    'a query that forgets either crowns somebody on a career total');
  // The two codes keep separate tables; neither is assumed.
  assert.match(m, /cfb_player_game_stats/);
  assert.match(m, /nfl_player_game_stats/);
  assert.match(m, /g\.player_id/);
  assert.match(m, /g\.nfl_player_id/);
});

test('a category nobody has a number in gets no row', () => {
  assert.match(strip(src('lib/gridiron/landingModules.js')), /if \(r && Number\(r\.yards\) > 0\)/);
});

test('leaders link where they resolve, identical grammar where not', () => {
  const c = strip(src('components/league/WeekLeaders.js'));
  assert.match(c, /l\.slug \? <Link className="lgm-pl"[^>]*>\{l\.name\}<\/Link> : l\.name/);
});

// -------------------------------------------------------------- reads + zero

test('EVERY MODULE IS ABSENT AT ZERO, never an empty frame', () => {
  const pairs = [
    ['components/league/ReadsModule.js', /if \(!reads\?\.length\) return null/],
    ['components/league/WeekLeaders.js', /if \(!leaders\?\.length\) return null/],
    ['components/league/StandingsSnapshot.js', /if \(!snapshot\?\.rows\?\.length\) return null/],
    ['components/league/MarketModule.js', /if \(!live\.length\) return null/],
    ['components/league/RankRail.js', /if \(!chips\?\.length\) return null/],
  ];
  for (const [f, re] of pairs) assert.match(strip(src(f)), re, `${f} must vanish at zero`);
});

// ------------------------------------------------------------ retirements

test('THE RETIRED FURNITURE IS GONE FROM THE LANDING', () => {
  const t = strip(src('components/gridiron/TodayPage.js'));
  for (const gone of ['gi-lede', 'gi-instrument', 'gi-standings', 'PlayoffPicture',
                      'SuiteTeasers', 'UpsetWatch', 'TheRead', 'EditorialBoard',
                      'MarketBoard', 'FantasyBoard', 'MovementCard']) {
    assert.equal(t.includes(gone), false, `${gone} must not render on the league landing`);
  }
  // and the readers that fed only them are no longer imported here
  for (const r of ['getStandings', 'getMarketMovers', 'getUpsetWatch', 'getEditorialBoard',
                   'getTitleContenders', 'getGlobalMostDrafted', 'getMovementCard']) {
    assert.equal(t.includes(r), false, `${r} must not be read by the landing`);
  }
});

test('the components retired to zero importers are DELETED, not left dead', () => {
  // MarketBoard, RailCards (SuiteTeasers/UpsetWatch/TheRead) and leagueCopy
  // lost their last consumer with this relay. A component nobody imports is a
  // component nobody maintains and somebody eventually re-mounts.
  for (const f of ['components/gridiron/MarketBoard.js', 'components/gridiron/RailCards.js',
                   'components/gridiron/leagueCopy.js']) {
    assert.equal(existsSync(path.join(REPO, f)), false, `${f} should have been deleted`);
  }
  // PlayoffPicture, EditorialBoard and MovementCard are still used ELSEWHERE
  // (the rankings hub, the home page, /my), so they stay.
  for (const f of ['components/gridiron/PlayoffPicture.js', 'components/gridiron/EditorialBoard.js',
                   'components/fantasy/MovementCard.js']) {
    assert.ok(existsSync(path.join(REPO, f)), `${f} is still used off the landing`);
  }
});

// --------------------------------------------------- the week-leaders tables

test('THE TWO CODES USE DIFFERENT IDENTITY TABLES, and the join cannot be swapped', () => {
  // THE DEFECT: one shared query with a swapped join column. The NFL half did
  // JOIN players p ON p.id = g.nfl_player_id, but that column is a foreign key
  // to nfl_players.id - a separate identity table - and the ids collide. Every
  // NFL name, team chip and /player/ link on the Today tab was a soccer player
  // wearing a real NFL yardage: "N. Bentaleb · ALG · 205" where the row is
  // Brock Purdy of San Francisco.
  const m = strip(src('lib/gridiron/landingModules.js'));
  const cfb = m.slice(m.indexOf('cfb: (col)'), m.indexOf('nfl: (col)'));
  const nfl = m.slice(m.indexOf('nfl: (col)'), m.indexOf('export async function weekLeaders'));

  assert.match(cfb, /FROM cfb_player_game_stats g/);
  assert.match(cfb, /JOIN players p ON p\.id = g\.player_id/, 'CFB really does key to players');
  assert.doesNotMatch(cfb, /nfl_players/, 'and never touches the NFL table');

  assert.match(nfl, /FROM nfl_player_game_stats g/);
  assert.match(nfl, /JOIN nfl_players np ON np\.id = g\.nfl_player_id/, 'the FK, honoured');
  assert.doesNotMatch(nfl, /JOIN players p ON p\.id = g\.nfl_player_id/, 'never the old wrong join');
  assert.doesNotMatch(nfl, /players p ON p\.id = /, 'players is not an identity source for the NFL');

  // The profile link is bridged, not assumed: nfl_players carries no slug, so
  // the /player/ href comes from the roster row the bdl id joins to. The
  // bridge is the one stated in lib/gridiron/playerStats.js.
  assert.match(nfl, /LEFT JOIN players pl ON pl\.external_ids->>'bdl_player_id' = np\.bdl_player_id::text/);
  assert.match(nfl, /SELECT np\.full_name, pl\.slug/, 'NFL name from nfl_players, slug from the bridge');
  assert.match(strip(src('lib/gridiron/playerStats.js')), /nfl_players/, 'the bridge is documented there');

  // The team chip is the team they PLAYED for that week, off the stat row.
  assert.match(nfl, /LEFT JOIN teams t ON t\.id = g\.team_id/);

  // A SWAP CANNOT HAPPEN SILENTLY AGAIN: there is no shared template with an
  // interpolated table or join column left to get wrong.
  assert.doesNotMatch(m, /const table = isCfb \?/, 'no interpolated table name');
  assert.doesNotMatch(m, /const playerJoin = isCfb \?/, 'no interpolated join column');
  assert.match(m, /const build = LEADER_SQL\[leagueSlug\];/, 'one explicit query per code');
  assert.match(m, /if \(!build\) return \[\];/, 'and an unknown league gets nothing, not a guess');
});

// THE STANDINGS GROUP. These rows are shaped exactly as getLeagueRecords
// returns them on PROD, division IN CAPS, which is the whole point: DEV
// carries no team_records rows at all, so nothing that ran locally could ever
// have caught this.
const NFL_ROWS = [
  { team: 'BUF', conference: 'AFC', division: 'EAST', wins: 1, losses: 0 },
  { team: 'MIA', conference: 'AFC', division: 'EAST', wins: 0, losses: 1 },
  { team: 'NE', conference: 'AFC', division: 'EAST', wins: 0, losses: 1 },
  { team: 'NYJ', conference: 'AFC', division: 'EAST', wins: 0, losses: 1 },
  { team: 'KC', conference: 'AFC', division: 'WEST', wins: 1, losses: 0 },
  { team: 'DEN', conference: 'AFC', division: 'WEST', wins: 0, losses: 1 },
  { team: 'SF', conference: 'NFC', division: 'WEST', wins: 1, losses: 0 },
];
const CFB_ROWS = [
  { team: 'DUKE', conference: 'ACC' }, { team: 'MIA', conference: 'ACC' },
  { team: 'UGA', conference: 'SEC' },
];

test('NFL: the snapshot finds its default group despite the case, and names it as the data does', () => {
  // THE DEFECT, PINNED. DEFAULT_GROUP.nfl is 'AFC East'; the provider stores
  // 'AFC EAST'. Strict equality matched nothing, `mine` came back empty,
  // standingsSnapshot returned null, and the NFL Today tab had NO standings
  // module at all - silently, with no error anywhere.
  assert.equal(DEFAULT_GROUP.nfl, 'AFC East', 'the constant still reads in title case');
  const p = pickGroup(NFL_ROWS, { leagueSlug: 'nfl' });
  assert.ok(p, 'a group is found');
  assert.equal(p.rows.length, 4, 'and all four AFC East rows come with it');
  assert.deepEqual(p.rows.map((r) => r.team), ['BUF', 'MIA', 'NE', 'NYJ']);
  assert.equal(p.group, 'AFC EAST', "the heading is the data's spelling, not the constant's");
  assert.equal(p.fromFollow, false, 'nobody followed anything');
});

test('a signed-in follower still gets their own group, in any case they follow it', () => {
  const west = pickGroup(NFL_ROWS, { leagueSlug: 'nfl', followed: 'AFC West' });
  assert.deepEqual(west.rows.map((r) => r.team), ['KC', 'DEN'], 'the follow wins over the default');
  assert.equal(west.fromFollow, true);
  assert.equal(west.group, 'AFC WEST');
  // followed in caps, stored in caps, still theirs
  assert.equal(pickGroup(NFL_ROWS, { leagueSlug: 'nfl', followed: 'NFC WEST' }).group, 'NFC WEST');
  // A follow this season's rows cannot place falls to the default rather than
  // emptying the module.
  const gone = pickGroup(NFL_ROWS, { leagueSlug: 'nfl', followed: 'AFC SOUTH' });
  assert.equal(gone.group, 'AFC EAST', 'the default, not nothing');
  assert.equal(gone.fromFollow, false);
});

test('CFB is unaffected, because its label was already uppercase', () => {
  const p = pickGroup(CFB_ROWS, { leagueSlug: 'cfb' });
  assert.equal(p.group, 'ACC');
  assert.deepEqual(p.rows.map((r) => r.team), ['DUKE', 'MIA']);
  assert.equal(pickGroup(CFB_ROWS, { leagueSlug: 'cfb', followed: 'sec' }).group, 'SEC', 'and a lowercase follow lands');
  assert.equal(pickGroup([], { leagueSlug: 'cfb' }), null, 'no rows, no module');
});

test('the NFL fixture returns NFL names, off the real stat rows', async () => {
  // A LIVE READ, because the defect was invisible to every source pin: the
  // shape was fine, the join column was wrong, and only the returned rows
  // told you. DEV carries the week-1 nfl_player_game_stats rows.
  const { weekLeaders } = await import('./landingModules.js');
  const rows = await weekLeaders('nfl', 2026, 1);
  if (!rows.length) return; // an empty DEV week is not this test's business
  for (const r of rows) {
    assert.ok(r.name && !/^[A-Z]\. /.test(r.name),
      `${r.name} is a full NFL name, not the "N. Bentaleb" initial-and-surname the soccer table stores`);
    if (r.slug != null) {
      assert.match(r.slug, /-nfl-\d+$/, `${r.slug} is an NFL profile slug`);
    }
    assert.ok(r.yards > 0);
  }
  const passing = rows.find((r) => r.key === 'pass');
  if (passing) assert.ok(/^[A-Za-z].+ .+/.test(passing.name), 'a real first and last name');
  // and the three-letter chip is a gridiron team, never a country code
  for (const r of rows) {
    if (r.abbr) assert.doesNotMatch(r.abbr, /^(ALG|AUT|ECU|BRA|ARG)$/, `${r.abbr} is a country, not an NFL club`);
  }
});
